<script lang="ts">
  import type { Notice } from './HeaderNotice.svelte';
  import PageHeader from './PageHeader.svelte';
  import { onDestroy, untrack } from 'svelte';
  import ReviewPane from './ReviewPane.svelte';
  import { channelLayout } from '../lib/channel-layout.svelte';
  import { formatTime } from '../lib/model';
  import type { ExportRange, Recording } from '../lib/model';
  import { download } from '../lib/gps-client';
  import type { ExportSession } from '../lib/export-session';
  let {
    session,
    notice,
    ranges: inputRanges = [],
    onchange = (_r: ExportRange[]) => {},
    onbrowse = () => {},
    onbusy = (_b: boolean) => {},
  }: {
    session: ExportSession;
    notice?: Notice;
    ranges: ExportRange[];
    onchange?: (r: ExportRange[]) => void;
    onbrowse?: () => void;
    onbusy?: (b: boolean) => void;
  } = $props();
  // Use the same chronological order for the list, timeline, playback and export.
  const ranges = $derived(
    [...inputRanges].sort(
      (a, b) =>
        a.recording.start - b.recording.start ||
        a.start - b.start ||
        a.recording.id.localeCompare(b.recording.id),
    ),
  );
  let includeAudio = $state(untrack(() => session.includeAudio)),
    busy = $state(false),
    progress = $state(0),
    message = $state('');
  let worker: Worker | undefined;
  let index = $state(untrack(() => session.index)),
    time = $state(untrack(() => session.time)),
    playing = $state(false),
    speed = $state(untrack(() => session.speed)),
    volume = $state(untrack(() => session.volume)),
    seekToken = $state(0);
  let trimStart = $state(untrack(() => session.trimStart)),
    trimEnd = $state(untrack(() => session.trimEnd));
  let timelineZoom = $state(untrack(() => session.timelineZoom)),
    timelinePan = $state(untrack(() => session.timelinePan)),
    signature = untrack(() => session.signature);
  const channels = $derived(channelLayout.order.filter((c) => channelLayout.visible.includes(c)));
  const sequence = $derived.by(() => {
    let offset = 0;
    return ranges.map((r, i) => {
      const duration = r.end - r.start;
      const timeline: Recording = {
        ...r.recording,
        id: `sequence-${i}`,
        previewOffset: r.start,
        start: offset,
        scale: 1,
        clips: Object.fromEntries(
          Object.entries(r.recording.clips).map(([c, clip]) => [c, { ...clip, duration }]),
        ),
      };
      const entry = { range: r, offset, duration, timeline };
      offset += duration;
      return entry;
    });
  });
  const duration = $derived(sequence.reduce((s, e) => s + e.duration, 0));
  const selected = $derived(sequence[index]);
  const position = $derived(selected ? selected.offset + time - selected.range.start : 0);
  const exportRanges = $derived(
    sequence.flatMap((e) => {
      const start = Math.max(trimStart, e.offset),
        end = Math.min(trimEnd, e.offset + e.duration);
      return end > start
        ? [
            {
              ...e.range,
              start: e.range.start + start - e.offset,
              end: e.range.start + end - e.offset,
            },
          ]
        : [];
    }),
  );
  const exportDuration = $derived(Math.max(0, trimEnd - trimStart) / speed);
  $effect(() => {
    const entries = sequence;
    const nextSignature = JSON.stringify(ranges.map((r) => [r.id, r.start, r.end]));
    if (signature === nextSignature) return;
    signature = nextSignature;
    untrack(() => {
      playing = false;
      index = 0;
      time = entries[0]?.range.start || 0;
      trimStart = 0;
      trimEnd = entries.reduce((s, e) => s + e.duration, 0);
      seekToken++;
    });
  });
  $effect(() => onbusy(busy));
  onDestroy(() => {
    Object.assign(session, {
      signature,
      index,
      time,
      speed,
      volume,
      includeAudio,
      trimStart,
      trimEnd,
      timelineZoom,
      timelinePan,
    });
    worker?.postMessage({ cancel: true });
    worker?.terminate();
    onbusy(false);
  });
  function seekPosition(value: number) {
    const t = Math.max(0, Math.min(duration, value));
    const i = sequence.findIndex((e) => t < e.offset + e.duration);
    index = i < 0 ? Math.max(0, sequence.length - 1) : i;
    const e = sequence[index];
    if (e) time = e.range.start + Math.max(0, Math.min(e.duration, t - e.offset));
    seekToken++;
  }
  function updateTime(t: number) {
    const e = sequence[index];
    if (!e) return;
    const at = e.offset + t - e.range.start;
    if (at >= trimEnd - 0.02) {
      playing = false;
      seekPosition(trimEnd);
    } else if (t >= e.range.end - 0.02) {
      seekPosition(e.offset + e.duration + 0.001);
    } else time = t;
  }
  function next() {
    const e = sequence[index];
    if (!e) return;
    if (e.offset + e.duration >= trimEnd - 0.02) {
      playing = false;
      seekPosition(trimEnd);
    } else seekPosition(e.offset + e.duration + 0.001);
  }
  function trim(start: number, end: number) {
    trimStart = Math.max(0, start);
    trimEnd = Math.min(duration, end);
    playing = false;
    if (position < trimStart || position > trimEnd) seekPosition(trimStart);
  }
  $effect(() => {
    if (playing && (position < trimStart || position >= trimEnd - 0.02))
      untrack(() => seekPosition(trimStart));
  });
  function removeRange(i: number) {
    const recording = ranges[i].recording;
    if (window.confirm(`Remove ${recording.date} · ${recording.time} from your sequence?`))
      onchange(ranges.filter((_, j) => j !== i));
  }
  async function start() {
    message = '';
    try {
      const handle = (window as any).showSaveFilePicker
        ? await (window as any).showSaveFilePicker({
            suggestedName: 'dashcam-export.mp4',
            types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
          })
        : null;
      busy = true;
      progress = 0;
      worker = new Worker(new URL('../lib/export.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') progress = data.value;
        else {
          busy = false;
          worker?.terminate();
          if (data.type === 'error') message = data.message;
          else {
            progress = 1;
            message = 'Export complete. Your video was saved locally.';
            if (data.blob) download(data.blob, 'dashcam-export.mp4');
          }
        }
      };
      worker.onerror = (e) => {
        message = e.message;
        busy = false;
        worker?.terminate();
      };
      worker.postMessage({
        ranges: $state.snapshot(exportRanges),
        channels: $state.snapshot(channels),
        audio: includeAudio ? 'F' : 'mute',
        mode: 'render',
        speed,
        width: 1920,
        height: 1080 * channels.length,
        fit: 'contain',
        handle,
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') message = (e as Error).message;
    }
  }
</script>

<PageHeader
  title="Export Studio"
  notice={notice?.busy
    ? notice
    : busy
      ? {
          message: `Exporting video · ${Math.round(progress * 100)}% · Keep this tab open`,
          busy: true,
          cancel: () => worker?.postMessage({ cancel: true }),
        }
      : message
        ? {
            message,
            dismiss: () => {
              message = '';
            },
          }
        : notice}
/>
<div class="export-workspace">
  <section class="panel export-sequence">
    <div class="card-heading">
      <h3>Your sequence</h3>
      <button class="tiny" disabled={busy} onclick={onbrowse}>Add footage</button>
    </div>
    <div class="sequence-list">
      {#each ranges as r, i}
        <div class="sequence-item" class:selected={index === i}>
          <button
            class="text-button"
            disabled={busy}
            onclick={() => seekPosition(sequence[i].offset)}
            >{r.recording.date} · {r.recording.time}</button
          >
          <button
            class="tiny"
            aria-label={`Remove ${r.recording.date} ${r.recording.time}`}
            disabled={busy}
            onclick={() => removeRange(i)}>×</button
          >
        </div>
      {/each}
      {#if !ranges.length}<p class="muted">
          Add footage from the viewer to review and trim it here.
        </p>{/if}
    </div>
  </section>
  <div class="export-review">
    <ReviewPane
      recording={selected?.range.recording || null}
      recordings={sequence.map((e) => e.timeline)}
      timelineSelected={selected?.timeline || null}
      current={position}
      playbackTime={position}
      playbackLength={duration}
      {time}
      length={selected?.range.end || 0}
      bind:playing
      bind:speed
      bind:timelineZoom
      bind:timelinePan
      bind:volume={
        () => (includeAudio ? volume : 0),
        (value) => {
          volume = value;
          includeAudio = value > 0;
        }
      }
      {seekToken}
      ontime={updateTime}
      onend={next}
      onskip={(s) => seekPosition(position + s)}
      onseek={(r, s) => seekPosition(r.start + s)}
      trim={{ start: trimStart, end: trimEnd }}
      ontrim={trim}
      disabled={busy}
      elapsed
    />
  </div>
  <aside class="panel export-settings">
    <h3>Output settings</h3>
    <div class="output-resolution">
      <span>Resolution per channel</span><strong>1920 × 1080</strong><span>Output resolution</span
      ><strong>1920 × {1080 * channels.length}</strong>
    </div>
    <label class="export-audio-toggle"
      ><input type="checkbox" bind:checked={includeAudio} disabled={busy} />Include audio</label
    >
    <div class="output-summary">
      <span>Format</span><strong>MP4 · H.264{includeAudio ? ' / AAC' : ''}</strong><span
        >Frame rate</span
      ><strong>30 fps</strong><span>Playback speed</span><strong>{speed}×</strong><span
        >Export duration</span
      ><strong>{formatTime(exportDuration)}</strong><span>Estimated size</span><strong
        >~{Math.round(exportDuration * channels.length)} MB</strong
      >
    </div>
    <p class="muted">
      Drag video strips to set their order. Click a channel label to include or exclude it. Use the
      yellow timeline edges to trim the joined sequence. Playback speed also applies to the exported
      video and audio.
    </p>
    <button
      class="primary full"
      disabled={busy || !exportRanges.length || !channels.length}
      onclick={start}>{busy ? 'Exporting…' : 'Export video ↗'}</button
    >
  </aside>
</div>
