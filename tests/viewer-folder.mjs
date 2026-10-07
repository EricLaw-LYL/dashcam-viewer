import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { requiredInput } from './local-inputs.mjs';
const root = requiredInput('DASHCAM_FOLDER', true);
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}
const all = walk(root).filter((p) => /\.mp4$/i.test(p));
const recognized = all.filter((p) =>
  /^(NO|EV|EM|PA|LA)\d{8}-\d{6}-\d+[FRCB]\.MP4$/i.test(p.split('/').at(-1)),
);
const expected = new Set(recognized.map((p) => p.split('/').at(-1).slice(0, -5))).size;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1050 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5174');
  const start = Date.now();
  await page.locator('input[webkitdirectory]').setInputFiles(root);
  await expect(page.locator('video')).toHaveCount(3, { timeout: 120000 });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('video')].every((v) => v.readyState >= 2 && v.videoWidth > 0),
    {},
    { timeout: 120000 },
  );
  console.log('LOADED', Date.now() - start, 'ms', recognized.length, 'files', expected, 'groups');
  console.log(
    'SIDEBAR',
    await page
      .locator('.source-card')
      .innerText()
      .catch(() => page.locator('aside').innerText()),
  );
  console.log(
    'MEDIA',
    await page.locator('video').evaluateAll((v) =>
      v.map((x) => ({
        width: x.videoWidth,
        height: x.videoHeight,
        duration: x.duration,
        error: x.error?.message,
      })),
    ),
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(3000);
  let times = await page.locator('video').evaluateAll((v) => v.map((x) => x.currentTime));
  assert(Math.min(...times) > 1);
  assert(Math.max(...times) - Math.min(...times) < 0.4);
  console.log('PLAY', times);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByLabel('Seek recording').fill('30');
  await page.getByLabel('Seek recording').dispatchEvent('input');
  await expect
    .poll(() =>
      page.locator('video').evaluateAll((v) => v.every((x) => Math.abs(x.currentTime - 30) < 0.5)),
    )
    .toBe(true);
  console.log('PASS seek all channels');
  await expect(page.getByLabel('Playback speed').locator('option')).toHaveCount(11);
  await page.getByLabel('Volume', { exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'Focus Rear', exact: true }).click();
  await page.getByLabel('Playback speed').selectOption('16');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(500);
  const focused = await page
    .locator('video')
    .evaluateAll((v) =>
      v.map((x) => ({ muted: x.muted, volume: x.volume, paused: x.paused, rate: x.playbackRate })),
    );
  assert.equal(focused[1].muted, false);
  assert.equal(focused[1].volume, 0.4);
  assert.equal(focused[1].paused, false);
  assert.equal(focused[0].muted, true);
  assert(focused[1].rate <= 16);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByLabel('Playback speed').selectOption('1');
  await page.getByRole('button', { name: 'Focus Rear', exact: true }).click();
  await expect(page.locator('.timeline-panel')).toHaveCount(0);
  await expect(page.locator('.single-day-track')).toHaveCount(1);
  await page.getByRole('button', { name: 'Zoom in timeline' }).click();
  await expect(page.getByLabel('Timeline zoom')).toHaveValue('2');
  await expect(page.getByLabel('Current playback timestamp')).not.toContainText('No recording');
  await page.getByRole('button', { name: 'Recording calendar' }).click();
  assert((await page.locator('.calendar-grid .has-footage').count()) > 0);
  await page.getByRole('button', { name: '2026-09-23, footage available', exact: true }).click();
  console.log('PASS speeds, front audio in rear focus, volume, calendar and single timeline');

  await expect(page.locator('.toast')).toContainText('GPS saved locally', { timeout: 180000 });
  console.log('GPS', await page.locator('.toast').innerText());
  await expect(page.locator('.journey-status')).toContainText('GPS fixes loaded', {
    timeout: 120000,
  });
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  assert(
    (await page.locator('.map').boundingBox()).height >= 180,
    'Map container must have visible height',
  );
  await expect(page.getByRole('button', { name: 'Enable online basemap' })).toHaveCount(0);
  await expect(page.locator('.journey-status')).toContainText(
    'correction from matching recordings',
    { timeout: 120000 },
  );
  await page.locator('.segmented').getByRole('button', { name: 'Normal', exact: true }).click();
  await page.locator('.clip-row').first().click();
  await page.getByLabel('Seek recording').fill('60');
  await page.getByLabel('Seek recording').dispatchEvent('input');
  await expect(page.locator('.journey-stats strong').first()).not.toContainText('—', {
    timeout: 30000,
  });
  console.log(
    'JOURNEY',
    await page.locator('.journey-status').innerText(),
    'SPEED',
    await page.locator('.journey-stats strong').first().innerText(),
  );
  for (const type of ['Normal', 'Event', 'Parking', 'Lapse', 'All footage']) {
    await page.locator('.segmented').getByRole('button', { name: type, exact: true }).click();
    if (await page.locator('.clip-row').count()) {
      await page.locator('.clip-row').first().click();
      await page.waitForTimeout(500);
    }
  }
  await page.screenshot({ path: '/private/tmp/dashcam-viewer-card.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS folder selection, playback, seek, filters, automatic GPS import, no page errors',
  );
} catch (e) {
  console.log('UI', (await page.locator('main').innerText()).slice(0, 7000));
  throw e;
} finally {
  await browser.close();
}
