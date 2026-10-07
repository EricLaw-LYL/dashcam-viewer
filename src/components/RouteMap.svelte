<script lang="ts">
  import { routeGeometry } from '../lib/route-geometry';
  import { onMount, untrack } from 'svelte';
  import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import type { GPSPoint } from '../lib/model';
  import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
  let {
    points = [],
    current = 0,
    allowFollow = true,
    onseek = (_p: GPSPoint) => {},
  }: {
    points: GPSPoint[];
    allowFollow?: boolean;
    current?: number;
    onseek?: (p: GPSPoint) => void;
  } = $props();
  let element: HTMLDivElement;
  let heading = $state<number | null>(null);
  let map: MLMap | undefined;
  let loaded = $state(false),
    online = $state(false),
    error = $state(''),
    follow = $state(false);
  const geometry = () => routeGeometry(points);
  function currentPoint() {
    let low = 0,
      high = points.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (points[mid].timestamp < current) low = mid + 1;
      else high = mid;
    }
    const a = points[low - 1],
      b = points[low];
    if (
      a &&
      b &&
      b.timestamp > a.timestamp &&
      b.timestamp - a.timestamp <= 10 &&
      a.segment === b.segment
    ) {
      const t = (current - a.timestamp) / (b.timestamp - a.timestamp);
      const turn = ((b.bearing - a.bearing + 540) % 360) - 180;
      return {
        ...a,
        timestamp: current,
        lng: a.lng + (b.lng - a.lng) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        bearing: a.bearing + turn * t,
      };
    }
    const point = !a ? b : !b ? a : current - a.timestamp < b.timestamp - current ? a : b;
    return point && Math.abs(point.timestamp - current) < 10 ? point : undefined;
  }

  function startFollowing() {
    const point = currentPoint();
    if (!map || !point) return;
    follow = true;
    map.easeTo({ center: [point.lng, point.lat], zoom: 16, padding: 0, duration: 500 });
  }
  function fit() {
    follow = false;
    fitRoute();
  }
  function fitRoute() {
    if (!map || !points.length) return;
    let minX = 180,
      minY = 90,
      maxX = -180,
      maxY = -90;
    for (const p of points) {
      minX = Math.min(minX, p.lng);
      maxX = Math.max(maxX, p.lng);
      minY = Math.min(minY, p.lat);
      maxY = Math.max(maxY, p.lat);
    }
    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      {
        padding: { top: 55, bottom: 35, left: 30, right: 30 },
        maxZoom: 15,
        bearing: 0,
        pitch: 0,
        duration: 500,
      },
    );
  }
  onMount(() => {
    let disposed = false;
    let observer: ResizeObserver;
    import('maplibre-gl')
      .then(async (ml) => {
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (disposed) return;
        if (import.meta.env.PROD) ml.setWorkerUrl(mapWorkerUrl);
        map = new ml.Map({
          container: element,
          style: {
            version: 8,
            sources: {},
            layers: [
              { id: 'background', type: 'background', paint: { 'background-color': '#142329' } },
            ],
          },
          center: [-79.4, 43.8],
          zoom: 10,
          attributionControl: false,
        });
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          map!.addSource('route', {
            type: 'geojson',
            tolerance: 0,
            buffer: 128,
            maxzoom: 18,
            data: geometry(),
          });
          map!.addLayer({
            id: 'route-overview',
            type: 'line',
            source: 'route',
            filter: ['==', ['get', 'overview'], true],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-width': 3, 'line-color': '#fbc02d' },
          });
          map!.addLayer({
            id: 'route-location',
            type: 'circle',
            source: 'route',
            maxzoom: 11,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': 3, 'circle-color': '#fbc02d' },
          });
          map!.addLayer({
            id: 'route',
            filter: ['!=', ['get', 'overview'], true],
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-width': 4,
              'line-color': [
                'interpolate',
                ['linear'],
                ['get', 'speed'],
                0,
                '#e53935',
                20,
                '#f57c00',
                50,
                '#fbc02d',
                80,
                '#43a047',
                120,
                '#188038',
              ],
            },
          });
          map!.addSource('cursor', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map!.addLayer({
            id: 'cursor',
            type: 'circle',
            source: 'cursor',
            paint: {
              'circle-radius': 6,
              'circle-color': '#fff',
              'circle-stroke-width': 4,
              'circle-stroke-color': '#54c5b0',
            },
          });
          const arrow = document.createElement('canvas');
          arrow.width = arrow.height = 48;
          const ctx = arrow.getContext('2d')!;
          ctx.beginPath();
          ctx.moveTo(24, 3);
          ctx.lineTo(41, 42);
          ctx.lineTo(24, 33);
          ctx.lineTo(7, 42);
          ctx.closePath();
          ctx.fillStyle = '#62dac2';
          ctx.fill();
          ctx.strokeStyle = '#102830';
          ctx.lineWidth = 3;
          ctx.stroke();
          map!.addImage('travel-arrow', ctx.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
          map!.addLayer({
            id: 'direction',
            type: 'symbol',
            source: 'cursor',
            filter: ['has', 'bearing'],
            layout: {
              'icon-image': 'travel-arrow',
              'icon-rotate': ['get', 'bearing'],
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
          });
          map!.addLayer({
            id: 'route-hit',
            type: 'line',
            source: 'route',
            paint: { 'line-width': 18, 'line-opacity': 0 },
          });
          map!.on('mouseenter', 'route-hit', () => {
            map!.getCanvas().style.cursor = 'pointer';
          });
          map!.on('mouseleave', 'route-hit', () => {
            map!.getCanvas().style.cursor = '';
          });
          const selectNear = (e: any) => {
            let nearest: GPSPoint | undefined,
              distance = Infinity;
            for (const p of points) {
              const pixel = map!.project([p.lng, p.lat]);
              const d = (pixel.x - e.point.x) ** 2 + (pixel.y - e.point.y) ** 2;
              if (d < distance) {
                distance = d;
                nearest = p;
              }
            }
            if (nearest) onseek(nearest);
          };
          map!.on('click', 'route-hit', selectNear);
          map!.on('click', 'route-location', selectNear);
          map!.on('mouseenter', 'route-location', () => {
            map!.getCanvas().style.cursor = 'pointer';
          });
          map!.on('mouseleave', 'route-location', () => {
            map!.getCanvas().style.cursor = '';
          });
          toggleTiles();
          loaded = true;
          fitRoute();
        });
        map.on('zoomstart', (e) => {
          if (e.originalEvent) follow = false;
        });
        map.on('dragstart', () => (follow = false));
        map.on('error', (e) => (error = e.error.message));
        observer = new ResizeObserver(() => map?.resize());
        observer.observe(element);
      })
      .catch((e) => (error = e.message));
    return () => {
      disposed = true;
      observer?.disconnect();
      map?.remove();
    };
  });
  $effect(() => {
    if (loaded) {
      (map?.getSource('route') as GeoJSONSource)?.setData(geometry());
      untrack(() => {
        if (!follow) fitRoute();
      });
    }
  });
  $effect(() => {
    if (!loaded || !map) return;
    const p = currentPoint();
    heading =
      p && Math.abs(p.timestamp - current) < 10 && Number.isFinite(p.bearing)
        ? ((p.bearing % 360) + 360) % 360
        : null;
    (map.getSource('cursor') as GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features:
        p && Math.abs(p.timestamp - current) < 10
          ? [
              {
                type: 'Feature',
                properties: Number.isFinite(p.bearing)
                  ? { bearing: ((p.bearing % 360) + 360) % 360 }
                  : {},
                geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
              },
            ]
          : [],
    });
    if (follow && p && Math.abs(p.timestamp - current) < 10)
      map.easeTo({
        center: [p.lng, p.lat],
        zoom: Math.max(16, map.getZoom()),
        padding: 0,
        duration: 300,
        easing: (t) => t,
      });
  });
  function toggleTiles() {
    if (!map) return;
    online = !online;
    if (online) {
      map.addSource('tiles', {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      });
      map.addLayer(
        { id: 'tiles', type: 'raster', source: 'tiles', paint: { 'raster-opacity': 0.65 } },
        'route-overview',
      );
    } else {
      map.removeLayer('tiles');
      map.removeSource('tiles');
    }
  }
</script>

<div class="map-wrap">
  <div class="map" bind:this={element}></div>
  <div class="map-toolbar">
    <button
      class="tiny map-toggle"
      role="switch"
      aria-label="Online map"
      aria-checked={online}
      disabled={!loaded}
      onclick={toggleTiles}>Online map {online ? 'On' : 'Off'}</button
    ><button class="tiny" disabled={!loaded || !points.length} onclick={fit}>Fit route</button
    >{#if allowFollow}<button
        class:active={follow}
        class="tiny"
        aria-pressed={follow}
        disabled={!loaded || !currentPoint()}
        onclick={startFollowing}>Follow</button
      >{/if}
  </div>
  {#if !points.length}<div class="map-empty">
      <span>⌁</span><strong>Your journey, mapped.</strong>
      <p>Import GPS data to explore your route.</p>
    </div>{/if}
  {#if heading !== null}<output class="map-heading" aria-label="Travel direction"
      >↑ {Math.round(heading)}° {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
        Math.round(heading / 45) % 8
      ]}</output
    >{/if}
  <div class="osm-credit">
    Map data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
      >OpenStreetMap</a
    >
  </div>
  {#if error}<small class="map-error">{error}</small>{/if}
</div>
