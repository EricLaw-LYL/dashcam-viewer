// Isolated browser regression: synthetic footage/GPS, Chrome, FFmpeg and Vite.
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';

const fixtures = mkdtempSync(join(tmpdir(), 'dashcam-journey-follow-'));
const name = 'NO20260923-120000-000001F.MP4';
const clip = join(fixtures, name);
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=blue:s=320x180:r=30:d=40',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  clip,
]);
const start = DateTime.fromISO('2026-09-23T12:00:00', { zone: 'America/Toronto' }).toSeconds();
const rows = ['$V02'];
for (let i = 0; i <= 40; i++)
  rows.push(`${start + i},A,${43.8 + i * 0.0001},-79.4,9000,1000,1,2,3,${name},0,0,0`);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
try {
  const page = await context.newPage();
  await page.goto(process.env.DASHCAM_TEST_URL || 'http://127.0.0.1:5174');
  await page.locator('input[type=file]').nth(1).setInputFiles(clip);
  await expect(page.locator('.video-strip[data-channel="F"] video')).toBeVisible();
  await page.locator('input[accept=".txt,.csv"]').setInputFiles({
    name: 'GPSData-follow.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(rows.join('\n')),
  });
  await expect(page.locator('.header-notice:visible')).toContainText('GPS saved locally');
  const map = page.locator('.map-wrap:visible').first();
  const canvas = map.locator('canvas.maplibregl-canvas');
  const follow = map.getByRole('button', { name: 'Follow', exact: true });
  const compass = map.locator('.maplibregl-ctrl-compass');
  const arrow = compass.locator('span');
  const video = page.locator('.video-strip[data-channel="F"] video');
  await expect(follow).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeGreaterThan(0.2);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 30, { steps: 15 });
    await page.mouse.up();
    const at = await video.evaluate((el) => el.currentTime);
    await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeGreaterThan(at + 0.3);
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    // Rotate, re-enable Follow, then reset north while playback updates continue.
    await canvas.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(arrow).not.toHaveAttribute('style', /rotate\(0deg\)/);
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await compass.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await expect(arrow).toHaveAttribute('style', /rotate\(0deg\)/);
    // Mouse wheel zoom must also release Follow before the gesture begins.
    await follow.click();
    await canvas.hover();
    await page.mouse.wheel(0, 100);
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    console.log(
      `PASS ${width}px: playback drag releases Follow, compass resets north, wheel releases Follow`,
    );
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await follow.click();
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await compass.click();
  await expect(arrow).toHaveAttribute('style', /rotate\(0deg\)/);
  await page.getByRole('button', { name: /GPS Analytics/ }).click();
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveCount(0);
  const analyticsMap = page.locator('.map-wrap:visible').first();
  await analyticsMap.locator('canvas').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(analyticsMap.locator('.maplibregl-ctrl-compass span')).not.toHaveAttribute(
    'style',
    /rotate\(0deg\)/,
  );
  await analyticsMap.locator('.maplibregl-ctrl-compass').click();
  await expect(analyticsMap.locator('.maplibregl-ctrl-compass span')).toHaveAttribute(
    'style',
    /rotate\(0deg\)/,
  );
  console.log('PASS paused keyboard interaction and Analytics compass');
} finally {
  await context.close();
  await browser.close();
  rmSync(fixtures, { recursive: true, force: true });
}
