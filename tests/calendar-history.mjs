import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1313, height: 846 } });
try {
  await page.goto('http://127.0.0.1:5174');
  const rows = ['$V02'];
  for (let d = 0; d < 60; d++)
    for (let s = 0; s < 4; s++)
      rows.push(
        `${1784995200 + d * 86400 + s},A,${43.8 + s * 0.0001},${-79.4 + s * 0.0001},9000,${1000 + d * 10},1,2,3,NO20260725-120000-000001F.MP44,0,0,0`,
      );
  await page.locator('input[accept=".txt,.csv"]').setInputFiles({
    name: 'GPSData-history.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(rows.join('\n')),
  });
  await expect(page.locator('.toast')).toContainText('Open GPS Analytics', { timeout: 30000 });
  await page.getByRole('button', { name: 'GPS Analytics', exact: false }).click();
  const cal = page.locator('.driving-calendar-scroll');
  await expect(cal).toBeVisible({ timeout: 30000 });
  await expect
    .poll(() => cal.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop))
    .toBeLessThan(2);
  assert.ok(await cal.evaluate((e) => e.scrollHeight > e.clientHeight));
  assert.equal(Math.round((await cal.boundingBox()).height), 351);
  const headings = page.locator('.calendar-weekdays span');
  const cells = page.locator('.driving-calendar .day-cell');
  for (let i = 0; i < 7; i++) {
    const h = await headings.nth(i).boundingBox(),
      c = await cells.nth(i).boundingBox();
    assert.ok(Math.abs(h.x - c.x) < 1 && Math.abs(h.width - c.width) < 1);
  }
  await page
    .locator('.calendar-weekdays')
    .screenshot({ path: '/private/tmp/driving-calendar-headings.png' });
  await cal.hover();
  await page.mouse.wheel(0, -1000);
  await expect.poll(() => cal.evaluate((e) => e.scrollTop)).toBeLessThan(5);
  await page.getByRole('button', { name: 'Distance', exact: true }).click();
  const values = await page.locator('tbody tr td:nth-child(2)').allTextContents();
  assert.ok(values.length >= 60);
  await page.getByRole('switch', { name: /Online map/ }).click();
  for (let i = 0; i < 9; i++)
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.locator('.map-wrap').screenshot({ path: '/private/tmp/dashcam-route-zoomed-out.png' });
  console.log(
    'PASS 60-day calendar starts at latest, scrolls to earliest, daily rows available; zoomed-out map captured',
  );
} finally {
  await browser.close();
}
