<script lang="ts">
  import type { Notice } from './HeaderNotice.svelte';
  import PageHeader from './PageHeader.svelte';
  import { onMount, tick } from 'svelte';
  import { DateTime } from 'luxon';
  import RecordingCalendar from './RecordingCalendar.svelte';
  import Chart from './Chart.svelte';
  import RouteMap from './RouteMap.svelte';
  import { gpsJob, download } from '../lib/gps-client';
  import type { Analysis, Filters } from '../lib/analytics';
  import type { GPSPoint } from '../lib/model';
  let {
    notice,
    library,
    revision = 0,
    clockOffset = 0,
    onseek = (_p: GPSPoint) => {},
    onimport = () => {},
  }: {
    notice?: Notice;
    library: string;
    revision?: number;
    clockOffset?: number;
    onseek?: (p: GPSPoint) => void;
    onimport?: () => void;
  } = $props();
  let result = $state<Analysis | null>(null),
    busy = $state(false),
    error = $state(''),
    tab = $state('Overview'),
    from = $state(''),
    to = $state(''),
    moving = $state(2),
    type = $state('NO'),
    gap = $state(300),
    speedMin = $state(0),
    speedMax = $state(250),
    weighting = $state('samples'),
    weekday = $state<number | undefined>(),
    hour = $state<number | undefined>(),
    sortColumn = $state('date'),
    sortAsc = $state(false),
    calendarMetric = $state('km'),
    zone = $state('America/Toronto');
  let job: ReturnType<typeof gpsJob<Analysis>> | undefined;
  const tabs = ['Overview', 'Speed & activity', 'Trips & parking'];
  $effect(() => {
    const payload: Filters = {
      library,
      from,
      to,
      zone,
      moving,
      type,
      gap,
      speedMin,
      speedMax,
      weekday,
      hour,
      clockOffset,
    };
    revision;
    const timer = setTimeout(() => {
      job?.cancel();
      busy = true;
      error = '';
      const current = gpsJob<Analysis>('analyze', payload);
      job = current;
      current.promise
        .then((r) => {
          if (job === current) result = r;
        })
        .catch((e) => {
          if (job === current) error = e.message;
        })
        .finally(() => {
          if (job === current) busy = false;
        });
    }, 200);
    return () => clearTimeout(timer);
  });
  onMount(() => () => job?.cancel());
  const shown = $derived(result ? (weighting === 'time' ? result.weighted : result) : null);
  const sortedDays = $derived(
    result
      ? [...result.daily].sort((a, b) => {
          const value =
            sortColumn === 'date'
              ? a.date.localeCompare(b.date)
              : Number((a as any)[sortColumn]) - Number((b as any)[sortColumn]);
          return sortAsc ? value : -value;
        })
      : [],
  );
  function sortBy(key: string) {
    if (sortColumn === key) sortAsc = !sortAsc;
    else {
      sortColumn = key;
      sortAsc = key === 'date';
    }
  }
  const dayColumns = [
    ['date', 'Date', ''],
    ['km', 'Distance', 'km'],
    ['minutes', 'Moving time', 'min'],
    ['mean', 'Mean speed', 'km/h'],
    ['p95', 'P95', 'km/h'],
    ['count', 'Observations', 'observations'],
  ];
  const maxima = $derived(
    Object.fromEntries(
      dayColumns
        .slice(1)
        .map(([key]) => [
          key,
          Math.max(1, ...(result?.daily || []).map((d) => Number((d as any)[key]))),
        ]),
    ),
  );
  let availableDates = $state<string[]>([]),
    importedCount = $state(0);
  $effect(() => {
    revision;
    const task = gpsJob<{ dates: string[]; count: number }>('calendar', {
      library,
      zone,
      clockOffset,
    });
    task.promise
      .then((r) => {
        availableDates = r.dates;
        importedCount = r.count;
      })
      .catch(() => {});
    return () => task.cancel();
  });
  let calendarScroll: HTMLDivElement | undefined = $state();
  $effect(() => {
    calendarDays;
    calendarScroll;
    void tick().then(() => {
      if (calendarScroll) calendarScroll.scrollTop = calendarScroll.scrollHeight;
    });
  });
  const calendarDays = $derived.by(() => {
    if (!result?.daily.length) return [];
    const firstDay = DateTime.fromISO(result.daily[0].date),
      lastDay = DateTime.fromISO(result.daily.at(-1)!.date);
    const last = lastDay.plus({ days: 6 - (lastDay.weekday % 7) });
    const first = DateTime.min(
      firstDay.minus({ days: firstDay.weekday % 7 }),
      last.minus({ days: 34 }),
    );
    const lookup = new Map(result.daily.map((d) => [d.date, d]));
    const list = [];
    for (let d = first; d <= last; d = d.plus({ days: 1 }))
      list.push({ date: d.toISODate()!, data: lookup.get(d.toISODate()!) });
    return list;
  });
  const num = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d });
  const bar = (labels: any[], values: number[], name = '') => ({
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: number) =>
        `${num(v, name === 'Rows' ? 0 : 1)} ${name === 'Rows' ? 'observations' : name === 'Minutes' ? 'min' : name}`,
    },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', name },
    series: [
      { type: 'bar', data: values, barMaxWidth: 28, itemStyle: { borderRadius: [3, 3, 0, 0] } },
    ],
  });
  function dailyOption() {
    return {
      ...bar(
        result!.daily.map((d) => d.date),
        result!.daily.map((d) => d.km),
        'km',
      ),
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 0 }],
    };
  }
  function reset() {
    from = '';
    to = '';
    moving = 2;
    type = 'NO';
    gap = 300;
    speedMin = 0;
    speedMax = 250;
    weekday = undefined;
    hour = undefined;
  }
  function exportCSV() {
    if (!result) return;
    const rows = [
      'date,observations,mean_kmh,median_kmh,p95_kmh,max_kmh,estimated_km,moving_minutes',
      ...result.daily.map((d) =>
        [d.date, d.count, d.mean, d.median, d.p95, d.max, d.km, d.minutes].join(','),
      ),
    ];
    download(new Blob([rows.join('\n')], { type: 'text/csv' }), 'gps-daily-summary.csv');
  }
  function jump(filename: string, timestamp: number) {
    const p = result?.points.find((p) => p.filename === filename);
    onseek(p ? { ...p, timestamp } : ({ filename, timestamp } as GPSPoint));
  }
