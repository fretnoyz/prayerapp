import Dexie from 'dexie';

export const db = new Dexie('prayerapp');

db.version(1).stores({
  sections: 'id, sortOrder',
  requests: 'id, sectionId, status, expiresAt',
  prayers: 'id, requestId, prayedAt',
  notes: 'id, requestId, createdAt',
  settings: 'id',
});

const DAY = 86400000;
const SEED_SECTIONS = ['Family', 'Church', 'Friends', 'Missions', 'Work'];
const DEFAULT_SETTINGS = { id: 'settings', defaultExpiryDays: 30, alertLeadDays: 7, lastExportedAt: null };

export const uuid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// Clock is overridable for testing expiry (localStorage key "prayer.now").
export function now() {
  try {
    const fake = localStorage.getItem('prayer.now');
    if (fake) return new Date(fake).getTime();
  } catch {}
  return Date.now();
}

const stamp = (obj) => {
  const t = new Date(now()).toISOString();
  return { createdAt: t, updatedAt: t, deletedAt: null, ...obj };
};
const touch = (obj) => ({ ...obj, updatedAt: new Date(now()).toISOString() });
const live = (r) => !r.deletedAt;

export const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export async function getSettings() {
  return (await db.settings.get('settings')) || DEFAULT_SETTINGS;
}

export async function saveSettings(patch) {
  const s = await getSettings();
  await db.settings.put({ ...s, ...patch });
}

export async function init() {
  if ((await db.settings.count()) === 0) {
    await db.transaction('rw', db.settings, db.sections, async () => {
      await db.settings.put(DEFAULT_SETTINGS);
      await db.sections.bulkPut(
        SEED_SECTIONS.map((name, i) => stamp({ id: uuid(), name, sortOrder: i, neverExpires: false }))
      );
    });
  }
  await sweepExpired();
}

export async function sweepExpired() {
  const t = new Date(now()).toISOString();
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

export async function prayerStats() {
  const map = {};
  for (const p of await db.prayers.toArray()) {
    if (!live(p)) continue;
    const m = (map[p.requestId] ||= { count: 0, last: null });
    m.count++;
    if (!m.last || p.prayedAt > m.last) m.last = p.prayedAt;
  }
  return map;
}

export async function listByStatus(statuses) {
  return (await db.requests.where('status').anyOf(statuses).toArray()).filter(live);
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

export async function logPrayer(requestId) {
  const p = stamp({ id: uuid(), requestId, prayedAt: new Date(now()).toISOString() });
  await db.prayers.put(p);
  return p;
}

export async function undoPrayer(prayerId) {
  const p = await db.prayers.get(prayerId);
  if (p) await db.prayers.put(touch({ ...p, deletedAt: new Date(now()).toISOString() }));
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
    touch({ ...r, status: 'answered', answeredAt: new Date(now()).toISOString(), answerNote: (answerNote || '').trim() || null })
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
  await db.requests.put(touch({ ...r, deletedAt: new Date(now()).toISOString() }));
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
    await db.sections.put(touch({ ...s, deletedAt: new Date(now()).toISOString() }));
    const reqs = (await db.requests.where('sectionId').equals(id).toArray()).filter(live);
    for (const r of reqs) {
      const expiresAt = s.neverExpires && r.status === 'active' ? await expiryFor(null) : r.expiresAt;
      await db.requests.put(touch({ ...r, sectionId: null, expiresAt }));
    }
  });
}

// ---------- backup ----------

const TABLES = ['sections', 'requests', 'prayers', 'notes', 'settings'];

export async function exportData() {
  const data = { app: 'prayerapp', version: 1, exportedAt: new Date(now()).toISOString() };
  for (const t of TABLES) data[t] = await db[t].toArray();
  await saveSettings({ lastExportedAt: data.exportedAt });
  data.settings = await db.settings.toArray();
  return data;
}

export async function importData(data) {
  if (!data || data.app !== 'prayerapp' || !Array.isArray(data.requests)) {
    throw new Error('This file is not a Prayer List backup.');
  }
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) {
      await db[t].clear();
      if (Array.isArray(data[t])) await db[t].bulkPut(data[t]);
    }
  });
  await sweepExpired();
}

export { DAY };
