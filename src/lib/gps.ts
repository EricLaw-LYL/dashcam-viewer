import type { GPSPoint } from './model';
export const RAW = [
  'timestamp',
  'status',
  'lat',
  'lng',
  'bearing_centideg',
  'speed_cm_s',
  'accel_x',
  'accel_y',
  'accel_z',
  'filename',
  'flag1',
  'flag2',
  'flag3',
];
export function csvRow(line: string): string[] {
  const result: string[] = [];
  let value = '',
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      result.push(value);
      value = '';
    } else value += c;
  }
  result.push(value);
  return result;
}
export function parseGPS(line: string, library: string, columns = RAW): GPSPoint | null {
  const parts = csvRow(line.trim());
  if (parts.length !== columns.length) return null;
  const v = Object.fromEntries(columns.map((c, i) => [c, parts[i]]));
  const filename = v.filename?.toUpperCase().replace(/\.MP4{2,}$/i, '.MP4');
  const number = (k: string) => (v[k]?.trim() ? Number(v[k]) : NaN);
  const timestamp = number('timestamp'),
    lat = number('lat'),
    lng = number('lng');
  const speed = columns.includes('speed_kmh') ? number('speed_kmh') : number('speed_cm_s') * 0.036;
  const bearing = columns.includes('bearing_deg')
    ? number('bearing_deg')
    : number('bearing_centideg') / 100;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !filename || !['A', 'V'].includes(v.status))
    return null;
  return {
    key: `${library}|${timestamp}|${filename}`,
    library,
    timestamp,
    filename,
    type: filename.slice(0, 2),
    status: v.status,
    lat,
    lng,
    speed,
    bearing,
    x: number('accel_x'),
    y: number('accel_y'),
    z: number('accel_z'),
    raw: parts,
  };
}
export const valid = (p: GPSPoint) =>
  p.status === 'A' &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180 &&
  !(p.lat === 0 && p.lng === 0) &&
  Number.isFinite(p.speed) &&
  p.speed >= 0;
export function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const a = [...values].sort((a, b) => a - b),
    i = (a.length - 1) * q,
    l = Math.floor(i);
  return a[l] + (a[Math.ceil(i)] - a[l]) * (i - l);
}
export function interval(a: GPSPoint, b: GPSPoint, limit = 5) {
  const dt = b.timestamp - a.timestamp;
  return a.library === b.library && valid(a) && valid(b) && dt > 0 && dt <= limit
    ? { seconds: dt, km: (((a.speed + b.speed) / 2) * dt) / 3600 }
    : { seconds: 0, km: 0 };
}
