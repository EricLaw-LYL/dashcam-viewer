// Isolated layout/cache regression. Requires Chrome, FFmpeg and a running Vite server.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixtureDir = mkdtempSync(join(tmpdir(), 'dashcam-layout-cache-'));
const clip = join(fixtureDir, 'NO20260923-120000-000001F.MP4');
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=blue:s=320x180:r=30:d=4',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  clip,
]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  window.gpsActions = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    postMessage(message, ...args) {
      if (message.action) window.gpsActions.push(message.action);
      return super.postMessage(message, ...args);
    }
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const nav = (name) => page.getByRole('button', { name: new RegExp(name) }).click();
async function footer() {
  const main = await page.locator('main').boundingBox();
  const box = await page.locator('main > footer').boundingBox();
  assert.equal(box.height, 36);
  assert.ok(Math.abs(box.y + box.height - main.y - main.height) < 1);
  assert.ok(box.y + box.height >= (await page.viewportSize()).height);
  return box;
}
async function importGPS(name, offset, count) {
  const rows = ['$V02'];
  for (let i = 0; i < count; i++)
    rows.push(
      `${1790179200 + offset + i},A,${43.8 + i * 0.00001},-79.4,9000,1000,1,2,3,NO20260923-120000-000001F.MP4,0,0,0`,
    );
  await page
    .locator('input[accept=".txt,.csv"]')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n')) });
  await expect(page.locator('.header-notice:visible')).toContainText('GPS saved locally');
}
try {
  await page.goto(process.env.DASHCAM_TEST_URL || 'http://127.0.0.1:5174');
  await page.locator('input[type=file]').nth(1).setInputFiles(clip);
  await expect(page.locator('.video-strip[data-channel="F"] video')).toBeVisible();
  await page.getByRole('button', { name: 'Add range to export' }).click();
  for (const [width, height] of [
    [1440, 1000],
    [1313, 846],
    [1920, 1080],
    [1160, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await nav('Footage Viewer');
    const player = await page.locator('.player-panel').boundingBox();
    const timeline = await page.locator('.day-timeline').boundingBox();
    const journey = await page.locator('.journey-panel').boundingBox();
    const baseFooter = await footer();
    await nav('Export Studio');
    const exportPlayer = await page.locator('.player-panel').boundingBox();
    const exportTimeline = await page.locator('.day-timeline').boundingBox();
    for (const selector of ['.export-settings']) {
      const panel = await page.locator(selector).boundingBox();
      assert.ok(Math.abs(panel.width - journey.width) < 1, `${selector} width at ${width}`);
      assert.equal(panel.x, journey.x);
    }
    const recordings = await page.locator('.export-sequence').boundingBox();
    assert.ok(recordings.x + recordings.width < exportPlayer.x);
    assert.equal(recordings.width, 240);
    assert.ok(
      await page
        .locator('.sequence-item .text-button')
        .evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth)),
    );
    const label = await page.locator('.sequence-item .text-button').first().boundingBox();
    const remove = await page.locator('.sequence-item > .tiny').first().boundingBox();
    assert.ok(label.x + label.width < remove.x);
    assert.equal(recordings.height, (await page.locator('.export-review').boundingBox()).height);
    assert.equal(exportPlayer.x, player.x);
    assert.equal(exportPlayer.width, player.width);
    assert.equal(exportPlayer.y, player.y);
    assert.equal(exportPlayer.height, player.height);
    assert.equal(exportTimeline.y, timeline.y);
    assert.equal(exportTimeline.height, timeline.height);
    assert.deepEqual(await footer(), baseFooter);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await importGPS('GPSData-first.txt', 0, 20);
  await nav('GPS Analytics');
  const cache = page.locator('.analytics-cache');
  await expect(cache.getByText('IMPORTED OBSERVATIONS', { exact: true })).toBeVisible();
  await expect(cache.locator('.chart canvas').first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.gpsActions.filter((a) => a === 'analyze').length))
    .toBe(1);
  await cache.getByLabel('Distribution weighting').selectOption('time');
  const chart = cache.locator('.chart canvas').first();
  await chart.evaluate((el) => {
    window.retainedChart = el;
  });
  const count = await page.evaluate(() => window.gpsActions.length);
  for (const destination of ['Footage Viewer', 'Export Studio']) {
    await nav(destination);
    await expect(cache).toBeHidden();
    await nav('GPS Analytics');
    await expect(cache.getByLabel('Distribution weighting')).toHaveValue('time');
    assert.ok(await chart.evaluate((el) => el === window.retainedChart));
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.gpsActions.length), count);
    await expect(cache.getByText('Calculating GPS analytics…', { exact: true })).toHaveCount(0);
  }
  await footer();
  // A real data change must refresh the retained result, even while the page is hidden.
  await nav('Footage Viewer');
  await importGPS('GPSData-second.txt', 100, 5);
  await expect
    .poll(() => page.evaluate(() => window.gpsActions.filter((a) => a === 'analyze').length))
    .toBe(2);
  await nav('GPS Analytics');
  await expect(cache.getByLabel('Distribution weighting')).toHaveValue('time');
  await expect(cache.locator('.analytics-kpis')).toContainText('25');
  await page.setViewportSize({ width: 650, height: 900 });
  for (const name of ['Footage Viewer', 'GPS Analytics', 'Export Studio']) {
    await nav(name);
    await footer();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS fixed bottom footer, matching Journey/Export widths and review heights, retained Analytics DOM/results/settings, refresh on new GPS, narrow layouts',
  );
} finally {
  await context.close();
  await browser.close();
}
