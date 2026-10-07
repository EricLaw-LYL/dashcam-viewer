// Isolated regression: Chrome, FFmpeg, and Vite (DASHCAM_TEST_URL).
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dashcam-timeline-follow-'));
const files = ['NO20260923-120000-000001F.MP4', 'NO20260923-120040-000002F.MP4'];
for (const name of files) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=blue:s=160x90:r=30:d=30',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    join(dir, name),
  ]);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const seek = page.getByLabel('Seek recording', { exact: true });
const pan = page.getByLabel('Pan day timeline');
async function visible(at) {
  await expect
    .poll(() =>
      seek.evaluate((el, target) => {
        const min = Number(el.min),
          max = Number(el.max);
        return (
          target >= min - 0.02 && target <= max + 0.02 && Math.abs(Number(el.value) - target) < 0.05
        );
      }, at),
    )
    .toBe(true);
}
async function zoom(value) {
  await page.getByLabel('Timeline zoom').fill(String(value));
  await page.getByLabel('Timeline zoom').dispatchEvent('input');
}
async function jump(direction, at) {
  await page.getByRole('button', { name: `${direction} ten seconds`, exact: true }).click();
  await visible(at);
}
try {
  await page.goto(process.env.DASHCAM_TEST_URL || 'http://127.0.0.1:5174');
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(files.map((name) => join(dir, name)));
  await expect(page.locator('.clip-row')).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator('video')
        .first()
        .evaluate((el) => el.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  const base = Number(await seek.getAttribute('min'));
  for (const i of [0, 1]) {
    await page.locator('.clip-row').nth(i).click();
    await expect(page.locator('.playback-time')).toContainText('/ 00:00:30');
    await page.getByRole('button', { name: 'Add range to export' }).click();
    await expect(
      page.locator('.clip-row').nth(i).getByRole('img', { name: 'Included in export' }),
    ).toBeVisible();
  }
  await page.locator('.clip-row').first().click();
  await zoom(8);
  for (const offset of [10, 20, 40, 50]) await jump('Forward', base + offset);
  for (const offset of [40, 20, 10, 0]) await jump('Back', base + offset);
  // Paused users can inspect another window without snapping back.
  await pan.fill('100');
  await pan.dispatchEvent('input');
  await page.waitForTimeout(200);
  await expect(pan).toHaveValue('100');
  await jump('Forward', base + 10);
  await page.getByRole('button', { name: /Export Studio/ }).click();
  await expect(page.locator('.sequence-item')).toHaveCount(2);
  await zoom(8);
  for (const offset of [10, 20, 30, 40, 50, 60]) await jump('Forward', offset);
  for (const offset of [50, 40, 30, 20, 10, 0]) await jump('Back', offset);
  await pan.fill('100');
  await pan.dispatchEvent('input');
  await page.waitForTimeout(200);
  await expect(pan).toHaveValue('100');
  await jump('Forward', 10);
  // Continuous playback must also advance the window at high zoom.
  await zoom(48);
  const before = Number(await pan.inputValue());
  await page.getByLabel('Playback speed').selectOption('8');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await pan.inputValue())).toBeGreaterThan(before + 3);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect
    .poll(() =>
      seek.evaluate((el) => {
        const text = el.getAttribute('aria-valuetext');
        const at = text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
        return at >= Number(el.min) - 1 && at <= Number(el.max) + 1;
      }),
    )
    .toBe(true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Viewer/Export zoomed forward/back jumps, gaps/clip joins, sequence endpoints, paused manual pan, and playback following.',
  );
} finally {
  await context.close();
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