</script>

<PageHeader
  title="GPS Analytics"
  notice={notice?.busy
    ? notice
    : busy
      ? { message: 'Calculating GPS analytics…', busy: true }
      : error
        ? {
            message: error,
            dismiss: () => {
              error = '';
            },
          }
        : notice}
>
  <button class="primary" onclick={onimport}>＋ Import GPS</button>
</PageHeader>
<div class="filter-bar">
  <div class="date-filter">
    <span>From</span><RecordingCalendar
      dates={availableDates}
      value={from}
      max={to}
      label="From date"
      placeholder="All dates"
      allowEmptyDays
      onchange={(day) => (from = day)}
    />
  </div>
  <div class="date-filter">
    <span>To</span><RecordingCalendar
      dates={availableDates}
      value={to}
      min={from}
      label="To date"
      placeholder="All dates"
      allowEmptyDays
      onchange={(day) => (to = day)}
    />
  </div>
  <label
    >Recordings<select bind:value={type}
      ><option value="NO">Normal</option><option value="ALL">All types</option><option value="EV"
        >Event</option
      ><option value="PA">Parking</option><option value="LA">Lapse</option></select
    ></label
  ><label>Moving ≥ km/h<input type="number" min="0" max="250" bind:value={moving} /></label><label
    >Timezone<select bind:value={zone}
      ><option>America/Toronto</option><option>UTC</option><option>America/Vancouver</option><option
        >Europe/London</option
      ><option>Asia/Hong_Kong</option></select
    ></label
  ><label
    >Distribution weighting<select bind:value={weighting}
      ><option value="samples">GPS samples</option><option value="time">Observed time</option
      ></select
    ></label
  ><button class="tiny" onclick={reset}>Reset filters</button><span class="status-dot"
    >{busy ? 'Calculating…' : 'Stored locally'}</span
  >
