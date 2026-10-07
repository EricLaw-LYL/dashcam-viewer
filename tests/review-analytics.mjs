import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1401, height: 846 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5174');
  await page.locator('input[webkitdirectory]').setInputFiles('/private/tmp/dashcam-fixtures');
  await expect(page.locator('.toast')).toContainText('Open GPS Analytics', { timeout: 30000 });
  await expect(page.getByLabel('GPS ahead seconds')).toHaveValue('0');
  await expect(page.getByText('CAPTURE TIME', { exact: true })).toHaveCount(0);
  await page.getByLabel('GPS ahead seconds').fill('10');
  await expect(page.locator('.gps-lead output')).toHaveText('+10s');
  const seek = page.getByLabel('Seek recording');
  await seek.hover();
  await expect(page.locator('.timeline-hover')).toHaveText(/\d\d:\d\d/);
  await page.getByRole('button', { name: 'Add range to export' }).click();
  await page.locator('.clip-row').nth(1).click();
  await page.getByRole('button', { name: 'Add range to export' }).click();
  await page.getByRole('button', { name: 'Export Studio', exact: false }).click();
  await expect(page.locator('.review-pane video')).toHaveCount(3);
  await expect(page.getByText('Frame fit', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Include audio')).toBeChecked();
  await page
    .getByRole('group', { name: 'Cabin channel position' })
    .dragTo(page.getByRole('group', { name: 'Rear channel position' }));
  assert.deepEqual(
    await page.locator('.video-strip').evaluateAll((el) => el.map((x) => x.dataset.channel)),
    ['C', 'R', 'F'],
  );
  await page.getByLabel('Trim start').fill('3.5');
  await page.getByLabel('Trim end').fill('4.5');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('.sequence-item').nth(1)).toHaveClass(/selected/);
  await expect
    .poll(() =>
      page
        .locator('video')
        .first()
        .evaluate((v) => v.currentTime),
    )
    .toBeGreaterThan(0.3);
  await page.screenshot({ path: '/private/tmp/dashcam-shared-export.png', fullPage: true });
  await page.evaluate(() => (window.showSaveFilePicker = undefined));
  const download = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('button', { name: 'Export video' }).click();
  await (await download).saveAs('/private/tmp/dashcam-trimmed-review.mp4');
  await page.getByRole('button', { name: 'Footage Viewer', exact: false }).click();
  assert.deepEqual(
    await page.locator('.video-strip').evaluateAll((el) => el.map((x) => x.dataset.channel)),
    ['C', 'R', 'F'],
  );
  await page.getByRole('button', { name: 'GPS Analytics', exact: false }).click();
  await expect(page.getByText('IMPORTED OBSERVATIONS', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Motion & quality', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'From date', exact: true }).click();
  assert.deepEqual(
    await page.locator('.calendar-popover .calendar-grid > small').allTextContents(),
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  );
  await page.getByRole('button', { name: 'Close calendar' }).click();
  await page.getByRole('button', { name: 'Distance', exact: true }).click();
  await expect(page.locator('th').nth(1)).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: 'Distance ↓', exact: true }).click();
  await expect(page.locator('th').nth(1)).toHaveAttribute('aria-sort', 'ascending');
  assert.equal((await page.locator('.data-bar').count()) > 0, true);
  const calendar = await page.locator('.driving-calendar-scroll').boundingBox();
  assert.equal(Math.round(calendar.height), 351);
  await page.screenshot({ path: '/private/tmp/dashcam-analytics-updated.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS shared preview, channel sync, trim across clips, rendered export, GPS lead, import guidance, Sunday calendar, Analytics KPI and sorting',
  );
} finally {
  await browser.close();
}
