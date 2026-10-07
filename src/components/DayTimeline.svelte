<script lang="ts">
  import { DateTime } from 'luxon';
  import Thumbnail from './Thumbnail.svelte';
  import { channelLayout } from '../lib/channel-layout.svelte';
  import { untrack, type Snippet } from 'svelte';
  import { typeName, formatTime } from '../lib/model';
  import type { Recording } from '../lib/model';
  import { groupDuration } from '../lib/media';
  let {
    children,
    recordings,
    selected,
    onseek,
    current = 0,
    zone = 'America/Toronto',
    trim,
    ontrim,
    disabled = false,
    elapsed = false,
    zoom = $bindable(1),
    scroll = $bindable(0),
  }: {
    children?: Snippet;
    recordings: Recording[];
    selected: Recording | null;
    onseek: (r: Recording, seconds: number) => void;
    current?: number;
    zone?: string;
    trim?: { start: number; end: number };
    ontrim?: (start: number, end: number) => void;
    disabled?: boolean;
    elapsed?: boolean;
    zoom?: number;
    scroll?: number;
  } = $props();
  let trackWidth = $state(800);
  let durationsLoading = $state(false);
  let durationFailures = $state(0);
  $effect(() => {
    const items = recordings;
    let cancelled = false;
    untrack(() => {
      const missing = items.filter((r) =>
        Object.values(r.clips).some((c) => c.duration === undefined),
      );
      durationsLoading = missing.length > 0;
      durationFailures = 0;
      let next = 0;
      // Read metadata for the displayed recordings with bounded concurrency.
      // Export timeline entries already carry their trimmed media durations.
      async function read() {
        while (!cancelled && next < missing.length) {
          const recording = missing[next++];
          try {
            await groupDuration(recording);
          } catch {
            if (!cancelled) durationFailures++;
          }
        }
      }
      void Promise.all(Array.from({ length: Math.min(3, missing.length) }, read)).then(() => {
        if (!cancelled) durationsLoading = false;
      });
    });
    return () => {
      cancelled = true;
    };
  });
  const duration = (r: Recording) =>
    Math.max(0, ...Object.values(r.clips).map((c) => c.duration ?? 0));
  const start = $derived(recordings[0]?.start || 0);
  const end = $derived(
    Math.max(
      start + 1,
      ...recordings.filter((r) => duration(r) > 0).map((r) => r.start + duration(r) * r.scale),
    ),
  );
  const span = $derived(Math.max(1, (end - start) / zoom));
  const windowStart = $derived(start + ((end - start - span) * scroll) / 100);
  const position = $derived(((current - windowStart) / span) * 100);
  $effect(() => {
    const at = current;
    if (!selected || zoom <= 1 || at < start || at > end) return;
    const visibleSpan = span;
    const panRange = end - start - visibleSpan;
    // Follow playback/seeks when they leave the window. Manual panning alone
    // must not snap back to the paused playhead.
    untrack(() => {
      const left = start + (panRange * scroll) / 100;
      if (panRange > 0 && (at < left || at > left + visibleSpan)) {
        scroll = Math.max(0, Math.min(100, ((at - start - visibleSpan / 2) / panRange) * 100));
      }
    });
  });
  const stamp = (epoch: number) =>
    elapsed
      ? formatTime(epoch - start)
      : DateTime.fromSeconds(epoch, { zone }).toFormat('HH:mm:ss');
  let hover = $state<{ x: number; time: number } | null>(null);
  let hoverEdge = $state<'start' | 'end' | null>(null);
  const hoverEpoch = $derived(
    hover ? Math.max(start, hover.time - (hoverEdge === 'end' ? 0.001 : 0)) : 0,
  );
  const hoverRecording = $derived(
    hover
      ? recordings.find(
          (r) => hoverEpoch >= r.start && hoverEpoch < r.start + duration(r) * r.scale,
        )
      : undefined,
  );
  const hoverClip = $derived(
    hoverRecording
      ? (channelLayout.visible.includes('F') ? hoverRecording.clips.F : undefined) ||
          channelLayout.order
            .filter((c) => channelLayout.visible.includes(c))
            .map((c) => hoverRecording.clips[c])
            .find(Boolean) ||
          Object.values(hoverRecording.clips)[0]
      : undefined,
  );
  const hoverSeconds = $derived(
    hover && hoverRecording
      ? (hoverRecording.previewOffset || 0) +
          (hoverEpoch - hoverRecording.start) / hoverRecording.scale
      : 0,
  );
  function hoverAt(e: MouseEvent) {
    hoverEdge = null;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    hover = { x: x * 100, time: windowStart + x * span };
  }
  const ticks = $derived.by(() => {
    if (!recordings.length) return [];
    const target = span / Math.max(1, Math.floor(trackWidth / 90));
    const step =
      [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400].find(
        (seconds) => seconds >= target,
      ) ?? 86400;
    const format = step >= 3600 ? 'HH' : 'HH:mm';
    const origin = DateTime.fromSeconds(windowStart, { zone }).startOf('day').toSeconds();
    const first = origin + Math.ceil((windowStart - origin) / step) * step;
    const result = [];
    for (let time = first; time <= windowStart + span; time += step) {
      result.push({
        position: ((time - windowStart) / span) * 100,
        label: elapsed
          ? formatTime(time - start)
          : DateTime.fromSeconds(time, { zone }).toFormat(format),
      });
    }
    // A sub-minute window needs just one minute label, not repeated identical labels.
    if (!result.length)
      result.push({
        position: 0,
        label: elapsed
          ? formatTime(windowStart - start)
          : DateTime.fromSeconds(windowStart, { zone }).toFormat('HH:mm'),
      });
    return result;
  });
  function seekAt(epoch: number) {
    if (!recordings.length) return;
    // In gaps, seek to the closest available footage rather than an invented timestamp.
    let target: Recording | undefined,
      distance = Infinity;
    for (const r of recordings) {
      if (duration(r) <= 0) continue;
      const finish = r.start + duration(r) * r.scale;
      const d = epoch < r.start ? r.start - epoch : epoch > finish ? epoch - finish : 0;
      if (d < distance) {
        target = r;
        distance = d;
      }
    }
    if (target)
      onseek(
        target,
        Math.max(0, Math.min(duration(target), (epoch - target.start) / target.scale)),
      );
  }
  function setTrimEdge(edge: 'start' | 'end', value: number) {
    if (!trim || disabled || !recordings.length) return;
    const at =
      edge === 'start'
        ? Math.max(start, Math.min(trim.end - 0.01, value))
        : Math.min(end, Math.max(trim.start + 0.01, value));
    hoverEdge = edge;
    hover = { x: Math.max(0, Math.min(100, ((at - windowStart) / span) * 100)), time: at };
    if (edge === 'start') ontrim?.(at, trim.end);
    else ontrim?.(trim.start, at);
  }
  function dragTrim(e: PointerEvent, edge: 'start' | 'end') {
    const handle = e.currentTarget as HTMLButtonElement;
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const box = handle.closest('.single-day-track')!.getBoundingClientRect();
    setTrimEdge(
      edge,
      windowStart + Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * span,
    );
  }
  function keyTrim(e: KeyboardEvent, edge: 'start' | 'end') {
    if (!trim) return;
    const step = e.shiftKey ? 1 : 0.1;
    const values: Record<string, number> = {
      ArrowLeft: trim[edge] - step,
      ArrowDown: trim[edge] - step,
      ArrowRight: trim[edge] + step,
      ArrowUp: trim[edge] + step,
      Home: edge === 'start' ? start : trim.start + 0.01,
      End: edge === 'end' ? end : trim.end - 0.01,
    };
    if (e.key in values) {
      e.preventDefault();
      setTrimEdge(edge, values[e.key]);
    }
  }
  function changeZoom(value: number) {
    const anchor = selected && current >= start && current <= end ? current : start;
    zoom = Math.max(1, Math.min(48, value));
    const nextSpan = (end - start) / zoom;
    scroll =
      end - start > nextSpan
        ? Math.max(
            0,
            Math.min(100, ((anchor - start - nextSpan / 2) / (end - start - nextSpan)) * 100),
          )
        : 0;
  }
