<script lang="ts">
  import { channelLayout, saveChannelLayout } from '../lib/channel-layout.svelte';
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { CHANNELS, channelName, formatTime } from '../lib/model';
  import type { Recording, Channel } from '../lib/model';
  let {
    recording,
    time = 0,
    playing = false,
    speed = 1,
    volume = 1,
    ontime = (_t: number) => {},
    onend = () => {},
    seekToken = 0,
  }: {
    recording: Recording | null;
    time?: number;
    playing?: boolean;
    speed?: number;
    volume?: number;
    ontime?: (t: number) => void;
    onend?: () => void;
    seekToken?: number;
  } = $props();
  let urls = $state<Partial<Record<Channel, string>>>({}),
    errors = $state<Partial<Record<Channel, string>>>({});
  let videos: Partial<Record<Channel, HTMLVideoElement>> = {};
  let focus = $state<Channel | null>(null);
  let dragging = $state<Channel | null>(null);
  let dropTarget = $state<Channel | null>(null);
  let reducedMotion = $state(false);
  let animateReorder = $state(false);
  onMount(() => {
    reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  $effect(() => {
    if (focus && !channelLayout.visible.includes(focus)) focus = null;
  });
  const shown = (c: Channel) => channelLayout.visible.includes(c) && (!focus || focus === c);
  const running = (c: Channel) => c === 'F' || shown(c);
  function toggleChannel(c: Channel) {
    channelLayout.visible = channelLayout.visible.includes(c)
      ? channelLayout.visible.filter((v) => v !== c)
      : [...channelLayout.visible, c];
    if (focus && !channelLayout.visible.includes(focus)) focus = null;
    saveChannelLayout();
  }
  function reorder(from: Channel, to: Channel) {
    if (from === to) return;
    animateReorder = true;
    const next = channelLayout.order.filter((c) => c !== from);
    next.splice(channelLayout.order.indexOf(to), 0, from);
    channelLayout.order = next;
    saveChannelLayout();
  }

  $effect(() => {
    const r = recording;
    errors = {};
    const next: Partial<Record<Channel, string>> = {};
    if (r)
      for (const c of CHANNELS) {
        const clip = r.clips[c];
        if (clip) next[c] = URL.createObjectURL(clip.file);
      }
    urls = next;
    return () => Object.values(next).forEach(URL.revokeObjectURL);
  });
  $effect(() => {
    playing;
    speed;
    volume;
    for (const c of CHANNELS) {
      const v = videos[c];
      if (!v) continue;
      v.muted = c !== 'F' || volume === 0;
      v.volume = volume;
      v.playbackRate = speed;
      if (!playing || !running(c)) v.pause();
      else if (v.readyState >= 2)
        v.play().catch(
          () => (errors[c] = 'Playback unavailable. Try a browser with HEVC support.'),
        );
    }
  });
  $effect(() => {
    seekToken;
    const t = time;
    for (const v of Object.values(videos))
      if (v && v.readyState >= 1 && Math.abs(v.currentTime - t) > 0.15)
        v.currentTime = Math.min(t, Math.max(0, v.duration - 0.001));
  });
  function ready(c: Channel) {
    const v = videos[c];
    if (!v) return;
    v.currentTime = Math.min(time, Math.max(0, v.duration - 0.001));
    v.playbackRate = speed;
    v.muted = c !== 'F' || volume === 0;
    v.volume = volume;
    if (playing && running(c)) v.play().catch(() => {});
  }
  onMount(() => {
    const timer = setInterval(() => {
      if (!playing) return;
      const main = focus
        ? videos[focus]
        : videos.F?.readyState
          ? videos.F
          : CHANNELS.map((c) => videos[c]).find((v) => v && v.readyState >= 2);
      if (!main) return;
      ontime(main.currentTime);
      for (const c of CHANNELS) {
        const v = videos[c];
        if (!v || v === main || v.readyState < 2 || v.ended || !running(c)) continue;
        const diff = v.currentTime - main.currentTime;
        if (Math.abs(diff) > 0.22) v.currentTime = main.currentTime;
        else
          v.playbackRate = Math.min(
            16,
            speed * (Math.abs(diff) > 0.06 ? (diff > 0 ? 0.98 : 1.02) : 1),
          );
      }
    }, 150);
    return () => clearInterval(timer);
  });
</script>

<div
  class="strips"
  style:grid-template-rows={focus
    ? 'minmax(0,1fr)'
    : channelLayout.order
        .map((c) => (channelLayout.visible.includes(c) ? 'minmax(0,1fr)' : '38px'))
        .join(' ')}
  class:focused={focus !== null}
>
  {#each channelLayout.order as c (c)}
    <div
      animate:flip={{ duration: reducedMotion || !animateReorder ? 0 : 260, easing: cubicOut }}
      class="video-strip"
      data-channel={c}
      class:hidden={!!focus && focus !== c}
      class:collapsed={!channelLayout.visible.includes(c)}
      class:drop-target={dropTarget === c && dragging !== c}
      role="group"
      aria-label={`${channelName[c]} channel position`}
      draggable="true"
      ondragstart={(e) => {
        dragging = c;
        e.dataTransfer?.setData('text/plain', c);
      }}
      ondragend={() => {
        dragging = null;
        dropTarget = null;
      }}
      ondragover={(e) => {
        e.preventDefault();
        dropTarget = c;
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      }}
      ondragleave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) dropTarget = null;
      }}
      ondrop={(e) => {
        e.preventDefault();
        if (dragging) reorder(dragging, c);
        dragging = null;
        dropTarget = null;
      }}
    >
      <button
        class="strip-label"
        aria-label={`Toggle ${channelName[c]} video`}
        aria-expanded={channelLayout.visible.includes(c)}
        onclick={() => toggleChannel(c)}
      >
        <span
          class="camera-toggle"
          class:expanded={channelLayout.visible.includes(c)}
          aria-hidden="true"
        ></span>{channelName[c]}<small>{recording?.clips[c] ? 'CONNECTED' : 'NO FOOTAGE'}</small>
      </button>
      <button
        class="focus-button"
        aria-label={`Focus ${channelName[c]}`}
        onclick={() => (focus = focus === c ? null : c)}>{focus === c ? '⊡' : '⛶'}</button
      >
      {#if urls[c]}<video
          bind:this={videos[c]}
          src={urls[c]}
          preload="metadata"
          playsinline
          muted
          onloadedmetadata={() => ready(c)}
          oncanplay={() => {
            if (playing && running(c)) videos[c]?.play().catch(() => {});
          }}
          onerror={() =>
            (errors[c] =
              'This recording could not be decoded. Check HEVC support or reconnect the source.')}
          onended={() => {
            if (
              c ===
              (focus || (recording?.clips.F ? 'F' : CHANNELS.find((k) => recording?.clips[k])))
            )
              onend();
          }}
        ></video>{:else}<div class="video-empty">
          <span class="camera-icon">▱</span>
          <p>{recording ? 'Channel unavailable' : 'Select a recording to begin'}</p>
        </div>{/if}
      {#if errors[c]}<div class="video-error">{errors[c]}</div>{/if}<span class="strip-time"
        >{formatTime(time)}</span
      >
    </div>{/each}
</div>
