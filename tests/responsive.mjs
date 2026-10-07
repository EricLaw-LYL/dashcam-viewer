// Responsive / desktop-zoom-equivalent / touch regression. Chrome, FFmpeg, Vite required.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'dashcam-responsive-'));
const files = ['F', 'R', 'C'].map((c) => join(dir, `NO20260923-120000-000001${c}.MP4`));
for (const file of files)
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
    file,
  ]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const nav = (name) => page.getByRole('button', { name: new RegExp(name) }).click();
async function load(page) {
  await page.goto(process.env.DASHCAM_TEST_URL || 'http://127.0.0.1:5174');
  await page.locator('input[type=file]').nth(1).setInputFiles(files);
  await expect(page.locator('video')).toHaveCount(3);
  await page.getByRole('button', { name: 'Add range to export' }).click();
  const rows = ['$V02'];
  for (let i = 0; i < 30; i++)
    rows.push(
      `${1790179200 + i},A,${43.8 + i * 0.00001},-79.4,9000,1000,1,2,3,NO20260923-120000-000001F.MP4,0,0,0`,
    );
  await page.locator('input[accept=".txt,.csv"]').setInputFiles({
    name: 'GPSData-fixture.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(rows.join('\n')),
  });
  await expect(page.locator('.header-notice:visible')).toContainText('GPS saved locally');
}
async function checkLayout(page, name, width, height) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${name}: page overflow at ${width}×${height}`,
  );
  const header = await page.locator('.page-heading:visible').boundingBox();
  assert.ok(header.x >= 0 && header.x + header.width <= width + 1);
  await expect(page.locator('.page-heading:visible h1')).toBeVisible();
  if (name !== 'GPS Analytics') {
    const panel = await page.locator('.player-panel').boundingBox();
    assert.ok(panel.height >= 230, `${name}: player collapsed at ${width}`);
    if (width < 1160)
      assert.ok(panel.height <= 520, `${name}: player stretched to ${panel.height}px at ${width}`);
    const controls = await page.locator('.playback-controls').boundingBox();
    for (const label of ['Play', 'Playback speed', 'Volume']) {
      const control =
        label === 'Play'
          ? page.getByRole('button', { name: label, exact: true })
          : page.getByLabel(label, { exact: true });
      const box = await control.boundingBox();
      assert.ok(
        box.x >= controls.x - 1 && box.x + box.width <= controls.x + controls.width + 1,
        `${label} overflow ${name} ${width}`,
      );
    }
  } else {
    await expect(page.locator('.analytics-cache .chart canvas').first()).toBeVisible();
    assert.ok(
      await page
        .locator('.table-scroll')
        .evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
    );
  }
  const footer = await page.locator('main > footer').boundingBox();
  assert.equal(footer.height, 36);
}
try {
  await load(page);
  const sizes = [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [1160, 720],
    [1152, 720],
    [1024, 768],
    [960, 600],
    [900, 700],
    [768, 1024],
    [720, 450],
    [650, 900],
    [430, 932],
    [390, 844],
    [375, 667],
    [320, 568],
    [844, 390],
  ];
  // 1440×900 at 80%, 125%, 150% and 200% desktop zoom changes CSS viewport sizes.
  sizes.push([1800, 1125]);
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const name of ['Footage Viewer', 'GPS Analytics', 'Export Studio']) {
      await nav(name);
      await checkLayout(page, name, width, height);
      if (width === 390 || (width === 960 && name === 'Footage Viewer'))
        await page.screenshot({
          path: join(dir, `${name.replaceAll(' ', '-')}-${width}.png`),
          fullPage: true,
        });
    }
  }
  // Real touch context, including camera focus/collapse and drag trim.
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const phone = await touch.newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await load(phone);
  await phone.getByRole('button', { name: 'Toggle Rear video', exact: true }).tap();
  await expect(
    phone.getByRole('button', { name: 'Toggle Rear video', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await phone.getByRole('button', { name: 'Focus Front', exact: true }).tap();
  await expect(phone.locator('.strips')).toHaveClass(/focused/);
  await phone.getByRole('button', { name: 'Focus Front', exact: true }).tap();
  await phone.getByRole('button', { name: 'Play', exact: true }).tap();
  await expect
    .poll(() =>
      phone.locator('.video-strip[data-channel="F"] video').evaluate((v) => v.currentTime),
    )
    .toBeGreaterThan(0.2);
  await phone.getByRole('button', { name: 'Pause', exact: true }).tap();
  await phone.getByRole('button', { name: /GPS Analytics/ }).tap();
  await expect(phone.locator('.analytics-cache .chart canvas').first()).toBeVisible();
  for (const label of ['From date', 'To date']) {
    await phone.getByRole('button', { name: label, exact: true }).tap();
    const popup = await phone.getByRole('dialog', { name: 'Choose recording day' }).boundingBox();
    assert.ok(popup.x >= 0 && popup.x + popup.width <= 390);
    await phone.getByRole('button', { name: 'Close calendar', exact: true }).tap();
  }
  await phone.getByRole('button', { name: /Export Studio/ }).tap();
  await checkLayout(phone, 'Export Studio', 390, 844);
  await phone.getByRole('slider', { name: 'Trim start', exact: true }).scrollIntoViewIfNeeded();
  const slider = await phone.getByRole('slider', { name: 'Trim start', exact: true }).boundingBox();
  const track = await phone.locator('.single-day-track').boundingBox();
  const cdp = await touch.newCDPSession(phone);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: slider.x + slider.width / 2, y: slider.y + slider.height / 2 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: track.x + track.width * 0.25, y: track.y + track.height / 2 }],
  });
  await expect(phone.locator('.timeline-hover img')).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(
    Number(
      await phone
        .getByRole('slider', { name: 'Trim start', exact: true })
        .getAttribute('aria-valuenow'),
    ) > 0.5,
  );
  await touch.close();
  assert.deepEqual(errors, []);
  console.log(
    `PASS all pages across ${sizes.length} viewport/zoom-equivalent sizes; bounded players, controls, tables, footer; mobile touch playback, camera controls, date pickers and trim. Screenshots: ${dir}`,
  );
} finally {
  await context.close();
  await browser.close();
}
