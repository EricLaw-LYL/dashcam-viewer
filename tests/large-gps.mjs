import { chromium, expect } from '@playwright/test';
import { requiredInput } from './local-inputs.mjs';
const gpsFile = requiredInput('GPS_FILE');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERROR', e.message));
const start = Date.now();
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) console.log('NAVIGATION', f.url());
});
page.on('crash', () => console.log('PAGE CRASH'));
try {
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: 'GPS Analytics' }).click();
  await page.locator('input[type=file]').nth(2).setInputFiles(gpsFile);
  const timer = setInterval(
    async () =>
      console.log(
        'PROGRESS',
        Math.round((Date.now() - start) / 1000),
        await page
          .locator('.working')
          .innerText()
          .catch(() => ''),
      ),
    20000,
  );
  try {
    await expect(page.locator('.toast')).toContainText('GPS saved locally', { timeout: 360000 });
    console.log(
      'IMPORTED',
      Math.round((Date.now() - start) / 1000),
      await page.locator('.toast').innerText(),
    );
    await expect(page.locator('.metric-grid').first()).toBeVisible({ timeout: 300000 });
    console.log(
      'ANALYSIS',
      Math.round((Date.now() - start) / 1000),
      await page.locator('.metric-grid').first().innerText(),
    );
    console.log('STORAGE', await page.evaluate(() => navigator.storage.estimate()));
    const reload = Date.now();
    await page.reload();
    await expect(page.locator('.metric-grid').first()).toBeVisible({ timeout: 30000 });
    console.log('CACHED REOPEN MS', Date.now() - reload);
  } finally {
    clearInterval(timer);
  }
} catch (error) {
  console.log('FAILURE UI', await page.locator('main').innerText());
  console.log('STORAGE', await page.evaluate(() => navigator.storage.estimate()));
  throw error;
} finally {
  await browser.close();
}
