// Isolated lapse-duration regression. Requires Chrome, FFmpeg and Vite.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dashcam-lapse-timeline-'));
const fixtures = [
  ['NO20260923-120000-000001F.MP4', 2],
  ['LA20260923-120002-000002F.MP4', 4],
  ['LA20260923-120102-000003F.MP4', 2],
  ['NO20260923-120142-000004F.MP4', 3],
];
for (const [name, seconds] of fixtures) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=blue:s=160x90:r=30:d=${seconds}`,
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
async function seekTo(value) {
  await seek.fill(String(value));
  await seek.dispatchEvent('input');
}
try {
  await page.goto(process.env.DASHCAM_TEST_URL || 'http://127.0.0.1:5174');
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(fixtures.map(([name]) => join(dir, name)));
  await expect(page.locator('.clip-row')).toHaveCount(4);
  await expect(page.locator('.clip-row').nth(1)).toContainText('Lapse · 15×');
  await expect(page.locator('.day-timeline')).toHaveAttribute('aria-busy', 'false');
  const base = Number(await seek.getAttribute('min'));
  assert.ok(Math.abs(Number(await seek.getAttribute('max')) - base - 105) < 0.01);
  // Unselected lapse files must already use real durations: 4s*15 and 2s*15.
  const widths = await page
    .locator('.day-block.LA')
    .evaluateAll((els) => els.map((el) => Number.parseFloat(el.style.width)));
  assert.equal(widths.length, 2);
  assert.ok(Math.abs(widths[0] - (60 / 105) * 100) < 0.01);
  assert.ok(Math.abs(widths[1] - (30 / 105) * 100) < 0.01);
  await seekTo(base + 77);
  await expect(page.locator('.clip-row.selected')).toContainText('12:01:02');
  await expect(page.locator('.playback-time')).toContainText('00:00:01 / 00:00:02');
  await expect(page.getByLabel('Current playback timestamp')).toHaveText('12:01:17');
  // The ten-second gap after this lapse must not become invented lapse footage.
  const box = await page.locator('.single-day-track').boundingBox();
  await page.mouse.move(box.x + (box.width * 97) / 105, box.y + box.height / 2);
  await expect(page.locator('.hover-no-footage')).toHaveText('No footage');
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Add range to export' }).click();
  await expect(
    page.locator('.clip-row.selected').getByRole('img', { name: 'Included in export' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Export Studio/ }).click();
  // Export stays on compressed media time: this lapse is two seconds, not thirty.
  await expect(page.locator('.sequence-item')).toHaveCount(1);
  await expect(seek).toHaveAttribute('max', '2');
  await expect(page.locator('.playback-time')).toContainText('/ 00:00:02');
  assert.deepEqual(errors, []);
  console.log(
    'PASS actual durations for unselected lapse/normal files, 15x capture-time blocks, lapse seeking, real gaps, and Export media-time duration.',
  );
} finally {
  await context.close();
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
