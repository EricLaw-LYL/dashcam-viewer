// Isolated regression for file-stream finalization and fast-join downloads.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixtures = mkdtempSync(join(tmpdir(), 'dashcam-export-stream-'));
const source = join(fixtures, 'NO20260923-120000-000001F.MP4');
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=red:s=320x180:r=30:d=2',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  source,
]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
try {
  const page = await context.newPage();
  await page.goto(process.env.DASHCAM_TEST_URL || 'http://127.0.0.1:5174');
  const results = await page.evaluate(
    async (bytes) => {
      const { catalog } = await import('/src/lib/model.ts');
      const { fastExport } = await import('/src/lib/fast-export.ts');
      const recording = catalog([
        new File([new Uint8Array(bytes)], 'NO20260923-120000-000001F.MP4'),
      ])[0];
      const ranges = [{ recording, start: 0, end: 2 }];
      const root = await navigator.storage.getDirectory();
      const results = [];
      for (const mode of ['fast', 'render', 'fast-download']) {
        const name = `test-${mode}.mp4`;
        const handle =
          mode === 'fast-download' ? null : await root.getFileHandle(name, { create: true });
        let blob;
        try {
          if (mode !== 'render') {
            blob = await fastExport(
              ranges,
              'F',
              'mute',
              handle,
              () => false,
              () => {},
            );
          } else {
            const worker = new Worker('/src/lib/export.worker.ts', { type: 'module' });
            try {
              await new Promise((resolve, reject) => {
                worker.onmessage = ({ data }) => {
                  if (data.type === 'error') reject(new Error(data.message));
                  if (data.type === 'done') resolve();
                };
                worker.onerror = (event) => reject(new Error(event.message));
                worker.postMessage({
                  ranges,
                  channels: ['F'],
                  audio: 'mute',
                  mode: 'render',
                  speed: 1,
                  width: 320,
                  height: 180,
                  fit: 'contain',
                  handle,
                });
              });
            } finally {
              worker.terminate();
            }
          }
          blob ??= await handle.getFile();
          results.push({ mode, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
        } finally {
          if (handle) await root.removeEntry(name);
        }
      }
      return results;
    },
    Array.from(readFileSync(source)),
  );
  for (const result of results) {
    const file = join(fixtures, `${result.mode}.mp4`);
    writeFileSync(file, new Uint8Array(result.bytes));
    const info = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], {
        encoding: 'utf8',
      }),
    );
    const video = info.streams.find((s) => s.codec_type === 'video');
    assert.equal(video.avg_frame_rate, '30/1');
    assert.ok(Math.abs(Number(video.duration) - 2) < 0.04);
    console.log(`PASS ${result.mode}: finalized playable MP4, 30 fps, 2 seconds`);
  }
} finally {
  await context.close();
  await browser.close();
  rmSync(fixtures, { recursive: true, force: true });
}
