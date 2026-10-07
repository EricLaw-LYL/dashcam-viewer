// Isolated browser regression: requires Chrome, FFmpeg/FFprobe, and a running Vite server.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixtures = mkdtempSync(join(tmpdir(), 'dashcam-trim-speed-'));
const files = ['NO20260923-120000-000001F.MP4', 'NO20260923-120004-000002F.MP4'];
for (const [i, name] of files.entries()) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    i === 0
      ? 'color=red:s=320x180:r=30:d=2[r];color=blue:s=320x180:r=30:d=2[b];[r][b]concat=n=2:v=1:a=0'
      : 'color=green:s=320x180:r=30:d=4',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    join(fixtures, name),
  ]);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
async function edgeValue(edge) {
  return Number(
    await page
      .getByRole('slider', { name: `Trim ${edge}`, exact: true })
      .getAttribute('aria-valuenow'),
  );
}
async function exportAt(speed) {
  await page.getByLabel('Playback speed').selectOption(String(speed));
  const downloaded = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: 'Export video ↗', exact: true }).click();
  const file = join(fixtures, `export-${speed}.mp4`);
  await (await downloaded).saveAs(file);
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  );
  const video = info.streams.find((s) => s.codec_type === 'video');
  const audio = info.streams.find((s) => s.codec_type === 'audio');
  assert.equal(video.avg_frame_rate, '30/1');
  assert.equal(video.width, 1920);
  assert.equal(video.height, 1080);
  assert.ok(Math.abs(Number(video.duration) - 6 / speed) < 0.04, JSON.stringify(info));
  // AAC encoder priming and final packet padding vary by platform.
  assert.ok(audio && Math.abs(Number(audio.duration) - 6 / speed) < 0.1);
  // Trimmed source sequence: 1 s red, 2 s blue, then 3 s green.
  for (const [sourceSecond, channel] of [
    [0.5, 0],
    [2, 2],
    [4, 1],
  ]) {
    const pixel = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-ss',
      String(sourceSecond / speed),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=1:1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ]);
    assert.ok(
      pixel[channel] > 80 && pixel[channel] > pixel[(channel + 1) % 3] * 2,
      `Wrong source frame at speed ${speed}: ${pixel}`,
    );
  }
  console.log(
    `PASS ${speed}×: ${video.duration}s, 30 fps, synchronized audio, correct trimmed source frames`,
  );
}
try {
  await page.goto(process.env.DASHCAM_TEST_URL || 'http://127.0.0.1:5174');
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(files.map((f) => join(fixtures, f)));
  await expect(page.locator('.clip-row')).toHaveCount(2);
  await expect(page.locator('.video-strip[data-channel="F"] video')).toBeVisible();
  const viewerHeight = (await page.locator('.day-timeline').boundingBox()).height;
  for (const channel of ['Rear', 'Cabin'])
    await page.getByRole('button', { name: `Toggle ${channel} video`, exact: true }).click();
  await expect(page.getByRole('img', { name: 'Included in export' })).toHaveCount(0);
  for (const i of [1, 0]) {
    await page.locator('.clip-row').nth(i).click();
    await page.getByRole('button', { name: 'Add range to export' }).click();
    await expect(
      page.locator('.clip-row').nth(i).getByRole('img', { name: 'Included in export' }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: /Export Studio/ }).click();
  await expect(page.locator('.sequence-item')).toHaveCount(2);
  await expect(page.locator('.sequence-item .text-button')).toHaveText([
    '2026-09-23 · 12:00:00',
    '2026-09-23 · 12:00:04',
  ]);
  assert.equal((await page.locator('.day-timeline').boundingBox()).height, viewerHeight);
  const review = await page.locator('.export-review').boundingBox();
  const sequence = await page.locator('.export-sequence').boundingBox();
  const settings = await page.locator('.export-settings').boundingBox();
  assert.ok(sequence.x + sequence.width < review.x);
  assert.ok(review.x + review.width < settings.x);
  assert.equal(sequence.y, settings.y);
  await expect(page.getByText('Mark in', { exact: true })).toHaveCount(0);
  assert.equal(await page.locator('.sequence-item button').count(), 4);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .locator('.sequence-item')
    .first()
    .getByRole('button', { name: /^Remove/ })
    .click();
  await expect(page.locator('.sequence-item')).toHaveCount(2);
  const start = page.getByRole('slider', { name: 'Trim start', exact: true });
  const end = page.getByRole('slider', { name: 'Trim end', exact: true });
  const box = await page.locator('.single-day-track').boundingBox();
  const handle = await start.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 8, box.y + box.height / 2, { steps: 8 });
  await expect(page.locator('.timeline-hover img')).toBeVisible();
  await expect(page.locator('.timeline-hover .hover-time')).toHaveText('00:00:01');
  await page.screenshot({ path: join(fixtures, 'trim-preview.png') });
  await page.mouse.up();
  assert.ok(Math.abs((await edgeValue('start')) - 1) < 0.03);
  const endBox = await end.boundingBox();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await page.mouse.down();
  await expect(page.locator('.timeline-hover img')).toBeVisible();
  await expect(page.locator('.timeline-hover .hover-time')).toHaveText('00:00:08');
  await expect(page.getByText('No footage', { exact: true })).toHaveCount(0);
  await page.mouse.up();
  await start.press('Home');
  await start.press('Shift+ArrowRight');
  await end.press('Shift+ArrowLeft');
  assert.equal(await edgeValue('start'), 1);
  assert.equal(await edgeValue('end'), 7);
  // Leaving Export destroys its component; the app must restore the review session.
  await page.locator('.sequence-item').nth(1).locator('.text-button').click();
  await page.getByLabel('Playback speed').selectOption('4');
  await page.getByLabel('Volume', { exact: true }).fill('0.35');
  await page.getByLabel('Include audio').uncheck();
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await page.getByLabel('Pan day timeline').fill('35');
  for (const destination of ['Add footage', 'GPS Analytics']) {
    await page.getByRole('button', { name: new RegExp(destination) }).click();
    await page.getByRole('button', { name: /Export Studio/ }).click();
    assert.equal(await edgeValue('start'), 1);
    assert.equal(await edgeValue('end'), 7);
    await expect(page.getByLabel('Playback speed')).toHaveValue('4');
    await expect(page.getByLabel('Include audio')).not.toBeChecked();
    await expect(page.getByLabel('Timeline zoom', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('Pan day timeline')).toHaveValue('35');
    await expect(page.locator('.sequence-item').nth(1)).toHaveClass(/selected/);
    await expect(page.getByLabel('Current playback timestamp')).toHaveText('00:00:04');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  }
  await page.getByLabel('Include audio').check();
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('0.35');
  await page.getByRole('button', { name: 'Zoom out timeline', exact: true }).click();
  console.log(
    'PASS Export trim, position, selected clip, speed, audio, zoom and pan survive Viewer/Analytics navigation',
  );
  await page.screenshot({ path: join(fixtures, 'export-layout.png') });
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  await exportAt(2);
  await exportAt(0.5);
  await exportAt(1.75);
  await start.press('End');
  assert.ok((await edgeValue('start')) < (await edgeValue('end')));
  await start.press('Home');
  await end.press('End');
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .locator('.sequence-item')
    .first()
    .getByRole('button', { name: /^Remove/ })
    .click();
  await expect(page.locator('.sequence-item')).toHaveCount(1);
  assert.equal(await edgeValue('end'), 4);
  await page.getByRole('button', { name: /Footage Viewer/ }).click();
  await expect(
    page.locator('.clip-row').first().getByRole('img', { name: 'Included in export' }),
  ).toHaveCount(0);
  await expect(
    page.locator('.clip-row').nth(1).getByRole('img', { name: 'Included in export' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Export Studio/ }).click();
  await page.setViewportSize({ width: 650, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(
    `PASS layout, equal timeline heights, pointer/keyboard trim, removal confirmation, narrow layout. Artifacts: ${fixtures}`,
  );
} finally {
  await context.close();
  await browser.close();
}
