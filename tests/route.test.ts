import { expect, it } from 'vitest';
import { routeGeometry } from '../src/lib/route-geometry';
import type { GPSPoint } from '../src/lib/model';
it('retains continuous overview geometry while keeping gaps and speed segments separate', () => {
  const points = Array.from(
    { length: 6 },
    (_, i) =>
      ({
        timestamp: i < 3 ? i : i + 100,
        lng: -79 + i * 0.00001,
        lat: 43,
        speed: i * 10,
        segment: i < 3 ? 0 : 1,
      }) as GPSPoint,
  );
  const features = routeGeometry(points).features;
  const runs = features.filter(
    (f: any) => f.properties.overview && f.geometry.type === 'LineString',
  );
  expect(runs).toHaveLength(2);
  expect(runs.map((r: any) => r.geometry.coordinates.length)).toEqual([3, 3]);
  expect(features.filter((f: any) => !f.properties.overview)).toHaveLength(4);
  expect(features.filter((f: any) => f.geometry.type === 'Point')).toHaveLength(2);
});
