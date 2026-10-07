import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1050 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200));
});
await page.goto('http://127.0.0.1:5173');
await page.getByRole('heading', { name: 'Footage Viewer.' }).waitFor();
await page.screenshot({ path: '/private/tmp/dashcam-empty.png', fullPage: true });
console.log('PAGE', await page.title(), 'ERRORS', errors);
await browser.close();
