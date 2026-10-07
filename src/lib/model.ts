import { DateTime } from 'luxon';
export const CHANNELS = ['R', 'F', 'C'] as const;
export type Channel = (typeof CHANNELS)[number];
export const channelName: Record<Channel, string> = { R: 'Rear', F: 'Front', C: 'Cabin' };
export const typeName: Record<string, string> = {
  NO: 'Normal',
  EV: 'Event',
  PA: 'Parking',
  LA: 'Lapse',
  EM: 'Event',
};
export interface Clip {
  file: File;
  name: string;
  channel: Channel;
  duration?: number;
}
export interface Recording {
  /** Source-file offset for a trimmed export timeline entry, in seconds. */
  previewOffset?: number;
  id: string;
  date: string;
  time: string;
  type: string;
  start: number;
  scale: number;
  clips: Partial<Record<Channel, Clip>>;
}
export interface GPSPoint {
  key: string;
  library: string;
  timestamp: number;
  filename: string;
  type: string;
  status: string;
  lat: number;
  lng: number;
  speed: number;
  bearing: number;
  x: number;
  y: number;
  z: number;
  raw: string[];
  sources?: string[];
  segment?: number;
  deltaSpeed?: number;
  deltaBearing?: number;
}
export interface ExportRange {
  id: string;
  recording: Recording;
  start: number;
  end: number;
}
export function parseName(name: string) {
  const m = /^(NO|EV|EM|PA|LA)(\d{8})-(\d{6})-(\d+)([FRCB])\.mp4$/i.exec(name);
  if (!m) return null;
  return {
    type: m[1].toUpperCase(),
    date: m[2].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
    time: m[3].replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3'),
    sequence: m[4],
    channel: (m[5].toUpperCase() === 'B' ? 'R' : m[5].toUpperCase()) as Channel,
  };
}
export function catalog(files: File[], zone = 'America/Toronto'): Recording[] {
  const map = new Map<string, Recording>();
  for (const file of files) {
    const n = parseName(file.name);
    if (!n) continue;
    const id = `${n.type}${n.date}-${n.time}-${n.sequence}`;
    let group = map.get(id);
    if (!group) {
      group = {
        id,
        date: n.date,
        time: n.time,
        type: n.type,
        start: DateTime.fromISO(`${n.date}T${n.time}`, { zone }).toSeconds(),
        scale: n.type === 'LA' ? 30 : 1,
        clips: {},
      };
      map.set(id, group);
    }
    group.clips[n.channel] = { file, name: file.name, channel: n.channel };
  }
  return [...map.values()].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
export const formatTime = (s: number) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(
      2,
      '0',
    )}:${Math.floor(s / 60) % 60 < 10 ? '0' : ''}${Math.floor(s / 60) % 60}:${(s % 60).toString().padStart(2, '0')}`;
};
export function orderedChannels(channels: Channel[]) {
  return CHANNELS.filter((c) => channels.includes(c));
}
export function stripRects(channels: Channel[], width: number, height: number) {
  return [...new Set(channels)].map((channel, i, all) => ({
    channel,
    x: 0,
    y: (height * i) / all.length,
    width,
    height: height / all.length,
  }));
}
