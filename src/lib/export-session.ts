// In-memory review state: footage and export settings never need browser storage.
export function createExportSession() {
  return {
    signature: '',
    index: 0,
    time: 0,
    speed: 1,
    volume: 1,
    includeAudio: true,
    trimStart: 0,
    trimEnd: 0,
    timelineZoom: 1,
    timelinePan: 0,
  };
}
export type ExportSession = ReturnType<typeof createExportSession>;
