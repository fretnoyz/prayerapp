import Dexie from 'dexie';

export const db = new Dexie('prayerapp');

db.version(1).stores({
  sections: 'id, sortOrder',
  requests: 'id, sectionId, status, expiresAt',
  prayers: 'id, requestId, prayedAt',
  notes: 'id, requestId, createdAt',
  settings: 'id',
});

// v2: denormalized prayCount/lastPrayedAt on requests (the prayers log stays the source of truth),
// a per-device id stamped on records (sync readiness), and a table for the pre-import snapshot.
db.version(2)
  .stores({ snapshots: 'id' })
  .upgrade(async (tx) => {
    const deviceId = uuid();
    await tx.table('settings').put({ id: 'device', deviceId });
    const stats = computeStats(await tx.table('prayers').toArray());
    await tx.table('requests').toCollection().modify((r) => {
      const s = stats[r.id];
      r.prayCount = s ? s.count : 0;
      r.lastPrayedAt = s ? s.last : null;
    });
    for (const t of ['sections', 'requests', 'prayers', 'notes']) {
      await tx.table(t).toCollection().modify((r) => {
        if (!r.deviceId) r.deviceId = deviceId;
      });
    }
  });

const DAY = 86400000;
const SEED_SECTIONS = ['Family', 'Church', 'Friends', 'Missions', 'Work'];
const DEFAULT_SETTINGS = { id: 'settings', defaultExpiryDays: 30, alertLeadDays: 7, lastExportedAt: null };
const UNDO_IMPORT_DAYS = 7; // how long "Undo import" stays on offer
const STATUSES = ['active', 'answered', 'expired'];

export function uuid() {
  return (
    (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    })
  );
}

// ---------- clock ----------
// Test builds only (VITE_TEST_CLOCK=1): localStorage "prayer.now" fakes the clock for expiry tests.
// In production builds this whole branch is compiled out.
const TEST_CLOCK = !!(import.meta.env && import.meta.env.VITE_TEST_CLOCK === '1');
let clockOverride = null;
/** Unit tests: setClock(() => ms) or setClock(null). */
export function setClock(fn) {
  clockOverride = fn;
}
export function now() {
  if (clockOverride) return clockOverride();
  if (TEST_CLOCK) {
    try {
      const fake = localStorage.getItem('prayer.now');
      if (fake) return new Date(fake).getTime();
    } catch {}
  }
  return Date.now();
}
const iso = () => new Date(now()).toISOString();

// ---------- record stamping ----------

let deviceId = null;
export const getDeviceId = () => deviceId;

const stamp = (obj) => {
  const t = iso();
  return { createdAt: t, updatedAt: t, deletedAt: null, ...obj, deviceId };
};
const touch = (obj) => ({ ...obj, updatedAt: iso(), deviceId });
const live = (r) => !r.deletedAt;

export const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function computeStats(prayers) {
  const map = {};
  for (const p of prayers) {
    if (!live(p)) continue;
    const m = (map[p.requestId] ||= { count: 0, last: null });
    m.count++;
    if (!m.last || p.prayedAt > m.last) m.last = p.prayedAt;
  }
  return map;
}

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get('settings')) || {}) };
}

export async function saveSettings(patch) {
  const s = await getSettings();
  await db.settings.put({ ...s, ...patch, id: 'settings' });
}

/** Opens the database, seeds on first run, and runs the expiry sweep. Returns { firstRun }. */
export async function init() {
  let firstRun = false;
  await db.transaction('rw', db.settings, db.sections, async () => {
    const dev = await db.settings.get('device');
    deviceId = dev ? dev.deviceId : uuid();
    if (!dev) await db.settings.put({ id: 'device', deviceId });
    if (!(await db.settings.get('settings'))) {
      firstRun = true;
      await db.settings.put(DEFAULT_SETTINGS);
      await db.sections.bulkPut(
        SEED_SECTIONS.map((name, i) => stamp({ id: uuid(), name, sortOrder: i, neverExpires: false }))
      );
    }
  });
  await dropStaleSnapshot();
  await sweepExpired();
  return { firstRun };
}

export async function sweepExpired() {
  const t = iso();
  const stale = (await db.requests.where('status').equals('active').toArray()).filter(
    (r) => live(r) && r.expiresAt && r.expiresAt < t
  );
  for (const r of stale) await db.requests.put(touch({ ...r, status: 'expired' }));
  return stale.length;
}

async function expiryFor(sectionId) {
  if (sectionId) {
    const sec = await db.sections.get(sectionId);
    if (sec && sec.neverExpires) return null;
  }
  const s = await getSettings();
  return new Date(now() + s.defaultExpiryDays * DAY).toISOString();
}

// ---------- queries ----------

export async function listSections() {
  return (await db.sections.orderBy('sortOrder').toArray()).filter(live);
}

export async function listByStatus(statuses) {
  return (await db.requests.where('status').anyOf(statuses).toArray()).filter(live);
}

