import { describe, it, expect } from 'vitest';
import { parseName, catalog, stripRects } from '../src/lib/model';
import { parseGPS, interval, quantile } from '../src/lib/gps';
import { createAnalysis } from '../src/lib/analytics';
const row = (timestamp: number, speed = 1000, status = 'A') =>
  parseGPS(
    `${timestamp},${status},43.8,-79.4,9000,${speed},1,2,3,NO20260923-175328-003563F.MP4,0,0,0`,
    'test',
  )!;
describe('recordings', () => {
  it('supports legacy rear suffix and uppercase files', () => {
    expect(parseName('NO20260923-175328-003563B.MP4')?.channel).toBe('R');
    expect(parseName('bad.mp4')).toBeNull();
  });
  it('groups all channels and applies 30x only to capture time', () => {
    const files = ['R', 'F', 'C'].map((c) => new File([''], `LA20260923-175328-003563${c}.MP4`));
    const r = catalog(files);
    expect(r).toHaveLength(1);
    expect(r[0].scale).toBe(30);
    expect(Object.keys(r[0].clips)).toHaveLength(3);
  });
  it('lays out all seven channel subsets without empty strips', () => {
    for (let mask = 1; mask < 8; mask++) {
      const channels = (['R', 'F', 'C'] as const).filter((_, i) => mask & (1 << i));
      const rects = stripRects([...channels].reverse(), 1920, 1080 * channels.length);
      expect(rects.map((r) => r.channel)).toEqual([...channels].reverse());
      expect(rects.reduce((s, r) => s + r.height, 0)).toBe(1080 * channels.length);
      expect(rects.every((r) => r.width === 1920 && r.height === 1080)).toBe(true);
    }
  });
});
describe('GPS', () => {
  it('uses cm/s and centidegrees without inventing sensor units', () => {
    expect(row(1790171644).speed).toBe(36);
    expect(row(1790171644).bearing).toBe(90);
    expect(row(1790171644).x).toBe(1);
  });
  it('normalizes the observed padded MP44 filename while preserving raw fields', () => {
    const p = parseGPS(
      '1790171644,A,43.8,-79.4,9000,1000,1,2,3,NO20260923-175328-003563F.MP44,0,0,0',
      'test',
    )!;
    expect(p.filename.endsWith('.MP4')).toBe(true);
    expect(p.raw[9].endsWith('.MP44')).toBe(true);
  });
  it('integrates real irregular intervals and excludes gaps/invalid endpoints', () => {
    expect(interval(row(100), row(102))).toEqual({ seconds: 2, km: 0.02 });
    expect(interval(row(100), row(108)).km).toBe(0);
    expect(interval(row(100), row(101, 1000, 'V')).km).toBe(0);
  });
  it('matches linear sample percentiles', () =>
    expect(quantile([0, 10, 20, 30], 0.95)).toBeCloseTo(28.5));
  it('does not integrate across an invalid fix', () => {
    const a = createAnalysis({
      library: 'test',
      from: '',
      to: '',
      zone: 'UTC',
      moving: 2,
      type: 'NO',
      gap: 300,
      speedMin: 0,
      speedMax: 250,
    });
    [row(100), row(101, 1000, 'V'), row(102)].forEach(a.add);
    const r = a.finish();
    expect(r.km).toBe(0);
    expect(r.invalid).toBe(1);
  });
});

describe('analysis boundary cases', () => {
  const filters = {
    library: 'test',
    from: '',
    to: '',
    zone: 'UTC',
    moving: 2,
    type: 'NO',
    gap: 300,
    speedMin: 0,
    speedMax: 250,
  };
  it('includes the correct portion of an interval crossing the moving threshold', () => {
    const a = createAnalysis(filters);
    a.add(row(100, 0));
    a.add(row(102, 1000));
    const r = a.finish();
    expect(r.minutes * 60).toBeCloseTo(2 * (1 - 2 / 36));
    expect(r.km).toBeCloseTo(0.01 - (2 * (2 / 36) * 1) / 3600);
  });
  it('allocates an interval on midnight to both actual days', () => {
    const a = createAnalysis({ ...filters, moving: 0 });
    a.add(row(Date.parse('2026-09-23T23:59:59Z') / 1000));
    a.add(row(Date.parse('2026-09-24T00:00:01Z') / 1000));
    const r = a.finish();
    expect(r.daily.map((d) => d.km)).toEqual([0.01, 0.01]);
  });
  it('uses only the selected day portion at a date boundary', () => {
    const a = createAnalysis({ ...filters, moving: 0, from: '2026-09-24', to: '2026-09-24' });
    a.add(row(Date.parse('2026-09-23T23:59:59Z') / 1000));
    a.add(row(Date.parse('2026-09-24T00:00:01Z') / 1000));
    expect(a.finish().km).toBe(0.01);
  });
  it('applies the visible GPS offset to calendar grouping without changing raw timestamps', () => {
    const a = createAnalysis({ ...filters, clockOffset: -8 * 3600 });
    const p = row(Date.parse('2026-09-23T20:00:00Z') / 1000);
    a.add(p);
    expect(a.finish().daily[0].date).toBe('2026-09-24');
    expect(p.timestamp).toBe(Date.parse('2026-09-23T20:00:00Z') / 1000);
  });
  it('does not bridge separate trips or draw across a GPS gap', () => {
    const a = createAnalysis(filters);
    [row(100), row(102), row(500), row(502)].forEach(a.add);
    const r = a.finish();
    expect(r.trips).toHaveLength(2);
    expect(r.km).toBe(0.04);
    expect(r.points[0].segment).not.toBe(r.points[2].segment);
  });
  it('distinguishes sample-weighted and time-weighted mean', () => {
    const a = createAnalysis({ ...filters, moving: 0 });
    [row(100, 0), row(101, 1000), row(105, 1000)].forEach(a.add);
    const r = a.finish();
    expect(r.mean).toBe(24);
    expect(r.weighted.mean).toBeCloseTo(32.4);
  });
});
