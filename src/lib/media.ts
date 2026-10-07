import type { Clip, Recording } from './model';
const pending = new WeakMap<File, Promise<number>>();
export async function duration(clip: Clip) {
  if (clip.duration) return clip.duration;
  let p = pending.get(clip.file);
  if (!p) {
    p = (async () => {
      const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
      const input = new Input({ source: new BlobSource(clip.file), formats: ALL_FORMATS });
      try {
        return await input.computeDuration();
      } finally {
        input.dispose();
      }
    })();
    pending.set(clip.file, p);
  }
  clip.duration = await p;
  return clip.duration;
}
export async function groupDuration(recording: Recording) {
  const values = await Promise.all(Object.values(recording.clips).map(duration));
  return Math.max(...values, 0);
}
export interface FolderScan {
  files: File[];
  folders: number;
  skipped: string[];
}
// Read file metadata only; video bytes are fetched by the player on demand.
export async function scanFolder(
  root: any,
  progress: (count: number, path: string) => void = () => {},
): Promise<FolderScan> {
  const result: FolderScan = { files: [], folders: 0, skipped: [] };
  async function walk(dir: any, path: string) {
    result.folders++;
    for await (const handle of dir.values()) {
      if (handle.name.startsWith('.')) continue;
      const child = `${path}/${handle.name}`;
      try {
        if (handle.kind === 'directory') await walk(handle, child);
        else if (/\.mp4$|^GPSData.*\.txt$/i.test(handle.name)) {
          result.files.push(await handle.getFile());
          progress(result.files.length, child);
        }
      } catch {
        result.skipped.push(child);
      }
    }
  }
  await walk(root, root.name);
  return result;
}
export async function pickFolder(progress?: (count: number, path: string) => void) {
  const picker = (window as any).showDirectoryPicker;
  if (!picker) throw Error('Use “Choose folder (compatible)” in this browser.');
  const root = await picker.call(window, { mode: 'read' });
  return { ...(await scanFolder(root, progress)), name: root.name as string };
}