</script>

<section class="day-timeline panel" aria-busy={durationsLoading}>
  <div class="card-heading">
    <div>
      <h3>Timeline</h3>
      <output class="playing-timestamp" aria-label="Current playback timestamp"
        >{selected ? stamp(current) : 'No recording selected'}{durationsLoading
          ? ' · Reading durations…'
          : durationFailures
            ? ' · Some durations unavailable'
            : ''}</output
      >
    </div>
    <div class="timeline-zoom">
      <button
        aria-label="Zoom out timeline"
        disabled={zoom <= 1}
        onclick={() => changeZoom(zoom / 2)}>−</button
      ><input
        aria-label="Timeline zoom"
        type="range"
        min="1"
        max="48"
        step=".25"
        value={zoom}
        oninput={(e) => changeZoom(Number(e.currentTarget.value))}
      /><button
        aria-label="Zoom in timeline"
        disabled={zoom >= 48}
        onclick={() => changeZoom(zoom * 2)}>＋</button
      ><small>{zoom.toFixed(zoom % 1 ? 1 : 0)}×</small>
    </div>
  </div>
  <div class="timeline-track-wrap">
    {#if hover && recordings.length}<output
        class="timeline-hover"
        style:left={`${hover.x}%`}
        style:transform={`translateX(-${hover.x}%)`}
        >{#if hoverClip}<Thumbnail
            clip={hoverClip}
            seconds={hoverSeconds}
            delay={100}
          />{:else}<span class="hover-no-footage">No footage</span>{/if}
        <span class="hover-time"
          >{elapsed
            ? formatTime(hover.time - start)
            : DateTime.fromSeconds(hover.time, { zone }).toFormat('HH:mm')}</span
        ></output
      >{/if}
    <div class="single-day-track" bind:clientWidth={trackWidth}>
      {#each recordings as r}{@const left = ((r.start - windowStart) / span) * 100}{@const width =
          ((duration(r) * r.scale) / span) *
          100}{#if width > 0 && left + width >= 0 && left <= 100}<button
            class={`day-block ${r.type}`}
            class:selected={selected?.id === r.id}
            style={`left:${Math.max(0, left)}%;width:${Math.max(0.2, Math.min(100, left + width) - Math.max(0, left))}%`}
            aria-label={`${r.time} ${typeName[r.type]}`}
            title={`${r.time} · ${typeName[r.type]}`}
            onclick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const visibleStart = Math.max(r.start, windowStart);
              const visibleEnd = Math.min(r.start + duration(r) * r.scale, windowStart + span);
              onseek(
                r,
                (visibleStart +
                  ((e.clientX - rect.left) / rect.width) * (visibleEnd - visibleStart) -
                  r.start) /
                  r.scale,
              );
            }}
          ></button>{/if}{/each}
      {#if trim}
        <div
          class="trim-excluded"
          style:left="0%"
          style:width={`${Math.max(0, Math.min(100, ((trim.start - windowStart) / span) * 100))}%`}
        ></div>
        <div
          class="trim-excluded"
          style:right="0%"
          style:width={`${Math.max(0, Math.min(100, ((windowStart + span - trim.end) / span) * 100))}%`}
        ></div>
      {/if}
      {#if trim && recordings.length}
        <div
          class="trim-selection"
          style:left={`${Math.max(0, Math.min(100, ((trim.start - windowStart) / span) * 100))}%`}
          style:right={`${100 - Math.max(0, Math.min(100, ((trim.end - windowStart) / span) * 100))}%`}
        ></div>
        {#each ['start', 'end'] as edge}
          {@const side = edge as 'start' | 'end'}
          <button
            class="trim-handle"
            class:trim-end={side === 'end'}
            style:left={`${Math.max(0, Math.min(100, ((trim[side] - windowStart) / span) * 100))}%`}
            role="slider"
            aria-label={side === 'start' ? 'Trim start' : 'Trim end'}
            aria-valuemin={side === 'start' ? start : trim.start + 0.01}
            aria-valuemax={side === 'start' ? trim.end - 0.01 : end}
            aria-valuenow={trim[side]}
            aria-valuetext={stamp(trim[side])}
            title={`${side === 'start' ? 'Trim start' : 'Trim end'}: ${stamp(trim[side])}`}
            disabled={disabled || !recordings.length}
            onpointerdown={(e) => {
              e.preventDefault();
              e.currentTarget.focus();
              setTrimEdge(side, trim[side]);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onpointermove={(e) => dragTrim(e, side)}
            onpointerup={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              hover = null;
              hoverEdge = null;
            }}
            onpointercancel={() => {
              hover = null;
              hoverEdge = null;
            }}
            onblur={() => {
              hover = null;
              hoverEdge = null;
            }}
            onkeydown={(e) => keyTrim(e, side)}>{side === 'start' ? '❮' : '❯'}</button
          >
        {/each}
      {/if}
      <input
        class="overview-seek"
        type="range"
        aria-label="Seek recording"
        aria-valuetext={selected ? stamp(current) : 'No recording selected'}
        min={windowStart}
        max={windowStart + span}
        step="any"
        value={Math.max(windowStart, Math.min(windowStart + span, current))}
        disabled={disabled || !recordings.length}
        onmousemove={hoverAt}
        onmouseleave={() => (hover = null)}
        oninput={(e) => seekAt(Number(e.currentTarget.value))}
      />
    </div>
  </div>
  <div class="timeline-labels">
    {#each ticks as tick}
      <span style:left={`${tick.position}%`} style:transform={`translateX(-${tick.position}%)`}
        >{tick.label}</span
      >
    {/each}
  </div>
  <div class="timeline-pan" class:inactive={zoom <= 1}>
    <input
      type="range"
      min="0"
      max="100"
      step="any"
      bind:value={scroll}
      disabled={zoom <= 1 || !recordings.length}
      aria-label="Pan day timeline"
    />
  </div>
  {@render children?.()}
</section>
