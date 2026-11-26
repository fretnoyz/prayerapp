// Unit tests for the data rules in src/db.js, using an in-memory IndexedDB.
// Run: npm run test:unit
import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import * as P from '../../src/db.js';

const { db, DAY } = P;
const T0 = Date.parse('2026-03-02T15:00:00Z');
let t = T0;
P.setClock(() => t);
const advance = (days) => (t += days * DAY);
const get = (id) => db.requests.get(id);
const sectionByName = async (name) => (await P.listSections()).find((s) => s.name === name);

beforeEach(async () => {
  t = T0;
  await db.delete();
  await db.open();
  await P.init();
});

test('first run seeds sections, settings and a device id', async () => {
  const names = (await P.listSections()).map((s) => s.name);
  assert.deepEqual(names, ['Family', 'Church', 'Friends', 'Missions', 'Work']);
  const s = await P.getSettings();
  assert.equal(s.defaultExpiryDays, 30);
  assert.equal(s.alertLeadDays, 7);
  assert.match(P.getDeviceId(), /^[0-9a-f-]{36}$/);
  const r = await P.addRequest('x');
  assert.equal(r.deviceId, P.getDeviceId());
  // init again keeps the same device id
  const before = P.getDeviceId();
  await P.init();
  assert.equal(P.getDeviceId(), before);
});

test('addRequest trims, ignores empty text, and sets expiry', async () => {
  assert.equal(await P.addRequest('   '), null);
  const r = await P.addRequest('  Ann, new job  ');
  assert.equal(r.text, 'Ann, new job');
  assert.equal(r.sectionId, null);
  assert.equal(r.status, 'active');
  assert.equal(r.expiresAt, new Date(T0 + 30 * DAY).toISOString());
  assert.equal(r.prayCount, 0);
});

test('expiry sweep moves only overdue active requests to expired', async () => {
  const a = await P.addRequest('a');
  advance(10);
  const b = await P.addRequest('b');
  const fam = await sectionByName('Family');
  await P.updateSection(fam.id, { neverExpires: true });
  const c = await P.addRequest('c', fam.id);
  assert.equal(c.expiresAt, null);
  advance(25); // a is 35 days old, b 25
  assert.equal(await P.sweepExpired(), 1);
  assert.equal((await get(a.id)).status, 'expired');
  assert.equal((await get(b.id)).status, 'active');
  assert.equal((await get(c.id)).status, 'active');
});

test('extend sets expiry from today and reactivates', async () => {
  const r = await P.addRequest('r');
  advance(40);
  await P.sweepExpired();
  assert.equal((await get(r.id)).status, 'expired');
  await P.extendRequest(r.id);
  const after = await get(r.id);
  assert.equal(after.status, 'active');
  assert.equal(after.expiresAt, new Date(t + 30 * DAY).toISOString());
});

test('mark answered records time and trimmed note', async () => {
  const r = await P.addRequest('r');
  advance(3);
  await P.markAnswered(r.id, '  Healed.  ');
  const a = await get(r.id);
  assert.equal(a.status, 'answered');
  assert.equal(a.answeredAt, new Date(t).toISOString());
  assert.equal(a.answerNote, 'Healed.');
  const r2 = await P.addRequest('r2');
  await P.markAnswered(r2.id, '   ');
  assert.equal((await get(r2.id)).answerNote, null);
});

test('moving into a never-expires section clears expiry; moving out sets it from today', async () => {
  const fam = await sectionByName('Family');
  const church = await sectionByName('Church');
  await P.updateSection(fam.id, { neverExpires: true });
  const r = await P.addRequest('r', church.id);
  assert.ok(r.expiresAt);
  await P.updateRequest(r.id, { sectionId: fam.id });
  assert.equal((await get(r.id)).expiresAt, null);
  advance(5);
  await P.updateRequest(r.id, { sectionId: church.id });
  assert.equal((await get(r.id)).expiresAt, new Date(t + 30 * DAY).toISOString());
});

test('toggling never-expires on a section updates its active requests', async () => {
  const fam = await sectionByName('Family');
  const r = await P.addRequest('r', fam.id);
  await P.updateSection(fam.id, { neverExpires: true });
  assert.equal((await get(r.id)).expiresAt, null);
  advance(2);
  await P.updateSection(fam.id, { neverExpires: false });
  assert.equal((await get(r.id)).expiresAt, new Date(t + 30 * DAY).toISOString());
});