/** requestId -> prayerId for prayers logged since the start of today. */
export async function prayedTodayMap() {
  const map = {};
  const since = new Date(startOfDay(now())).toISOString();
  for (const p of await db.prayers.where('prayedAt').aboveOrEqual(since).toArray()) {
    if (live(p)) map[p.requestId] = p.id;
  }
  return map;
}

export async function getRequestBundle(id) {
  const req = await db.requests.get(id);
  if (!req || !live(req)) return null;
  const prayers = (await db.prayers.where('requestId').equals(id).toArray())
    .filter(live)
    .sort((a, b) => (a.prayedAt < b.prayedAt ? 1 : -1));
  const notes = (await db.notes.where('requestId').equals(id).toArray())
    .filter(live)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { req, prayers, notes };
}

// ---------- mutations ----------

export async function addRequest(text, sectionId = null) {
  text = (text || '').trim();
  if (!text) return null;
  const r = stamp({
    id: uuid(),
    text,
    sectionId,
    status: 'active',
    expiresAt: await expiryFor(sectionId),
    answeredAt: null,
    answerNote: null,
    author: null,
    prayCount: 0,
    lastPrayedAt: null,
  });
  await db.requests.put(r);
  return r;
}

export async function updateRequest(id, patch) {
  const r = await db.requests.get(id);
  if (!r) return;
  let next = { ...r, ...patch };
  if ('sectionId' in patch && patch.sectionId !== r.sectionId && r.status === 'active') {
    const before = r.sectionId ? await db.sections.get(r.sectionId) : null;
    const after = patch.sectionId ? await db.sections.get(patch.sectionId) : null;
    if (after?.neverExpires) next.expiresAt = null;
    else if (before?.neverExpires || !r.expiresAt) next.expiresAt = await expiryFor(patch.sectionId);
  }
  await db.requests.put(touch(next));
}

// prayCount/lastPrayedAt are a derived cache of the prayers log. They are recomputed from the log
// (one indexed lookup) rather than incremented, and don't bump updatedAt, so a later sync can
// simply recompute them after merging prayers.
async function refreshStats(requestId) {
  const s = computeStats(await db.prayers.where('requestId').equals(requestId).toArray())[requestId];
  await db.requests.update(requestId, { prayCount: s ? s.count : 0, lastPrayedAt: s ? s.last : null });
}

export async function logPrayer(requestId) {
  const p = stamp({ id: uuid(), requestId, prayedAt: iso() });
  await db.transaction('rw', db.prayers, db.requests, async () => {
    await db.prayers.put(p);
    await refreshStats(requestId);
  });
  return p;
}

export async function undoPrayer(prayerId) {
  await db.transaction('rw', db.prayers, db.requests, async () => {
    const p = await db.prayers.get(prayerId);
    if (!p) return;
    await db.prayers.put(touch({ ...p, deletedAt: iso() }));
    await refreshStats(p.requestId);
  });
}

export async function addNote(requestId, text, prayerId = null) {
  text = (text || '').trim();
  if (!text) return;
  await db.notes.put(stamp({ id: uuid(), requestId, prayerId, text, author: null }));
}

export async function extendRequest(id) {
  const r = await db.requests.get(id);
  await db.requests.put(touch({ ...r, status: 'active', expiresAt: await expiryFor(r.sectionId) }));
}

export async function markAnswered(id, answerNote) {
  const r = await db.requests.get(id);
  await db.requests.put(
    touch({ ...r, status: 'answered', answeredAt: iso(), answerNote: (answerNote || '').trim() || null })
  );
}

export async function reactivate(id) {
  const r = await db.requests.get(id);
  await db.requests.put(
    touch({ ...r, status: 'active', answeredAt: null, expiresAt: await expiryFor(r.sectionId) })
  );
}

export async function deleteRequest(id) {
  const r = await db.requests.get(id);
  await db.requests.put(touch({ ...r, deletedAt: iso() }));
}

export async function addSection(name) {
  name = (name || '').trim();
  if (!name) return;
  const all = await listSections();
  const max = all.reduce((m, s) => Math.max(m, s.sortOrder), -1);
  await db.sections.put(stamp({ id: uuid(), name, sortOrder: max + 1, neverExpires: false }));
}

export async function updateSection(id, patch) {
  const s = await db.sections.get(id);
  await db.sections.put(touch({ ...s, ...patch }));
  if ('neverExpires' in patch && patch.neverExpires !== s.neverExpires) {
    const reqs = (await db.requests.where('sectionId').equals(id).toArray()).filter(
      (r) => live(r) && r.status === 'active'
    );
    for (const r of reqs) {
      await db.requests.put(touch({ ...r, expiresAt: patch.neverExpires ? null : await expiryFor(null) }));
    }
  }
}

export async function moveSection(id, dir) {
  const all = await listSections();
  const i = all.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction('rw', db.sections, async () => {
    for (let k = 0; k < all.length; k++) await db.sections.put(touch({ ...all[k], sortOrder: k }));
  });
}

