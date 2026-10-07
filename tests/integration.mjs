import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1512, height: 1050 } }),
  page = await context.newPage();
const errors = [],
  network = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('PAGE ERROR', e.message);
});
page.on('request', (r) => {
  if (
    !r.url().startsWith('http://127.0.0.1:4173') &&
    !r.url().startsWith('https://tile.openstreetmap.org/') &&
    !r.url().startsWith('blob:') &&
    !r.url().startsWith('data:')
  )
    network.push(r.url());
});
try {
  await page.goto('http://127.0.0.1:4173');
  const root = '/private/tmp/dashcam-fixtures';
  const media = fs
    .readdirSync(root)
    .filter((n) => n.endsWith('.MP4'))
    .map((n) => `${root}/${n}`);
  await page.locator('input[type=file]').nth(1).setInputFiles(media);
  await expect(page.locator('video')).toHaveCount(3);
  await expect(page.getByLabel('Seek recording')).toHaveAttribute('max', '4');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(1200);
  const positions = await page.locator('video').evaluateAll((v) => v.map((x) => x.currentTime));
  assert(Math.max(...positions) - Math.min(...positions) < 0.12);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  console.log('PASS synchronized playback', positions);
  await page.getByRole('button', { name: 'Add range to export' }).click();
  await page.locator('.clip-row').nth(1).click();
  await page.getByRole('button', { name: 'Add range to export' }).click();
  await page.getByRole('button', { name: 'Export Studio' }).click();
  await page.getByLabel('Range 1 out', { exact: true }).fill('1');
  await page.getByLabel('Range 1 out', { exact: true }).press('Tab');
  await page.getByLabel('Range 2 out', { exact: true }).fill('1');
  await page.getByLabel('Range 2 out', { exact: true }).press('Tab');
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  for (let mask = process.env.SKIP_RENDER ? 8 : 1; mask < 8; mask++) {
    for (let i = 0; i < 3; i++)
      await page
        .locator('.channel-choices input')
        .nth(i)
        .setChecked(Boolean(mask & (1 << i)));
    const chosen = ['R', 'F', 'C'].filter((_, i) => mask & (1 << i));
    await page.getByLabel('Export audio', { exact: true }).selectOption(chosen[0]);
    const wait = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: 'Export video' }).click();
    const d = await wait;
    const path = `/private/tmp/dashcam-combo-${mask}.mp4`;
    await d.saveAs(path);
    const info = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_name,width,height',
          '-of',
          'json',
          path,
        ],
        { encoding: 'utf8' },
      ),
    );
    assert(Math.abs(Number(info.format.duration) - 2) < 0.1);
    assert(info.streams.some((s) => s.codec_name === 'aac'));
    assert(
      info.streams.some((s) => s.codec_name === 'h264' && s.width === 1920 && s.height === 1080),
    );
    const pixels = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-ss',
      '0.4',
      '-i',
      path,
      '-frames:v',
      '1',
      '-vf',
      'scale=96:54',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ]);
    chosen.forEach((c, i) => {
      const y = Math.floor(((i + 0.5) * 54) / chosen.length),
        at = (y * 96 + 48) * 3,
        values = [pixels[at], pixels[at + 1], pixels[at + 2]],
        expected = { R: 2, F: 1, C: 0 }[c];
      assert(
        values[expected] > Math.max(...values.filter((_, j) => j !== expected)) * 1.5,
        `wrong strip ${c}: ${values}`,
      );
    });
    console.log('PASS export', chosen.join('/'), '2 joined ranges, selected audio, strip colors');
  }
  // Fast packet-copy join: use complete four-second fixtures, one selected channel.
  await page.getByLabel('Range 1 out', { exact: true }).fill('4');
  await page.getByLabel('Range 1 out', { exact: true }).press('Tab');
  await page.getByLabel('Range 2 out', { exact: true }).fill('4');
  await page.getByLabel('Range 2 out', { exact: true }).press('Tab');
  await page.locator('.channel-choices input').nth(0).uncheck();
  await page.locator('.channel-choices input').nth(2).uncheck();
  await page
    .locator('label')
    .filter({ hasText: 'Export mode' })
    .locator('select')
    .selectOption('fast');
  const fastWait = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: 'Export video' }).click();
  await (await fastWait).saveAs('/private/tmp/dashcam-fast-join.mp4');
  const fast = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name,width',
        '-of',
        'json',
        '/private/tmp/dashcam-fast-join.mp4',
      ],
      { encoding: 'utf8' },
    ),
  );
  assert(Math.abs(Number(fast.format.duration) - 8) < 0.2);
  assert(fast.streams[0].width === 640);
  console.log('PASS fast join original dimensions', fast.format.duration);
  await page.getByRole('button', { name: 'GPS Analytics' }).click();
  await page.locator('input[type=file]').nth(2).setInputFiles(`${root}/GPSData-fixture.txt`);
  await expect(page.locator('.toast')).toContainText('120 new', { timeout: 30000 });
  await page.locator('input[type=file]').nth(2).setInputFiles([]);
  await page.locator('input[type=file]').nth(2).setInputFiles(`${root}/GPSData-fixture.txt`);
  await expect(page.locator('.toast')).toContainText('0 new, 120 duplicates', { timeout: 30000 });
  await expect(page.locator('.metric-grid').first()).toBeVisible();
  for (const tab of ['Speed & activity', 'Trips & parking', 'Motion & quality', 'Overview']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: '/private/tmp/dashcam-dashboard-fixture.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'GPS Analytics' }).click();
  await expect(page.locator('.metric-grid').first()).toContainText('1.2', { timeout: 30000 });
  console.log('PASS persistent dashboard, deduplication, tabs');
  await page.getByRole('button', { name: 'Library & settings' }).click();
  await page.evaluate(() => (window.showSaveFilePicker = undefined));
  const backupWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up GPS history' }).click();
  await (await backupWait).saveAs('/private/tmp/dashcam-backup.ndjson');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete this GPS history' }).click();
  await expect(page.locator('.metric-grid')).toHaveCount(0);
  await page.locator('input[type=file]').nth(3).setInputFiles('/private/tmp/dashcam-backup.ndjson');
  await expect(page.locator('.toast')).toContainText('GPS backup restored', { timeout: 30000 });
  await expect(page.locator('.metric-grid').first()).toBeVisible();
  console.log('PASS backup/delete/restore');
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  console.log(
    'PASS zero page errors and no unexpected external requests (OpenStreetMap tiles allowed)',
  );
} catch (error) {
  console.log('FAILURE UI', (await page.locator('main').innerText()).slice(-4000));
  throw error;
} finally {
  await browser.close();
}
