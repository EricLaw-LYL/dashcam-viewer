<script lang="ts">
  import { onMount } from 'svelte';
  let {
    option,
    title,
    subtitle = '',
    zoomControls = false,
    onclick = (_e: any) => {},
  }: {
    option: any;
    title: string;
    subtitle?: string;
    zoomControls?: boolean;
    onclick?: (e: any) => void;
  } = $props();
  let el: HTMLDivElement;
  let chart: any;
  let ready = $state(false);
  let rangeStart = $state('');
  let rangeEnd = $state('');
  function updateRange() {
    if (!zoomControls || !chart) return;
    const options = chart.getOption();
    const dates = options.xAxis?.[0]?.data || [];
    const zoom = options.dataZoom?.[0];
    if (!dates.length || !zoom) return;
    const first = zoom.startValue ?? Math.round(((dates.length - 1) * (zoom.start ?? 0)) / 100);
    const last = zoom.endValue ?? Math.round(((dates.length - 1) * (zoom.end ?? 100)) / 100);
    rangeStart = String(dates[first] ?? first);
    rangeEnd = String(dates[last] ?? last);
  }
  function resetZoom() {
    chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    updateRange();
  }
  onMount(() => {
    let dead = false;
    let observer: ResizeObserver;
    Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ]).then(([core, c, components, r]) => {
      if (dead) return;
      core.use([
        c.BarChart,
        c.LineChart,
        c.HeatmapChart,
        c.ScatterChart,
        components.GridComponent,
        components.TooltipComponent,
        components.LegendComponent,
        components.VisualMapComponent,
        components.DataZoomComponent,
        components.CalendarComponent,
        r.CanvasRenderer,
      ]);
      chart = core.init(el);
      chart.on('click', onclick);
      chart.on('datazoom', updateRange);
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(el);
      ready = true;
    });
    return () => {
      dead = true;
      observer?.disconnect();
      chart?.dispose();
    };
  });
  $effect(() => {
    if (ready) {
      chart.setOption(
        {
          backgroundColor: 'transparent',
          color: ['#6cceb8', '#a6c8eb', '#e2b777'],
          textStyle: { color: '#9baab2', fontFamily: 'system-ui' },
          tooltip: { trigger: 'axis' },
          grid: { top: 30, right: 22, bottom: 40, left: 52 },
          xAxis: { axisLine: { lineStyle: { color: '#304047' } }, axisLabel: { color: '#8d9da6' } },
          yAxis: {
            splitLine: { lineStyle: { color: '#25343c' } },
            axisLabel: { color: '#8d9da6' },
          },
          ...option,
        },
        true,
      );
      updateRange();
    }
  });
</script>

<section class="chart-card">
  <div class="card-heading" class:chart-zoom-heading={zoomControls}>
    <div>
      <h3>{title}</h3>
      <small>{subtitle}</small>
    </div>
    {#if zoomControls}<button class="tiny" disabled={!ready} onclick={resetZoom}>Reset zoom</button
      >{/if}
  </div>
  <div class="chart" bind:this={el}></div>
  {#if zoomControls}<div class="chart-zoom-dates" aria-label="Visible date range">
      <span>Start <strong>{rangeStart}</strong></span><span>End <strong>{rangeEnd}</strong></span>
    </div>{/if}
</section>