</div>

{#if result && importedCount > 0}
  <div class="metric-grid analytics-kpis">
    <div class="metric">
      <span>IMPORTED OBSERVATIONS</span><strong>{num(importedCount)}</strong>
      <p>Saved in this local library</p>
    </div>
    <div class="metric">
      <span>ESTIMATED DISTANCE</span><strong>{num(result.km, 1)}<small>km</small></strong>
      <p>Valid moving intervals</p>
    </div>
    <div class="metric">
      <span>RECORDED MOVING TIME</span><strong
        >{num(result.minutes < 60 ? result.minutes : result.minutes / 60, 1)}<small
          >{result.minutes < 60 ? 'min' : 'hrs'}</small
        ></strong
      >
      <p>Excludes gaps over 5 seconds</p>
    </div>
    <div class="metric">
      <span>AVERAGE SPEED</span><strong>{num(shown!.mean, 1)}<small>km/h</small></strong>
      <p>
        {weighting === 'time' ? 'Time-weighted · 0.1 km/h bins' : 'Sample-weighted · selected data'}
      </p>
    </div>
    <div class="metric">
      <span>95TH PERCENTILE</span><strong>{num(shown!.p95, 1)}<small>km/h</small></strong>
      <p>Median {num(shown!.median, 1)} · max {num(result.max, 1)}</p>
    </div>
  </div>
  <div class="tabs">
    {#each tabs as t}<button class:active={tab === t} onclick={() => (tab = t)}>{t}</button
      >{/each}<span>{num(result.count)} moving observations</span>
  </div>
  {#if tab === 'Overview'}
    <div class="chart-grid">
      <Chart
        title="Distance by day"
        subtitle="Select a day to explore"
        option={dailyOption()}
        onclick={(e) => {
          from = e.name;
          to = e.name;
        }}
      />
      <section class="chart-card">
        <div class="card-heading">
          <h3>Journey map</h3>
          <small>Click a route to open footage</small>
        </div>
        <div class="analytics-map">
          <RouteMap points={result.points} {onseek} allowFollow={false} />
        </div>
      </section>
    </div>
    <section class="panel">
      <div class="card-heading">
        <h3>Your driving calendar</h3>
        <select bind:value={calendarMetric}
          ><option value="km">Distance</option><option value="mean">Average speed</option><option
            value="median">Median speed</option
          ><option value="max">Maximum speed</option><option value="minutes">Moving minutes</option
          ></select
        >
      </div>
      <div class="calendar-weekdays">
        {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as d}<span>{d}</span>{/each}
      </div>
      <div class="driving-calendar-scroll" bind:this={calendarScroll}>
        <div class="calendar-grid driving-calendar">
          {#each calendarDays as day}<button
              class="day-cell"
              disabled={!day.data}
              title={day.data
                ? `${day.date}: ${num((day.data as any)[calendarMetric], 1)} ${calendarMetric === 'km' ? 'km' : calendarMetric === 'minutes' ? 'min' : 'km/h'}`
                : `${day.date}: no observations`}
              style={`--level:${day.data ? Math.min(0.85, 0.12 + (day.data as any)[calendarMetric] / 200) : 0}`}
              onclick={() => {
                from = day.date;
                to = day.date;
              }}
              ><small>{DateTime.fromISO(day.date).toFormat('MMM d')}</small><strong
                >{day.data ? num((day.data as any)[calendarMetric], 1) : '—'}</strong
              ></button
            >{/each}
        </div>
      </div>
      <small class="muted"
        >Sunday-first calendar · Scroll for earlier or later weeks · — means no observations. Dates
        with valid stationary observations can have zero moving distance.</small
      >
    </section>
    <section class="panel">
      <div class="card-heading">
        <h3>Daily detail</h3>
        <button class="tiny" onclick={exportCSV}>Download CSV ↗</button>
      </div>
      <div class="table-scroll">
        <table>
          <thead
            ><tr
              >{#each dayColumns as [key, label]}<th
                  aria-sort={sortColumn === key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                  ><button class="table-sort" onclick={() => sortBy(key)}
                    >{label}{sortColumn === key ? (sortAsc ? ' ↑' : ' ↓') : ''}</button
                  ></th
                >{/each}</tr
            ></thead
          >
          <tbody
            >{#each sortedDays as d}<tr
                ><td
                  ><button
                    class="text-button"
                    onclick={() => {
                      from = d.date;
                      to = d.date;
                    }}>{d.date}</button
                  ></td
                >
                {#each dayColumns.slice(1) as [key, label, unit]}<td class="data-bar-cell"
                    ><span
                      class="data-bar"
                      style:width={`${(100 * Number((d as any)[key])) / maxima[key]}%`}
                    ></span><span
                      >{num(Number((d as any)[key]), key === 'count' ? 0 : 1)} {unit}</span
                    ></td
                  >{/each}
              </tr>{/each}</tbody
          >
        </table>
      </div>
    </section>
  {:else if tab === 'Speed & activity'}
    {#if hour !== undefined}<button
        class="pill"
        onclick={() => {
          hour = undefined;
          weekday = undefined;
        }}
        >Selected {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday!]} at {hour}:00 ×</button
      >{/if}
    {#if speedMin > 0 || speedMax < 250}<button
        class="pill"
        onclick={() => {
          speedMin = 0;
          speedMax = 250;
        }}>Selected {speedMin}–{speedMax} km/h ×</button
      >{/if}
    <div class="chart-grid">
      <Chart
        title="Speed distribution"
        subtitle="Click a bin to filter · choose weighting above"
        option={bar(
          shown!.hist.map((_, i) => (i === 30 ? '150+ km/h' : `${i * 5}–${i * 5 + 5} km/h`)),
          shown!.hist,
          weighting === 'time' ? 'Minutes' : 'Rows',
        )}
        onclick={(e) => {
          speedMin = e.dataIndex * 5;
          speedMax = e.dataIndex === 30 ? 250 : speedMin + 5;
        }}
      /><Chart
        title="Cumulative distribution"
        subtitle={weighting === 'time'
          ? 'Observed-time percentiles · 0.1 km/h bins'
          : 'Sample-weighted percentiles'}
        option={{
          tooltip: {
            trigger: 'axis',
            formatter: (items: any) => {
              const p = Array.isArray(items) ? items[0] : items;
              return `${num(p.value[0], 1)} km/h: ${num(p.value[1], 1)}%`;
            },
          },
          xAxis: { type: 'value', name: 'km/h' },
          yAxis: { type: 'value', max: 100, name: '%' },
          series: [
            { type: 'line', data: shown!.cdf, showSymbol: false, areaStyle: { opacity: 0.08 } },
          ],
        }}
      /><Chart
        title="Driving activity"
        subtitle="Observed minutes · Sunday to Saturday"
        option={{
          tooltip: {
            position: 'top',
            formatter: (p: any) =>
              `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.value[1]]} ${String(p.value[0]).padStart(2, '0')}:00: ${num(p.value[2], 1)} min`,
          },
          grid: { left: 45, right: 20, bottom: 35, top: 10 },
          xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, i) => i) },
          yAxis: { type: 'category', data: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
          visualMap: {
            show: false,
            min: 0,
            max: Math.max(1, ...result.activity.flat()),
            inRange: { color: ['#182c31', '#70d4bb'] },
          },
          series: [
            {
              type: 'heatmap',
              data: result.activity.flatMap((row, y) => row.map((v, x) => [x, y, v])),
            },
          ],
        }}
        onclick={(e) => {
          hour = e.value[0];
          weekday = e.value[1];
        }}
      /><Chart
        title="Time by speed band"
        subtitle="Speed is a proxy, not a detected road type"
        option={bar(['≤60 km/h', '>60–90 km/h', '>90 km/h'], result.bands, 'Minutes')}
      /><Chart
        title="Above speed thresholds"
        subtitle="Observed minutes · not a legal speed-limit assessment"
        option={bar(['>100 km/h', '>120 km/h', '>140 km/h'], result.over, 'Minutes')}
      /><Chart
        title="Recording types"
        subtitle="All observed rows in selected dates"
        option={bar(Object.keys(result.types), Object.values(result.types), 'Rows')}
      />
    </div>
  {:else if tab === 'Trips & parking'}
    <div class="filter-bar">
      <label
        >New trip after gap (seconds)<input
          type="number"
          min="10"
          max="3600"
          step="30"
          bind:value={gap}
        /></label
      >
      <p>Elapsed trip spans and GPS-observed moving time are different measurements.</p>
    </div>
    <div class="chart-grid">
      <Chart
        title="Trip distance"
        subtitle="Select a trip to inspect footage"
        option={bar(
          result.trips.map((_, i) => i + 1),
          result.trips.map((t) => Number(t.km.toFixed(2))),
          'km',
        )}
        onclick={(e) => {
          const t = result!.trips[e.dataIndex];
          jump(t.filename, t.start);
        }}
      /><Chart
        title="Parking sessions"
        subtitle="Recorded span · does not infer unobserved parking"
        option={bar(
          result.parking.map((_, i) => i + 1),
          result.parking.map((t) => (t.end - t.start) / 60),
          'Minutes',
        )}
      />
    </div>
    <div class="chart-grid">
      <Chart
        title="Weekly distance"
        subtitle="Sunday-first weeks · observed distance"
        option={bar(
          result.weekly.map((r) => r[0]),
          result.weekly.map((r) => r[1]),
          'km',
        )}
      /><Chart
        title="Seven-calendar-day average speed"
        subtitle="Mean of available daily means; absent days are excluded"
        option={{
          tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${num(v, 1)} km/h` },
          xAxis: { type: 'category', data: result.rolling.map((r) => r[0]) },
          yAxis: { type: 'value', name: 'km/h' },
          series: [{ type: 'line', showSymbol: false, data: result.rolling.map((r) => r[1]) }],
        }}
      />
    </div>
    <section class="panel">
      <h3>Trip log</h3>
      <div class="table-scroll">
        <table>
          <thead
            ><tr
              ><th>Start</th><th>Elapsed span</th><th>Observed moving</th><th>Distance</th><th
                >Max speed</th
              ><th></th></tr
            ></thead
          ><tbody
            >{#each result.trips.slice(0, 300) as t}<tr
                ><td
                  >{DateTime.fromSeconds(t.start - clockOffset, { zone }).toFormat(
                    'MMM d · HH:mm',
                  )}</td
                ><td>{num((t.end - t.start) / 60, 1)} min</td><td>{num(t.seconds / 60, 1)} min</td
                ><td>{num(t.km, 1)} km</td><td>{num(t.max, 1)} km/h</td><td
                  ><button class="text-button" onclick={() => jump(t.filename, t.start)}
                    >Open footage →</button
                  ></td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
    </section>
  {/if}
{:else if !busy}<div class="large-empty panel">
    <span>⌁</span>
    <h2>Your history starts here.</h2>
    <p>
      Import hidden GPSData logs or your existing GPS CSV history. Your data stays in this browser.
    </p>
    <button class="primary" onclick={onimport}>Import GPS data →</button>
  </div>{/if}
