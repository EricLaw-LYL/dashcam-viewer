import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const row = (s, lat = 43.8) =>
  `${1790179200 + s},A,${lat},-79.4,9000,1000,1,2,3,NO20260923-120000-000001F.MP44,0,0,0`;
const file = (name, lines) => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(['$V02', ...lines].join('\n')),
});
async function snapshot() {
  return page.evaluate(async () => {
    const db = await new Promise((ok, no) => {
      const r = indexedDB.open('dashcam-local');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    const read = (s) =>
      new Promise((ok, no) => {
        const r = db.transaction(s).objectStore(s).getAll();
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
      });
    const points = await read('points'),
      imports = await read('imports');
    db.close();
    return { points, imports };
  });
}
async function importFiles(files) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import GPS / CSV', exact: true }).click();
  await (await chooser).setFiles(files);
  await expect(page.locator('.toast')).toContainText('GPS saved locally', { timeout: 15000 });
}
async function confirmButton(button, accept) {
  page.once('dialog', (d) => (accept ? d.accept() : d.dismiss()));
  await button.click();
}
try {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('button', { name: /Library & settings/ }).click();
  await page.getByLabel('Device / library').fill('Button-test');
  await importFiles([
    file('GPSData000001.txt', [row(0), row(1), 'invalid row']),
    file('GPSData000002.txt', [row(1), row(2)]),
  ]);
  let state = await snapshot();
  assert.equal(state.points.length, 3);
  assert.equal(state.imports.length, 2);
  console.log('PASS imports all numbered files and deduplicates overlap');
  assert.deepEqual(
    state.imports.map((s) => ({ name: s.name, rejected: s.rejected, added: s.added })),
    [
      { name: 'GPSData000001.txt', rejected: 1, added: 2 },
      { name: 'GPSData000002.txt', rejected: 0, added: 1 },
    ],
  );
  console.log('PASS per-file import counts');
  await page.evaluate(() => (window.showSaveFilePicker = undefined));
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up GPS history', exact: true }).click();
  const download = await downloaded;
  await download.saveAs('/private/tmp/gps-button-test.ndjson');
  const contents = (await readFile('/private/tmp/gps-button-test.ndjson', 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(contents[0].version, 2);
  assert.equal(contents.length, 4);
  console.log('PASS backup contains library metadata and all three observations');
  const first = () =>
    page
      .locator('tr')
      .filter({ hasText: 'GPSData000001.txt' })
      .getByRole('button', { name: 'Remove source' });
  await confirmButton(first(), false);
  assert.equal((await snapshot()).points.length, 3);
  await confirmButton(first(), true);
  await expect.poll(async () => (await snapshot()).points.length).toBe(2);
  state = await snapshot();
  assert.deepEqual(
    state.points.map((p) => p.timestamp),
    [1790179201, 1790179202],
  );
  console.log('PASS remove-source cancellation and deletion; overlapping observations retained');
  const del = page.getByRole('button', { name: 'Delete this GPS history', exact: true });
  await confirmButton(del, false);
  assert.equal((await snapshot()).points.length, 2);
  await confirmButton(del, true);
  await expect.poll(async () => (await snapshot()).points.length).toBe(0);
  assert.equal((await snapshot()).imports.length, 0);
  console.log('PASS delete-history cancellation and deletion');
  async function restore() {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await (await chooser).setFiles('/private/tmp/gps-button-test.ndjson');
    await expect(page.locator('.toast')).toContainText('GPS backup restored');
    await expect.poll(async () => (await snapshot()).points.length).toBe(3);
  }
  await restore();
  state = await snapshot();
  assert.equal(state.imports[0].status, 'complete');
  assert.deepEqual(
    state.points.map((p) => p.timestamp),
    [1790179200, 1790179201, 1790179202],
  );
  await page.reload();
  await expect(page.getByRole('button', { name: /Library & settings/ })).toBeVisible();
  assert.equal((await snapshot()).points.length, 3);
  console.log('PASS restore round-trip and persistence after reload');
  await page.getByRole('button', { name: /Library & settings/ }).click();
  await restore();
  assert.equal((await snapshot()).points.length, 3);
  console.log('PASS repeated restore does not duplicate observations');
  await page.getByLabel('Device / library').fill('Other-test');
  await importFiles([file('GPSData000003.txt', [row(9)])]);
  await confirmButton(del, true);
  await expect.poll(async () => (await snapshot()).points.length).toBe(3);
  assert.ok((await snapshot()).points.every((p) => p.library === 'Button-test'));
  console.log('PASS deletion leaves other libraries untouched');
  assert.deepEqual(errors, []);
  console.log('PASS no browser errors');
} finally {
  await browser.close();
}
