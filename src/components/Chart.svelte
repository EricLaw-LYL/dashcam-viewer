<script lang="ts">
  import { onMount } from 'svelte';
  let {
    option,
    title,
    subtitle = '',
    onclick = (_e: any) => {},
  }: { option: any; title: string; subtitle?: string; onclick?: (e: any) => void } = $props();
  let el: HTMLDivElement;
  let chart: any;
  let ready = $state(false);
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
    if (ready)
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
  });
</script>

<section class="chart-card">
  <div class="card-heading">
    <h3>{title}</h3>
    <small>{subtitle}</small>
  </div>
  <div class="chart" bind:this={el}></div>
</section>