export async function deleteSection(id) {
  const s = await db.sections.get(id);
  await db.transaction('rw', db.sections, db.requests, db.settings, async () => {
    await db.sections.put(touch({ ...s, deletedAt: iso() }));
    const reqs = (await db.requests.where('sectionId').equals(id).toArray()).filter(live);
    for (const r of reqs) {
      const expiresAt = s.neverExpires && r.status === 'active' ? await expiryFor(null) : r.expiresAt;
      await db.requests.put(touch({ ...r, sectionId: null, expiresAt }));
    }
  });
}

// ---------- backup ----------

const TABLES = ['sections', 'requests', 'prayers', 'notes', 'settings'];
const NOT_A_BACKUP = 'This file is not a Prayer List backup.';

export async function exportData() {
  const data = { app: 'prayerapp', version: 2, exportedAt: iso() };
  await saveSettings({ lastExportedAt: data.exportedAt });
  for (const t of TABLES) data[t] = await db[t].toArray();
  data.settings = data.settings.filter((s) => s.id === 'settings'); // the device id stays on this device
  return data;
}

/**
 * Checks a parsed backup file. Throws an Error with a plain message if it can't be used.
 * Returns counts of live records for the confirm screen.
 */
export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.app !== 'prayerapp') {
    throw new Error(NOT_A_BACKUP);
  }
  if (!Array.isArray(data.requests)) throw new Error(NOT_A_BACKUP + ' (no requests found)');
  for (const t of TABLES) {
    if (data[t] === undefined) continue;
    if (!Array.isArray(data[t])) throw new Error(`This backup looks damaged: “${t}” is not a list.`);
    data[t].forEach((row, i) => {
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id) {
        throw new Error(`This backup looks damaged: ${t} item ${i + 1} has no id.`);
      }
    });
  }
  data.requests.forEach((r, i) => {
    if (typeof r.text !== 'string') throw new Error(`This backup looks damaged: request ${i + 1} has no text.`);
    if (!STATUSES.includes(r.status)) {
      throw new Error(`This backup looks damaged: request ${i + 1} has an unknown status.`);
    }
  });
  (data.prayers || []).forEach((p, i) => {
    if (typeof p.requestId !== 'string' || typeof p.prayedAt !== 'string') {
      throw new Error(`This backup looks damaged: prayer ${i + 1} is incomplete.`);
    }
  });
  (data.notes || []).forEach((n, i) => {
    if (typeof n.requestId !== 'string' || typeof n.text !== 'string') {
      throw new Error(`This backup looks damaged: note ${i + 1} is incomplete.`);
    }
  });
  const count = (rows) => (rows || []).filter(live).length;
  return {
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
    requests: count(data.requests),
    active: data.requests.filter((r) => live(r) && r.status === 'active').length,
    answered: data.requests.filter((r) => live(r) && r.status === 'answered').length,
    prayers: count(data.prayers),
    notes: count(data.notes),
    sections: count(data.sections),
  };
}

const ALL = () => [...TABLES, 'snapshots'].map((t) => db[t]);

async function readAll() {
  const out = {};
  for (const t of TABLES) out[t] = await db[t].toArray();
  return out;
}

// Replace all user tables with `data`, keeping this device's id. Must run inside a transaction.
async function replaceAll(data) {
  const dev = await db.settings.get('device');
  for (const t of TABLES) await db[t].clear();
  if (dev) await db.settings.put(dev);
  await db.sections.bulkPut(data.sections || []);
  await db.prayers.bulkPut(data.prayers || []);
  await db.notes.bulkPut(data.notes || []);
  const settings = (data.settings || []).find((s) => s.id === 'settings');
  await db.settings.put({ ...DEFAULT_SETTINGS, ...(settings || {}), id: 'settings' });
  // Rebuild the derived stats: older backups don't carry them.
  const stats = computeStats(data.prayers || []);
  await db.requests.bulkPut(
    data.requests.map((r) => {
      const s = stats[r.id];
      return { ...r, prayCount: s ? s.count : 0, lastPrayedAt: s ? s.last : null };
    })
  );
}

/** Replace everything with a backup. Keeps a snapshot of the current data so it can be undone. */
export async function importData(data) {
  validateBackup(data);
  await db.transaction('rw', ALL(), async () => {
    const before = await readAll();
    await db.snapshots.put({ id: 'pre-import', takenAt: iso(), data: before });
    await replaceAll(data);
  });
  await sweepExpired();
}

/** The snapshot taken before the last import, if still on offer: { takenAt } or null. */
export async function importUndoInfo() {
  const s = await db.snapshots.get('pre-import');
  return s ? { takenAt: s.takenAt } : null;
}

export async function undoImport() {
  let restored = false;
  await db.transaction('rw', ALL(), async () => {
    const s = await db.snapshots.get('pre-import');
    if (!s) return;
    await replaceAll(s.data);
    await db.snapshots.delete('pre-import');
    restored = true;
  });
  if (restored) await sweepExpired();
  return restored;
}

async function dropStaleSnapshot() {
  const s = await db.snapshots.get('pre-import');
  if (s && now() - new Date(s.takenAt).getTime() > UNDO_IMPORT_DAYS * DAY) await db.snapshots.delete('pre-import');
}

export { DAY };
