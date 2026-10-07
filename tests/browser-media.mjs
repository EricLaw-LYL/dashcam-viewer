import { chromium } from '@playwright/test';
import { requiredInput, requiredMediaInputs } from './local-inputs.mjs';
const paths = requiredMediaInputs();
const gpsFile = requiredInput('GPS_FILE');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1050 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200));
});
await page.goto('http://127.0.0.1:5173');
await page.locator('input[type=file]').nth(1).setInputFiles(paths);
await page.waitForFunction(() => document.querySelectorAll('video').length === 3);
await page.waitForTimeout(2500);
console.log(
  'MEDIA',
  await page.locator('video').evaluateAll((v) =>
    v.map((x) => ({
      ready: x.readyState,
      duration: x.duration,
      width: x.videoWidth,
      error: x.error?.message,
    })),
  ),
);
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(2500);
console.log(
  'SYNC',
  await page
    .locator('video')
    .evaluateAll((v) => v.map((x) => ({ time: x.currentTime, paused: x.paused }))),
);
await page.getByRole('button', { name: 'Pause', exact: true }).click();
await page.locator('input[type=file]').nth(2).setInputFiles(gpsFile);
await page.getByText(/GPS saved locally:/).waitFor({ timeout: 180000 });
console.log('IMPORT', await page.locator('.toast').innerText());
await page.getByRole('button', { name: 'GPS Analytics' }).click();
await page.locator('.metric-grid').first().waitFor({ timeout: 180000 });
await page.waitForTimeout(1500);
console.log('METRICS', await page.locator('.metric-grid').first().innerText());
await page.screenshot({ path: '/private/tmp/dashcam-analytics.png', fullPage: true });
await page.getByRole('button', { name: 'Footage Viewer', exact: false }).click();
await page.getByLabel('Out', { exact: true }).fill('2');
await page.getByRole('button', { name: 'Add range to export' }).click();
await page.getByRole('button', { name: 'Export Studio' }).click();
await page.getByLabel('Export audio', { exact: true }).selectOption('mute');
// Exercise the bounded download fallback to avoid an OS save dialog in the automated test.
await page.evaluate(() => {
  window.showSaveFilePicker = undefined;
});
const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
await page.getByRole('button', { name: 'Export video' }).click();
try {
  const d = await downloadPromise;
  await d.saveAs('/private/tmp/dashcam-test-export.mp4');
  console.log('EXPORT saved');
} catch (e) {
  console.log('EXPORT RESULT', await page.locator('.export-settings').innerText());
}
console.log('ERRORS', errors);
await browser.close();
