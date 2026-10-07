import { DateTime } from 'luxon';
import { valid, interval, quantile } from './gps';
import type { GPSPoint } from './model';
export interface Filters {
  library: string;
  from: string;
  to: string;
  zone: string;
  moving: number;
  type: string;
  gap: number;
  speedMin: number;
  speedMax: number;
  weekday?: number;
  hour?: number;
  clockOffset?: number;
}
interface Day {
  date: string;
  count: number;
  sum: number;
  max: number;
  km: number;
  seconds: number;
  speeds: number[];
}
export interface Trip {
  start: number;
  end: number;
  km: number;
  seconds: number;
  max: number;
  count: number;
  filename: string;
}
// Only interpolate across short, valid observations. Split at speed boundaries so
// moving-time and threshold metrics don't assume a one-second sampling cadence.
export function portions(a: GPSPoint, b: GPSPoint, thresholds: number[]) {
  const step = interval(a, b);
  if (!step.seconds) return [];
  const cuts = [0, 1];
  if (b.speed !== a.speed)
    for (const speed of thresholds) {
      const fraction = (speed - a.speed) / (b.speed - a.speed);
      if (fraction > 0 && fraction < 1) cuts.push(fraction);
    }
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).map((end, i) => {
    const start = cuts[i],
      seconds = (end - start) * step.seconds,
      speed = a.speed + ((b.speed - a.speed) * (start + end)) / 2;
    return {
      timestamp: a.timestamp + (step.seconds * (start + end)) / 2,
      start: a.timestamp + step.seconds * start,
      end: a.timestamp + step.seconds * end,
      seconds,
      speed,
      km: (speed * seconds) / 3600,
    };
  });
}
export function createAnalysis(f: Filters) {
  const days = new Map<string, Day>(),
    speeds: number[] = [],
    points: GPSPoint[] = [],
    motion: GPSPoint[] = [],
    trips: Trip[] = [],
    parking: Trip[] = [];
  const activity = Array.from({ length: 7 }, () => Array(24).fill(0)),
    bands = [0, 0, 0],
    over = [0, 0, 0],
    types: Record<string, number> = {},
    weekly = new Map<string, number>(),
    timeSpeeds = new Map<number, number>();
  let total = 0,
    invalid = 0,
    prev: GPSPoint | undefined,
    parkPrev: GPSPoint | undefined,
    trip: Trip | undefined,
    park: Trip | undefined,
    km = 0,
    seconds = 0,
    gaps = 0,
    seenTime = -1,
    segment = 0,
    routeStride = 1,
    routeCount = 0,
    lastRoute: GPSPoint | undefined;
  let minute = -1,
    local: DateTime;
  const clock = (t: number) => {
    const m = Math.floor(t / 60);
    if (m !== minute) {
      local = DateTime.fromSeconds(t - (f.clockOffset || 0), { zone: f.zone });
      minute = m;
    }
    return local;
  };
  const selectedDate = (d: string) => !(f.from && d < f.from) && !(f.to && d > f.to);
  const selectedHour = (dt: DateTime) =>
    (f.weekday === undefined || dt.weekday % 7 === f.weekday) &&
    (f.hour === undefined || dt.hour === f.hour);
  const newTrip = (p: GPSPoint): Trip => ({
    start: p.timestamp,
    end: p.timestamp,
    km: 0,
    seconds: 0,
    max: 0,
    count: 0,
    filename: p.filename,
  });
  const dayFor = (date: string) => {
    if (!days.has(date))
      days.set(date, { date, count: 0, sum: 0, max: 0, km: 0, seconds: 0, speeds: [] });
    return days.get(date)!;
  };
  return {
    add(p: GPSPoint) {
      const dt = clock(p.timestamp),
        date = dt.toISODate()!,
        inDate = selectedDate(date);
      if (inDate) {
        total++;
        types[p.type] = (types[p.type] || 0) + 1;
      }
      if (!valid(p)) {
        if (inDate) invalid++;
        prev = undefined;
        parkPrev = undefined;
        segment++;
        return;
      }
      if (p.type === 'PA' && inDate) {
        if (!park || p.timestamp - park.end > f.gap) {
          park = newTrip(p);
          parking.push(park);
        }
        park.end = p.timestamp;
        park.count++;
        if (parkPrev) park.seconds += interval(parkPrev, p).seconds;
        parkPrev = p;
      }
      if (f.type !== 'ALL' && p.type !== f.type) return;
      if (p.timestamp === seenTime) return;
      seenTime = p.timestamp;
      const step = prev ? interval(prev, p) : { seconds: 0, km: 0 };
      if (!prev || !step.seconds) {
        segment++;
        if (prev && inDate && p.timestamp - prev.timestamp > 5) gaps++;
      }
      if (inDate) {
        if (!trip || p.timestamp - trip.end > f.gap) {
          trip = newTrip(p);
          trips.push(trip);
        }
        trip.end = p.timestamp;
        trip.count++;
        trip.max = Math.max(trip.max, p.speed);
      }
      const included =
        inDate &&
        selectedHour(dt) &&
        p.speed >= f.moving &&
        p.speed >= f.speedMin &&
        p.speed <= f.speedMax;
      if (inDate) dayFor(date);
      if (included) {
        const day = dayFor(date);
        day.count++;
        day.sum += p.speed;
        day.max = Math.max(day.max, p.speed);
        day.speeds.push(p.speed);
        speeds.push(p.speed);
        const route = { ...p, segment };
        routeCount++;
        lastRoute = route;
        if (routeCount % routeStride === 0) points.push(route);
        if (points.length > 8000) {
          const kept = points.filter((_, i) => i % 2 === 0);
          points.splice(0, points.length, ...kept);
          routeStride *= 2;
        }
      }
      if (prev && step.seconds) {
        // Insert UTC minute boundaries too: local day/hour and DST boundaries therefore
        // cannot receive a whole interval that actually belongs to a neighboring bucket.
        const edges = [prev.timestamp];
        for (let t = (Math.floor(prev.timestamp / 60) + 1) * 60; t < p.timestamp; t += 60)
          edges.push(t);
        edges.push(p.timestamp);
        for (let i = 1; i < edges.length; i++) {
          const at = (t: number) => ({
            ...p,
            timestamp: t,
            speed: prev!.speed + ((p.speed - prev!.speed) * (t - prev!.timestamp)) / step.seconds,
          });
          for (const part of portions(at(edges[i - 1]), at(edges[i]), [
            f.moving,
            f.speedMin,
            f.speedMax,
            60,
            90,
            100,
            120,
            140,
          ])) {
            const dateTime = clock(part.timestamp),
              partDate = dateTime.toISODate()!;
            if (
              !selectedDate(partDate) ||
              !selectedHour(dateTime) ||
              part.speed < f.moving ||
              part.speed < f.speedMin ||
              part.speed > f.speedMax
            )
              continue;
            const bin = Math.round(part.speed * 10) / 10;
            timeSpeeds.set(bin, (timeSpeeds.get(bin) || 0) + part.seconds);
            const day = dayFor(partDate);
            km += part.km;
            seconds += part.seconds;
            day.km += part.km;
            day.seconds += part.seconds;
            if (trip) {
              trip.km += part.km;
              trip.seconds += part.seconds;
            }
            activity[dateTime.weekday % 7][dateTime.hour] += part.seconds / 60;
            bands[part.speed <= 60 ? 0 : part.speed <= 90 ? 1 : 2] += part.seconds;
            [100, 120, 140].forEach((t, i) => {
              if (part.speed > t) over[i] += part.seconds;
            });
            const week = dateTime
              .minus({ days: dateTime.weekday % 7 })
              .startOf('day')
              .toISODate()!;
            weekly.set(week, (weekly.get(week) || 0) + part.km);
          }
        }
      }
      if (inDate && selectedHour(dt) && motion.length < 5000)
        motion.push({
          ...p,
          deltaSpeed: prev && step.seconds ? (p.speed - prev.speed) / 3.6 / step.seconds : NaN,
          deltaBearing:
            prev && step.seconds && p.speed >= 2
              ? (((p.bearing - prev.bearing + 540) % 360) - 180) / step.seconds
              : NaN,
        } as GPSPoint);
      prev = p;
    },
    finish() {
      const timeSorted = [...timeSpeeds].sort((a, b) => a[0] - b[0]);
      let accumulated = 0;
      const timeCDF = timeSorted.map(([speed, duration]) => {
        accumulated += duration;
        return [speed, seconds ? (accumulated / seconds) * 100 : 0];
      });
      const timeQuantile = (q: number) => timeCDF.find((p) => p[1] >= q * 100)?.[0] || 0;
      const weighted = {
        mean: seconds ? (km * 3600) / seconds : 0,
        median: timeQuantile(0.5),
        p95: timeQuantile(0.95),
        cdf: timeCDF,
        hist: Array(31).fill(0),
      };
      for (const [s, d] of timeSorted) weighted.hist[Math.min(30, Math.floor(s / 5))] += d / 60;
      if (lastRoute && points.at(-1) !== lastRoute) points.push(lastRoute);
      const sorted = [...speeds].sort((a, b) => a - b),
        hist = Array(31).fill(0);
      for (const s of speeds) hist[Math.min(30, Math.floor(s / 5))]++;
      const daily = [...days.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({
          date: d.date,
          count: d.count,
          mean: d.count ? d.sum / d.count : 0,
          max: d.max,
          median: quantile(d.speeds, 0.5),
          p95: quantile(d.speeds, 0.95),
          km: d.km,
          minutes: d.seconds / 60,
        }));
      const rolling = daily.map((d) => {
        const start = DateTime.fromISO(d.date).minus({ days: 6 }).toISODate()!;
        const relevant = daily.filter((x) => x.date >= start && x.date <= d.date && x.count);
        return [
          d.date,
          relevant.length ? relevant.reduce((s, r) => s + r.mean, 0) / relevant.length : null,
        ];
      });
      const motionAxes = ['x', 'y', 'z'] as const;
      const outlierThresholds = Object.fromEntries(
        motionAxes.map((k) => {
          const values = motion.map((p) => p[k]).filter(Number.isFinite);
          return [k, [quantile(values, 0.01), quantile(values, 0.99)]];
        }),
      );
      const candidates: {
        start: number;
        end: number;
        filename: string;
        axes: string[];
        rows: number;
      }[] = [];
      for (const p of motion) {
        const axes = motionAxes.filter(
          (k) =>
            Number.isFinite(p[k]) &&
            (p[k] < outlierThresholds[k][0] || p[k] > outlierThresholds[k][1]),
        );
        if (!axes.length) continue;
        const last = candidates.at(-1);
        if (last && p.timestamp - last.end <= 2 && p.filename === last.filename) {
          last.end = p.timestamp;
          last.rows++;
          last.axes = [...new Set([...last.axes, ...axes])];
        } else
          candidates.push({
            start: p.timestamp,
            end: p.timestamp,
            filename: p.filename,
            axes,
            rows: 1,
          });
      }
      return {
        weighted,
        total,
        invalid,
        gaps,
        count: speeds.length,
        km,
        minutes: seconds / 60,
        mean: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
        median: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        max: sorted.at(-1) || 0,
        daily,
        weekly: [...weekly],
        rolling,
        hist,
        cdf: sorted
          .filter((_, i) => i % Math.max(1, Math.ceil(sorted.length / 300)) === 0)
          .map((s) => [s, (100 * upperBound(sorted, s)) / sorted.length]),
        activity,
        bands: bands.map((s) => s / 60),
        over: over.map((s) => s / 60),
        types,
        trips,
        parking,
        points: points.sort((a, b) => a.timestamp - b.timestamp),
        motion,
        outlierThresholds,
        candidates,
      };
    },
  };
}
function upperBound(a: number[], v: number) {
  let l = 0,
    r = a.length;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (a[m] <= v) l = m + 1;
    else r = m;
  }
  return l;
}
export type Analysis = ReturnType<ReturnType<typeof createAnalysis>['finish']>;
