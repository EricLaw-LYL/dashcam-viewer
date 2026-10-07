import { chromium } from '@playwright/test';
import { requiredMediaInputs } from './local-inputs.mjs';
const paths = requiredMediaInputs();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1050 } });
page.on('pageerror', (e) => console.log('ERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200));
});
await page.goto('http://127.0.0.1:4173');
await page.locator('input[type=file]').nth(1).setInputFiles(paths);
await page.waitForTimeout(6000);
console.log('AFTER IMPORT', (await page.locator('main').innerText()).slice(0, 2000));
console.log(
  'VIDEOS',
  await page
    .locator('video')
    .evaluateAll((v) =>
      v.map((x) => ({ ready: x.readyState, duration: x.duration, error: x.error?.message })),
    ),
);
await page.getByLabel('Out', { exact: true }).fill('2');
await page.getByRole('button', { name: 'Add range to export' }).click();
await page.getByRole('button', { name: 'Export Studio' }).click();
await page.waitForTimeout(1000);
console.log('BODY', (await page.locator('main').innerText()).slice(-4500));
await page.screenshot({ path: '/private/tmp/dashcam-export-ui.png', fullPage: true });
await page.getByLabel('Export audio', { exact: true }).selectOption('F');
await page.evaluate(() => (window.showSaveFilePicker = undefined));
const dPromise = page.waitForEvent('download', { timeout: 90000 });
await page.getByRole('button', { name: 'Export video' }).click();
try {
  const d = await dPromise;
  await d.saveAs('/private/tmp/dashcam-test-export-audio.mp4');
  console.log('EXPORT SAVED');
} catch {
  console.log('RESULT', await page.locator('.export-settings').innerText());
}
await browser.close();
