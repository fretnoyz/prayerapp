// End-to-end test in an iPhone-sized viewport. Run: npm run build && npm test
import { chromium, devices } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import assert from 'assert/strict';

const PORT = 4179;
const BASE = `http://localhost:${PORT}/prayerapp/`;
fs.mkdirSync('tests/screens', { recursive: true });

const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes('localhost') && res());
  setTimeout(() => rej(new Error('server did not start')), 15000);
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
ctx.setDefaultTimeout(8000);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let step = 0;
const shot = (name) => page.screenshot({ path: `tests/screens/${String(++step).padStart(2, '0')}-${name}.png`, fullPage: true });
const ok = (msg) => console.log('  ✓', msg);
const rows = () => page.locator('.list li .text').allTextContents();
const DAY = 86400000;
const setClock = (offsetDays) =>
  page.evaluate((ms) => localStorage.setItem('prayer.now', new Date(Date.now() + ms).toISOString()), offsetDays * DAY);

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
  // tapping again same day undoes
  const devRow = page.locator('.list li', { hasText: 'Anthropic dev team' });
  await devRow.getByLabel('Mark prayed').click();
  await assertText(devRow, '1× · today');
  await devRow.getByLabel(/Prayed today/).click();
  await assertText(devRow, 'not yet prayed');
  ok('second tap same day undoes');
  await assertText(page.locator('.sub'), '1 of 3 prayed');

  // 5. Detail: note shown, extend, answered
  await momRow.locator('.item').click();
  await page.getByText('Surgeon is Dr. Lee').waitFor();
  await page.getByText('after prayer').waitFor();
  await page.getByText('Prayed 1 time').waitFor();
  await shot('detail');
  ok('detail shows note thread and prayer history');

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
  await shot('archive');
  await page.locator('.archive .chip', { hasText: 'Expired' }).click();
  assert.deepEqual(await rows(), ['Anthropic dev team']);
  await page.locator('.archive-list .item').first().click();
  await page.getByRole('button', { name: 'Return to list' }).click();
  await page.getByText('Back on the list').waitFor();
  ok('archive filters; expired request can be returned to the list');

  // 9. Sections: reorder, never-expires
  await page.goto(BASE + '#/settings');
  await page.getByLabel('Move Church up').click();
  await page.waitForFunction(() => document.querySelectorAll('.sec-name')[0].value === 'Church');
  const names = await page.locator('.sec-name').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(names.slice(0, 2), ['Church', 'Family']);
  await page.locator('.sections li').first().getByLabel('Never expires').check();
  await shot('settings');
  await page.goto(BASE + '#/today');
  await page.locator('.group h3').first().waitFor();
  assert.deepEqual(await page.locator('.group h3').allTextContents(), ['Unsorted', 'Church']);
  await page.locator('.list li', { hasText: 'Pastor Jim' }).locator('.item').click();
  await page.getByText('Never expires').waitFor();
  ok('section reorder reflected on Today; never-expires clears expiry');
  await page.goto(BASE + '#/today');

  // 10. Export → wipe → import
  await page.goto(BASE + '#/settings');
  await page.getByText('No backup yet.').waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
  const file = 'tests/screens/backup.json';
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(backup.app, 'prayerapp');
  assert.ok(dl.suggestedFilename().startsWith('prayer-list-'));
  await page.getByText(/Last backup/).waitFor();
  ok(`export downloads ${dl.suggestedFilename()} (${backup.requests.length} requests, ${backup.notes.length} notes)`);

  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('prayerapp'); q.onsuccess = q.onerror = q.onblocked = r; }));
  const page2 = await ctx.newPage();
  await page.close();
  await page2.goto(BASE);
  await page2.getByText('No requests yet.').waitFor();
  await page2.goto(BASE + '#/settings');
  await page2.locator('input[type=file]').setInputFiles(file);
  await page2.getByRole('button', { name: 'Replace' }).click();
  await page2.getByText('Backup restored').waitFor();
  await page2.goto(BASE + '#/archive');
  await page2.getByText('Surgery went well').waitFor();
  await page2.goto(BASE + '#/today');
  await page2.locator('.list li').first().waitFor();
  assert.equal(await page2.locator('.list li').count(), 2);
  await page2.screenshot({ path: `tests/screens/${String(++step).padStart(2, '0')}-restored.png`, fullPage: true });
  ok('wipe + import restores list, archive and notes');

  // dark mode screenshot
  await page2.emulateMedia({ colorScheme: 'dark' });
  await page2.screenshot({ path: `tests/screens/${String(++step).padStart(2, '0')}-dark.png`, fullPage: true });

  assert.deepEqual(errors, []);
  console.log('\nAll tests passed.');
} catch (e) {
  console.error('\nFAILED:', e.message);
  await page.screenshot({ path: 'tests/screens/failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}

async function assertText(loc, text) {
  await loc.filter({ hasText: text }).first().waitFor({ timeout: 3000 });
}
