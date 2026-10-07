import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1401, height: 845 } });
const errors = [];
const tiles = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (r.url().includes('tile.openstreetmap.org')) tiles.push(r.url());
});
try {
  await page.goto('http://127.0.0.1:5174');
  await page.locator('input[webkitdirectory]').setInputFiles('/private/tmp/dashcam-fixtures');
  await expect(page.locator('.toast')).toContainText('GPS saved locally', { timeout: 30000 });
  await expect(page.locator('.journey-status')).toHaveCount(0);
  await expect(page.locator('.player-scrubber')).toHaveCount(0);
  const overview = await page.locator('.day-timeline').boundingBox();
  const videoPanel = await page.locator('.player-panel').boundingBox();
  assert(Math.abs(overview.x - videoPanel.x) < 2 && Math.abs(overview.width - videoPanel.width) < 2, 'timeline stays below videos');
  for (const selector of ['.recording-panel', '.journey-panel']) {
    const panel = await page.locator(selector).boundingBox();
    assert(Math.abs(panel.y + panel.height - overview.y - overview.height) < 2, 'side panel extends to timeline bottom');
  }
  assert.equal(await page.locator('.clip-list').evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
  const play = await page.getByRole('button', { name: 'Play', exact: true }).boundingBox();
  assert(
    Math.abs(play.x + play.width / 2 - overview.x - overview.width / 2) < 2,
    'play button is centered',
  );
  const slider = page.getByLabel('Seek recording');
  const start = Number(await slider.getAttribute('min'));
  await slider.fill(String(start + 1.5));
  await expect
    .poll(() =>
      page.locator('video').evaluateAll((v) => v.every((x) => Math.abs(x.currentTime - 1.5) < 0.2)),
    )
    .toBe(true);
  await slider.fill(String(start + 6));
  await expect
    .poll(() =>
      page.locator('video').evaluateAll((v) => v.every((x) => Math.abs(x.currentTime - 2) < 0.2)),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Back ten seconds' }).click();
  await expect(page.locator('.clip-row').first()).toHaveClass(/selected/);
  await expect.poll(() => page.locator('video').evaluateAll(v => v.every(x => x.currentTime < .2))).toBe(true);
  await page.getByRole('button', { name: 'Forward ten seconds' }).click();
  await expect(page.locator('.clip-row').nth(1)).toHaveClass(/selected/);
  await slider.fill(String(start));
  await expect(page.getByLabel('Travel direction')).toContainText('90° E');
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => tiles.some(url => /\/16\//.test(url))).toBe(true);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.clip-row.selected .thumbnail img')).toBeVisible();

  await page.getByRole('button', { name: 'Fit route', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'false');

  await expect(page.locator('.day-timeline .playback-controls')).toBeVisible();
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable online basemap' })).toHaveCount(0);
  assert(tiles.length > 0, 'basemap automatically requests tiles');
  await page.getByLabel('Volume', { exact: true }).fill('0.6');
  await page.getByRole('button', { name: 'Mute audio', exact: true }).click();
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Unmute audio', exact: true }).click();
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('0.6');
  await expect(page.locator('.recordings-column .viewer-toolbar')).toBeVisible();
  await expect(page.locator('.journey-column .channel-picker')).toBeVisible();
  const online = page.getByRole('switch', { name: 'Online map' });
  await online.click();
  await expect(online).toHaveAttribute('aria-checked', 'false');
  await online.click();
  await expect(online).toHaveAttribute('aria-checked', 'true');
  const normal = page.getByRole('button', {name: 'Normal', exact: true});
  const event = page.getByRole('button', {name: 'Event', exact: true});
  await normal.click();
  await expect(normal).toHaveAttribute('aria-pressed', 'false');
  await expect(event).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'All footage', exact: true}).click();
  await expect(normal).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Show Front', { exact: true }).uncheck();
  await expect(page.locator('.video-strip:not(.hidden)')).toHaveCount(2);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-channel="F"] video').evaluate((v) => v.paused), false);
  assert.equal(await page.locator('[data-channel="F"] video').evaluate((v) => v.muted), false);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page
    .getByRole('group', { name: 'Cabin channel position' })
    .dragTo(page.getByRole('group', { name: 'Rear channel position' }));
  assert.deepEqual(
    await page.locator('.video-strip').evaluateAll((els) => els.map((e) => e.dataset.channel)),
    ['C', 'R', 'F'],
  );
  await page.getByLabel('Show Rear', { exact: true }).uncheck();
  await expect(page.getByLabel('Show Cabin', { exact: true })).toBeDisabled();
  await page.getByLabel('Show Front', { exact: true }).check();
  await page.getByLabel('Show Rear', { exact: true }).check();
  const footer = await page.locator('footer').boundingBox();
  assert(footer.y + footer.height <= 846, 'viewer fits height');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '/private/tmp/dashcam-layout-finished.png', fullPage: true });
  await page.reload();
  assert.deepEqual(
    await page.locator('.video-strip').evaluateAll((els) => els.map((e) => e.dataset.channel)),
    ['C', 'R', 'F'],
  );
  for (const name of ['GPS Analytics', 'Export Studio']) {
    await page.getByRole('button', { name, exact: false }).click();
    await expect(page.locator('.topbar')).toHaveCount(0);
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS controls in Overview, viewport fit, automatic map, heading arrow, channel selection/drag/persistence/front audio, shared header removal',
  );
} finally {
  await browser.close();
}
