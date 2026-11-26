// End-to-end test in an iPhone-sized viewport, against the test build (fake clock enabled).
// Run: npm test   (builds dist-test, then runs this file)
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCREENS = path.join(ROOT, 'tests/screens');
const OUT_DIR = 'dist-test';
const PORT = 4179;
const BASE = `http://localhost:${PORT}/prayerapp/`;
fs.mkdirSync(SCREENS, { recursive: true });
if (!fs.existsSync(path.join(ROOT, OUT_DIR, 'index.html'))) {
  console.error(`No ${OUT_DIR}/ build found. Run "npm test" (or "npm run build:test" first).`);
  process.exit(1);
}

const viteBin = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
const server = spawn(viteBin, ['preview', '--outDir', OUT_DIR, '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'pipe',
});
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes('localhost') && res());
  server.on('exit', (code) => rej(new Error('preview server exited with ' + code)));
  setTimeout(() => rej(new Error('server did not start')), 15000);
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
ctx.setDefaultTimeout(8000);

// Collect uncaught errors, console errors and CSP violations from every page.
const errors = [];
let allowNetworkErrors = false; // while offline, the browser logs failed update checks
async function watch(p, label) {
  p.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (allowNetworkErrors && /ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/.test(t)) return;
    errors.push(`[${label}] console: ${t}`);
  });
  await p.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`)
    );
  });
  return p;
}

const page = await watch(await ctx.newPage(), 'main');
let step = 0;
const shotOf = (p, name) =>
  p.screenshot({ path: path.join(SCREENS, `${String(++step).padStart(2, '0')}-${name}.png`), fullPage: true });
const shot = (name) => shotOf(page, name);
const ok = (msg) => console.log('  ✓', msg);
const rowsOf = (p) => p.locator('.list li .text').allTextContents();
const rows = () => rowsOf(page);
const DAY = 86400000;
const setClock = (offsetDays) =>
  page.evaluate((ms) => localStorage.setItem('prayer.now', new Date(Date.now() + ms).toISOString()), offsetDays * DAY);
const toastText = (p, text) => p.locator('.toast', { hasText: text }).waitFor();

try {
  // 1. First run
  await page.goto(BASE);
  await page.getByText('No requests yet.').waitFor();
  await shot('empty');
  ok('first run shows empty list');

  // 2. Siri capture
  await page.goto(BASE + '?add=' + encodeURIComponent('  Anthropic dev team  '));
  await page.getByText('Added to prayer list').waitFor();
  assert.deepEqual(await rows(), ['Anthropic dev team']);
  assert.equal(new URL(page.url()).search, '');
  await shot('siri-capture');
  await page.reload();
  await page.locator('.list li').first().waitFor();
  assert.equal((await rows()).length, 1);
  ok('?add= saves to Unsorted, strips the param, no duplicate on refresh');
  await page.goto(BASE + '?add=%20%20');
  await page.locator('.list li').first().waitFor();
  assert.equal((await rows()).length, 1);
  ok('empty ?add= ignored');

  // 3. Quick add with a section
  await page.getByLabel('Add prayer request').click();
  const input = page.getByPlaceholder(/Who and what/);
  assert.equal(await page.evaluate(() => document.activeElement?.placeholder), await input.getAttribute('placeholder'));
  await input.fill("Mom's surgery Thursday");
  await page.locator('.quickadd .chip', { hasText: 'Family' }).click();
  await shot('quick-add');
  await input.press('Enter');
  await page.locator('.group h3', { hasText: 'Family' }).waitFor();
  ok('quick add focuses the field, saves with Enter into chosen section');
  await page.getByLabel('Add prayer request').click();
  await input.fill('Pastor Jim, sermon prep');
  await page.locator('.quickadd .chip', { hasText: 'Church' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('.group h3', { hasText: 'Church' }).waitFor();
  const headings = await page.locator('.group h3').allTextContents();
  assert.deepEqual(headings, ['Unsorted', 'Family', 'Church']);
  ok('Unsorted first, then sections in order');
  // Quick Add: Escape closes and focus returns to the + button
  await page.getByLabel('Add prayer request').click();
  await input.fill('typed then cancelled');
  await page.keyboard.press('Escape');
  await page.locator('.quickadd.open').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Add prayer request');
  assert.equal((await rows()).length, 3);
  ok('Escape closes Quick Add without saving; focus returns to +');

  // 4. Mark prayed + note
  const momRow = page.locator('.list li', { hasText: "Mom's surgery" });
  await momRow.getByLabel('Mark prayed').click();
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.locator('.sheet textarea').fill('Surgeon is Dr. Lee. Pray for steady hands.');
  await page.getByRole('button', { name: 'Save' }).click();
  await assertText(momRow, '1× · today');
  assert.equal(await momRow.getAttribute('class'), 'done');
  await shot('prayed');
  ok('one tap marks prayed; Add note link saves a note');

  // tapping again same day undoes — and a second tab follows along without reloading
  const other = await watch(await ctx.newPage(), 'other-tab');
  await other.goto(BASE + '#/today');
  await other.locator('.list li').first().waitFor();
  const devRow = page.locator('.list li', { hasText: 'Anthropic dev team' });
  const otherDevRow = other.locator('.list li', { hasText: 'Anthropic dev team' });
  await assertText(otherDevRow, 'not yet prayed');
  await devRow.getByLabel('Mark prayed').click();
  await assertText(devRow, '1× · today');
  await assertText(otherDevRow, '1× · today');
  ok('other open tab updates without reload (BroadcastChannel)');
  await devRow.getByLabel(/Prayed today/).click();
  await assertText(devRow, 'not yet prayed');
  await assertText(otherDevRow, 'not yet prayed');
  ok('second tap same day undoes');
  await assertText(page.locator('.sub'), '1 of 3 prayed');
  // and the other way round: add in the second tab, the first shows it
  await other.getByLabel('Add prayer request').click();
  await other.getByPlaceholder(/Who and what/).fill('Added in another tab');
  await other.getByPlaceholder(/Who and what/).press('Enter');
  await page.locator('.list li', { hasText: 'Added in another tab' }).waitFor();
  ok('request added in another tab appears here');
  await page.locator('.list li', { hasText: 'Added in another tab' }).locator('.item').click();
  await page.getByRole('button', { name: 'Delete request' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await other.locator('.list li', { hasText: 'Added in another tab' }).waitFor({ state: 'detached' });
  await other.close();

  // 5. Detail: note shown, Prayed toggle, sheets
  await momRow.locator('.item').click();
  await page.getByText('Surgeon is Dr. Lee').waitFor();
  await page.getByText('after prayer').waitFor();
  await page.getByText('Prayed 1 time').waitFor();
  await page.getByRole('button', { name: 'Prayed today (tap to undo)' }).waitFor();
  await shot('detail');
  ok('detail shows note thread and prayer history');
  await page.getByRole('button', { name: 'Prayed today (tap to undo)' }).click();
  await page.getByText('Prayed 0 times').waitFor();
  await page.getByRole('button', { name: 'Mark prayed' }).click();
  await page.getByText('Prayed 1 time').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Prayed today (tap to undo)' }).getAttribute('aria-pressed'), 'true');
  ok('detail Prayed button toggles like Today (undo, then log again)');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.locator('.sheet textarea').waitFor();
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // textarea → Cancel → Save → wraps to textarea
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.backdrop:not(.quickadd) .sheet')), true);
  await page.keyboard.press('Escape');
  await page.locator('.backdrop:not(.quickadd)').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.textContent === 'Add note');
  ok('sheet: focus stays inside, Escape closes, focus returns to the trigger');

  // 6. Expiry banner (clock +25 days), extend
  await setClock(25);
  await page.goto(BASE + '#/today');
  await page.reload();
  await page.getByText('3 requests expiring soon').click();
  await shot('expiring');
  await page.locator('.expiring li', { hasText: 'Pastor Jim' }).getByRole('button', { name: 'Extend' }).click();
  await page.getByText('2 requests expiring soon').waitFor();
  ok('expiring-soon banner; Extend resets expiry');

  // Answered from banner
  await page.locator('.expiring li', { hasText: "Mom's surgery" }).getByRole('button', { name: 'Answered' }).click();
  await page.locator('.sheet textarea').fill('Surgery went well; home in two days.');
  await page.getByRole('button', { name: 'Mark answered' }).click();
  await page.getByText('1 request expiring soon').waitFor();
  assert.ok(!(await rows()).includes("Mom's surgery Thursday"));
  ok('Answered with note removes it from the list');

  // 7. Expiry sweep (clock +40 days)
  await setClock(40);
  await page.reload();
  await page.locator('.list li').first().waitFor();
  assert.deepEqual(await rows(), ['Pastor Jim, sermon prep']);
  ok('expiry sweep on open moves unextended requests to the archive');

  // 8. Archive
  await page.getByRole('link', { name: 'Archive' }).click();
  await page.getByText('Surgery went well').waitFor();
  await page.getByText('1 answered').waitFor();
  await page.getByText('prayed 1×').waitFor();
  await shot('archive');
  await page.locator('.archive .chip', { hasText: 'Expired' }).click();
  assert.deepEqual(await rows(), ['Anthropic dev team']);
  await page.locator('.archive-list .item').first().click();
  await page.getByRole('button', { name: 'Return to list' }).click();
  await page.getByText('Back on the list').waitFor();
  ok('archive filters; expired request can be returned to the list');

  // 9. Sections: reorder, never-expires, editing isn't clobbered by refreshes
  await page.goto(BASE + '#/settings');
  await page.getByLabel('Move Church up').click();
  await page.waitForFunction(() => document.querySelectorAll('.sec-name')[0].value === 'Church');
  const names = await page.locator('.sec-name').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(names.slice(0, 2), ['Church', 'Family']);
  await page.locator('.sections li').first().getByLabel('Never expires').check();
  await page.getByText(/Storage: (protected|not protected|unknown)\./).waitFor();
  await shot('settings');
  const famInput = page.locator('.sec-name').nth(1);
  await famInput.click();
  await famInput.fill('Family & kin');
  await page.evaluate(() => new BroadcastChannel('prayerapp-changes').postMessage('changed')); // background refresh
  await page.waitForTimeout(200);
  assert.equal(await famInput.inputValue(), 'Family & kin');
  await famInput.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.sec-name')[1].value === 'Family & kin');
  const days = page.getByLabel('Default expiry days');
  await days.fill('45');
  await page.evaluate(() => new BroadcastChannel('prayerapp-changes').postMessage('changed'));
  await page.waitForTimeout(200);
  assert.equal(await days.inputValue(), '45');
  await days.blur();
  await days.fill('0'); // invalid: reverts
  await days.blur();
  await page.waitForFunction(() => document.querySelector('[aria-label="Default expiry days"]').value === '45');
  await page.getByLabel('Default expiry days').fill('30');
  await page.getByLabel('Default expiry days').press('Enter');
  ok('settings fields keep typing through refreshes; save on Enter/blur; invalid number reverts');
  await page.goto(BASE + '#/today');
  await page.locator('.group h3').first().waitFor();
  assert.deepEqual(await page.locator('.group h3').allTextContents(), ['Unsorted', 'Church']);
  await page.locator('.list li', { hasText: 'Pastor Jim' }).locator('.item').click();
  await page.getByText('Never expires').waitFor();
  ok('section reorder reflected on Today; never-expires clears expiry');
  await page.goto(BASE + '#/today');

  // 10. Export → wipe → import (bad files rejected, undo works)
  await page.goto(BASE + '#/settings');
  await page.getByText('No backup yet.').waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
  const file = path.join(SCREENS, 'backup.json');
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(backup.app, 'prayerapp');
  assert.ok(dl.suggestedFilename().startsWith('prayer-list-'));
  assert.ok(backup.settings.every((s) => s.id === 'settings'), 'device id is not exported');
  await page.getByText(/Last backup/).waitFor();
  ok(`export downloads ${dl.suggestedFilename()} (${backup.requests.length} requests, ${backup.notes.length} notes)`);

  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('prayerapp'); q.onsuccess = q.onerror = q.onblocked = r; }));
  const page2 = await watch(await ctx.newPage(), 'page2');
  await page.close();
  await page2.goto(BASE);
  await page2.getByText('No requests yet.').waitFor();
  await page2.goto(BASE + '#/settings');

  const fileInput = page2.locator('input[type=file]');
  await fileInput.setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  await toastText(page2, 'not a Prayer List backup. Nothing was changed.');
  const damaged = { ...backup, requests: [{ ...backup.requests[0], status: 'maybe' }] };
  await fileInput.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(damaged)) });
  await toastText(page2, 'unknown status. Nothing was changed.');
  await shotOf(page2, 'import-rejected');
  assert.equal(await page2.locator('.backdrop:not(.quickadd)').count(), 0);
  ok('bad backup files are rejected with a clear message and no changes');

  await fileInput.setInputFiles(file);
  await page2.getByText(/has 3 requests \(2 on the list, 1 answered\), 1 prayer logged, 1 note and 5 sections/).waitFor();
  await shotOf(page2, 'import-confirm');
  await page2.getByRole('button', { name: 'Replace' }).click();
  await page2.getByText('Backup restored').waitFor();
  await page2.locator('.toast').getByRole('button', { name: 'Undo' }).waitFor();
  ok('import confirm shows counts; restore offers Undo');
  // Undo from Settings
  await page2.getByRole('button', { name: 'Undo import' }).click();
  await page2.locator('.sheet').getByRole('button', { name: 'Undo import' }).click();
  await page2.getByText('Import undone').waitFor();
  await page2.goto(BASE + '#/today');
  await page2.getByText('No requests yet.').waitFor();
  ok('Undo import puts back the list as it was before');
  await page2.goto(BASE + '#/settings');
  await fileInput.setInputFiles(file);
  await page2.getByRole('button', { name: 'Replace' }).click();
  await page2.getByText('Backup restored').waitFor();
  await page2.goto(BASE + '#/archive');
  await page2.getByText('Surgery went well').waitFor();
  await page2.goto(BASE + '#/today');
  await page2.locator('.list li').first().waitFor();
  assert.equal(await page2.locator('.list li').count(), 2);
  await shotOf(page2, 'restored');
  ok('wipe + import restores list, archive and notes');

  // 11. Offline: the service worker serves the whole app after a single online visit
  await page2.evaluate(() => navigator.serviceWorker.ready);
  await page2.waitForFunction(() => !!navigator.serviceWorker.controller);
  allowNetworkErrors = true;
  await ctx.setOffline(true);
  await page2.reload();
  await page2.locator('.list li').first().waitFor();
  assert.equal(await page2.locator('.list li').count(), 2);
  ok('offline reload renders the list from the cache');
  await page2.goto(BASE + '?add=' + encodeURIComponent('Prayed for while offline'));
  await page2.getByText('Added to prayer list').waitFor();
  assert.equal(await page2.locator('.list li').count(), 3);
  assert.equal(new URL(page2.url()).search, '');
  ok('?add= works offline (served from cache, param still processed)');
  await shotOf(page2, 'offline');
  await ctx.setOffline(false);
  allowNetworkErrors = false;

  // dark mode screenshots
  await page2.emulateMedia({ colorScheme: 'dark' });
  await shotOf(page2, 'dark-today');
  await page2.goto(BASE + '#/settings');
  await page2.getByText(/Storage:/).waitFor();
  await shotOf(page2, 'dark-settings');
  await page2.goto(BASE + '#/archive');
  await page2.getByText('Surgery went well').waitFor();
  await shotOf(page2, 'dark-archive');

  // 12. Startup failure: storage won't open → plain error screen with Try again / Import backup
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const broken = await ctx2.newPage();
  await broken.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException('The operation failed for reasons unrelated to the database itself', 'UnknownError');
    };
  });
  await broken.goto(BASE);
  await broken.getByText('Your prayer list couldn’t be opened.').waitFor();
  await broken.getByRole('button', { name: 'Try again' }).waitFor();
  await broken.getByRole('button', { name: 'Import backup' }).waitFor();
  await shotOf(broken, 'boot-error');
  await ctx2.close();
  ok('storage failure shows an error screen with Try again and Import backup');

  assert.deepEqual(errors, []);
  ok('no console errors or CSP violations');
  console.log('\nAll tests passed.');
} catch (e) {
  console.error('\nFAILED:', e.message);
  if (errors.length) console.error('Errors seen:\n  ' + errors.join('\n  '));
  for (const p of ctx.pages()) {
    await p.screenshot({ path: path.join(SCREENS, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}

async function assertText(loc, text) {
  await loc.filter({ hasText: text }).first().waitFor({ timeout: 3000 });
}
