import { expect, it } from 'vitest';
import { scanFolder } from '../src/lib/media';
const file = (name: string, fails = false) => ({
  kind: 'file',
  name,
  getFile: async () => {
    if (fails) throw Error('disconnected');
    return new File([''], name);
  },
});
const dir = (name: string, entries: any[]) => ({
  kind: 'directory',
  name,
  async *values() {
    yield* entries;
  },
});
it('recursively discovers camera folders and root GPS, skips system files, and keeps readable clips', async () => {
  const root = dir('70MAI_T800E', [
    dir('Normal', [
      dir('Front', [file('NO20260923-175328-003563F.MP4')]),
      dir('Rear', [file('NO20260923-175328-003563R.MP4')]),
      dir('Cabin', [file('NO20260923-175328-003563C.MP4')]),
    ]),
    file('GPSData000001.txt'),
    dir('.Spotlight-V100', [file('ignored.mp4')]),
    file('._bad.MP4'),
    file('broken.mp4', true),
    file('photo.jpg'),
  ]);
  const progress: number[] = [];
  const result = await scanFolder(root, (count) => progress.push(count));
  expect(result.files).toHaveLength(4);
  expect(result.folders).toBe(5);
  expect(result.skipped).toEqual(['70MAI_T800E/broken.mp4']);
  expect(progress).toEqual([1, 2, 3, 4]);
});
