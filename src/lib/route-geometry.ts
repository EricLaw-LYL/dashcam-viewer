import type { GPSPoint } from './model';
// Keep a continuous path beneath the speed segments. Tiny individual segments can
// collapse during low-zoom tile quantization even with simplification disabled.
export function routeGeometry(points: GPSPoint[]) {
  const features: any[] = [];
  let run: number[][] = [],
    firstIndex = 0;
  function flush() {
    if (!run.length) return;
    const p = points[firstIndex];
    features.push({
      type: 'Feature',
      properties: { overview: true, speed: p.speed, index: firstIndex },
      geometry: {
        type: run.length > 1 ? 'LineString' : 'Point',
        coordinates: run.length > 1 ? run : run[0],
      },
    });
    if (run.length > 1)
      features.push({
        type: 'Feature',
        properties: { overview: true, speed: p.speed, index: firstIndex },
        geometry: { type: 'Point', coordinates: run[0] },
      });
    run = [];
  }
  points.forEach((p, i) => {
    const a = points[i - 1];
    const connected =
      a &&
      p.timestamp > a.timestamp &&
      (a.segment !== undefined ? a.segment === p.segment : p.timestamp - a.timestamp <= 10);
    if (!connected) {
      flush();
      firstIndex = i;
    }
    run.push([p.lng, p.lat]);
    if (connected)
      features.push({
        type: 'Feature',
        properties: { speed: p.speed, index: i },
        geometry: {
          type: 'LineString',
          coordinates: [
            [a.lng, a.lat],
            [p.lng, p.lat],
          ],
        },
      });
  });
  flush();
  return { type: 'FeatureCollection', features } as any;
}