test('deleting a section moves its requests to Unsorted (and sets expiry if it never expired)', async () => {
  const fam = await sectionByName('Family');
  const work = await sectionByName('Work');
  await P.updateSection(fam.id, { neverExpires: true });
  const a = await P.addRequest('a', fam.id);
  const b = await P.addRequest('b', work.id);
  advance(1);
  await P.deleteSection(fam.id);
  await P.deleteSection(work.id);
  const ra = await get(a.id);
  const rb = await get(b.id);
  assert.equal(ra.sectionId, null);
  assert.equal(ra.expiresAt, new Date(t + 30 * DAY).toISOString());
  assert.equal(rb.sectionId, null);
  assert.equal(rb.expiresAt, b.expiresAt, 'expiry unchanged when the section could expire');
  assert.deepEqual((await P.listSections()).map((s) => s.name), ['Church', 'Friends', 'Missions']);
});

test('moveSection reorders and ignores moves past the ends', async () => {
  const church = await sectionByName('Church');
  await P.moveSection(church.id, -1);
  assert.deepEqual((await P.listSections()).map((s) => s.name), ['Church', 'Family', 'Friends', 'Missions', 'Work']);
  await P.moveSection(church.id, -1);
  assert.deepEqual((await P.listSections()).map((s) => s.sortOrder), [0, 1, 2, 3, 4]);
  const work = await sectionByName('Work');
  await P.moveSection(work.id, 1);
  await P.moveSection(work.id, -1);
  assert.deepEqual((await P.listSections()).map((s) => s.name), ['Church', 'Family', 'Friends', 'Work', 'Missions']);
});

test('logPrayer / undoPrayer keep prayCount and lastPrayedAt in step with the log', async () => {
  const r = await P.addRequest('r');
  const p1 = await P.logPrayer(r.id);
  advance(1);
  const p2 = await P.logPrayer(r.id);
  let x = await get(r.id);
  assert.equal(x.prayCount, 2);
  assert.equal(x.lastPrayedAt, p2.prayedAt);
  assert.equal((await P.prayedTodayMap())[r.id], p2.id);
  await P.undoPrayer(p2.id);
  x = await get(r.id);
  assert.equal(x.prayCount, 1);
  assert.equal(x.lastPrayedAt, p1.prayedAt);
  assert.equal((await P.prayedTodayMap())[r.id], undefined);
  await P.undoPrayer(p1.id);
  x = await get(r.id);
  assert.equal(x.prayCount, 0);
  assert.equal(x.lastPrayedAt, null);
  assert.equal((await db.prayers.count()), 2, 'the log keeps soft-deleted rows');
  assert.equal(x.updatedAt, r.updatedAt, 'derived stats do not bump updatedAt');
});

test('validateBackup rejects malformed files with a clear message', () => {
  const good = { app: 'prayerapp', requests: [{ id: 'a', text: 't', status: 'active' }] };
  assert.equal(P.validateBackup(good).requests, 1);
  const bad = [
    [null, /not a Prayer List backup/],
    [[], /not a Prayer List backup/],
    [{ app: 'other', requests: [] }, /not a Prayer List backup/],
    [{ app: 'prayerapp' }, /no requests found/],
    [{ app: 'prayerapp', requests: 'x' }, /no requests found/],
    [{ app: 'prayerapp', requests: [], notes: {} }, /“notes” is not a list/],
    [{ app: 'prayerapp', requests: [{ text: 't', status: 'active' }] }, /requests item 1 has no id/],
    [{ app: 'prayerapp', requests: [5] }, /requests item 1 has no id/],
    [{ app: 'prayerapp', requests: [{ id: 'a', status: 'active' }] }, /request 1 has no text/],
    [{ app: 'prayerapp', requests: [{ id: 'a', text: 't', status: 'done' }] }, /unknown status/],
    [{ app: 'prayerapp', requests: [], prayers: [{ id: 'p' }] }, /prayer 1 is incomplete/],
    [{ app: 'prayerapp', requests: [], notes: [{ id: 'n', requestId: 'a' }] }, /note 1 is incomplete/],
  ];
  for (const [data, re] of bad) assert.throws(() => P.validateBackup(data), re, JSON.stringify(data));
});

