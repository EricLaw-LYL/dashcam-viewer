import { StreamTarget } from 'mediabunny';

// Fragmented MP4 writes sequentially. Keep encoded chunks as Blobs rather than
// allocating one growing ArrayBuffer for the entire exported video.
export function createDownloadTarget() {
  const parts: Blob[] = [];
  let size = 0;
  let blob: Blob | undefined;
  const target = new StreamTarget(
    new WritableStream({
      write(chunk) {
        if (chunk.position !== size) throw Error('Export output is not sequential.');
        parts.push(new Blob([chunk.data]));
        size += chunk.data.byteLength;
      },
      close() {
        blob = new Blob(parts, { type: 'video/mp4' });
        parts.length = 0;
      },
      abort() {
        parts.length = 0;
      },
    }),
    { chunked: true, chunkSize: 4 * 1024 * 1024 },
  );
  return {
    target,
    getBlob() {
      if (!blob) throw Error('Export has not finished.');
      return blob;
    },
  };
}
