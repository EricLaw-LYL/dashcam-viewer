let counter = 0;
export function gpsJob<T>(action: string, payload: unknown, onProgress?: (v: any) => void) {
  const worker = new Worker(new URL('./gps.worker.ts', import.meta.url), { type: 'module' });
  const id = ++counter;
  let rejectJob: (e: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.data);
      else {
        worker.terminate();
        data.type === 'error' ? reject(Error(data.data)) : resolve(data.data);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(Error(e.message));
    };
    worker.postMessage({ id, action, payload });
  });
  return {
    promise,
    cancel() {
      worker.terminate();
      rejectJob(Error('Cancelled. Committed GPS batches are retained; reimport safely to finish.'));
    },
  };
}
export function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}