test('import replaces data, rebuilds stats, keeps device id; undo restores the previous data', async () => {
  const mine = await P.addRequest('mine');
  await P.logPrayer(mine.id);
  const device = P.getDeviceId();
  const backup = {
    app: 'prayerapp',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    sections: [{ id: 's1', name: 'Neighbours', sortOrder: 0, neverExpires: true }],
    requests: [
      { id: 'r1', text: 'Imported', sectionId: 's1', status: 'active', expiresAt: null },
      { id: 'r2', text: 'Old answer', sectionId: null, status: 'answered', answeredAt: '2025-12-01T00:00:00.000Z' },
    ],
    prayers: [
      { id: 'p1', requestId: 'r1', prayedAt: '2026-01-01T10:00:00.000Z' },
      { id: 'p2', requestId: 'r1', prayedAt: '2026-01-02T10:00:00.000Z' },
      { id: 'p3', requestId: 'r1', prayedAt: '2026-01-03T10:00:00.000Z', deletedAt: '2026-01-03T10:01:00.000Z' },
    ],
    notes: [{ id: 'n1', requestId: 'r1', text: 'note' }],
    settings: [{ id: 'settings', defaultExpiryDays: 14, alertLeadDays: 3 }, { id: 'device', deviceId: 'someone-else' }],
  };
  const counts = P.validateBackup(backup);
  assert.deepEqual(
    { requests: counts.requests, active: counts.active, answered: counts.answered, prayers: counts.prayers },
    { requests: 2, active: 1, answered: 1, prayers: 2 }
  );
  await P.importData(backup);
  assert.deepEqual((await P.listSections()).map((s) => s.name), ['Neighbours']);
  assert.equal(await get(mine.id), undefined);
  const r1 = await get('r1');
  assert.equal(r1.prayCount, 2);
  assert.equal(r1.lastPrayedAt, '2026-01-02T10:00:00.000Z');
  assert.equal((await P.getSettings()).defaultExpiryDays, 14);
  assert.equal((await db.settings.get('device')).deviceId, device, 'device id survives import');
  assert.ok(await P.importUndoInfo());

  assert.equal(await P.undoImport(), true);
  assert.ok(await get(mine.id));
  assert.equal((await get(mine.id)).prayCount, 1);
  assert.equal(await get('r1'), undefined);
  assert.equal((await P.listSections()).length, 5);
  assert.equal((await P.getSettings()).defaultExpiryDays, 30);
  assert.equal(await P.importUndoInfo(), null);
  assert.equal(await P.undoImport(), false);
});

test('a rejected import changes nothing', async () => {
  const r = await P.addRequest('keep me');
  await assert.rejects(P.importData({ app: 'prayerapp', requests: [{ id: 'x', text: 'y', status: '?' }] }), /unknown status/);
  assert.ok(await get(r.id));
  assert.equal(await P.importUndoInfo(), null);
});

test('import sweeps expired requests and the undo offer lapses after 7 days', async () => {
  await P.importData({
    app: 'prayerapp',
    requests: [{ id: 'old', text: 'old', status: 'active', expiresAt: '2020-01-01T00:00:00.000Z' }],
  });
  assert.equal((await get('old')).status, 'expired');
  advance(8);
  await P.init();
  assert.equal(await P.importUndoInfo(), null);
});

test('export omits the device id and round-trips through import', async () => {
  const r = await P.addRequest('round trip');
  await P.logPrayer(r.id);
  await P.addNote(r.id, 'a note');
  const data = JSON.parse(JSON.stringify(await P.exportData()));
  assert.deepEqual(data.settings.map((s) => s.id), ['settings']);
  assert.ok(data.settings[0].lastExportedAt);
  await db.delete();
  await db.open();
  await P.init();
  await P.importData(data);
  const back = await get(r.id);
  assert.equal(back.text, 'round trip');
  assert.equal(back.prayCount, 1);
  assert.equal((await db.notes.count()), 1);
});

test('upgrading a version 1 database backfills stats and device ids', async () => {
  db.close();
  await Dexie.delete('prayerapp');
  const v1 = new Dexie('prayerapp');
  v1.version(1).stores({
    sections: 'id, sortOrder',
    requests: 'id, sectionId, status, expiresAt',
    prayers: 'id, requestId, prayedAt',
    notes: 'id, requestId, createdAt',
    settings: 'id',
  });
  await v1.open();
  await v1.settings.put({ id: 'settings', defaultExpiryDays: 30, alertLeadDays: 7 });
  await v1.requests.bulkPut([
    { id: 'a', text: 'a', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' },
    { id: 'b', text: 'b', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' },
  ]);
  await v1.prayers.bulkPut([
    { id: 'p1', requestId: 'a', prayedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', requestId: 'a', prayedAt: '2026-02-01T00:00:00.000Z' },
    { id: 'p3', requestId: 'a', prayedAt: '2026-03-01T00:00:00.000Z', deletedAt: '2026-03-01T00:00:01.000Z' },
  ]);
  v1.close();

  await db.open();
  await P.init();
  const a = await get('a');
  const b = await get('b');
  assert.equal(a.prayCount, 2);
  assert.equal(a.lastPrayedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(b.prayCount, 0);
  assert.equal(b.lastPrayedAt, null);
  const dev = (await db.settings.get('device')).deviceId;
  assert.equal(P.getDeviceId(), dev);
  assert.equal(a.deviceId, dev);
  assert.equal((await db.prayers.get('p1')).deviceId, dev);
  assert.equal((await P.listSections()).length, 0, 'an existing install is not re-seeded');
});
