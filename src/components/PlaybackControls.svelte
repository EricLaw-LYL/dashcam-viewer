<script lang="ts">
  import { formatTime } from '../lib/model';
  let {
    time = 0,
    length = 0,
    disabled = false,
    playing = $bindable(false),
    speed = $bindable(1),
    volume = $bindable(1),
    onskip = (_s: number) => {},
  }: {
    time?: number;
    length?: number;
    disabled?: boolean;
    playing?: boolean;
    speed?: number;
    volume?: number;
    onskip?: (s: number) => void;
  } = $props();
  let previousVolume = 1;
</script>

<div class="playback-controls">
  <div class="transport-buttons">
    <button aria-label="Back ten seconds" onclick={() => onskip(-10)} {disabled}
      ><svg class="skip-arrow" viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M20 12H4m7-7-7 7 7 7" /></svg
      ><span>10</span></button
    ><button
      class="play-button"
      aria-label={playing ? 'Pause' : 'Play'}
      {disabled}
      onclick={() => (playing = !playing)}>{playing ? 'Ⅱ' : '▶'}</button
    ><button aria-label="Forward ten seconds" onclick={() => onskip(10)} {disabled}
      ><span>10</span><svg class="skip-arrow" viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M4 12h16m-7-7 7 7-7 7" /></svg
      ></button
    >
  </div>
  <span class="playback-time">{formatTime(time)} <small>/ {formatTime(length)}</small></span>
  <div class="playback-options">
    <select bind:value={speed} aria-label="Playback speed" {disabled}
      >{#each [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 4, 8] as v}<option value={v}>{v}×</option
        >{/each}</select
    >
    <div class="volume-control">
      <button
        class="mute-button"
        aria-label={volume === 0 ? 'Unmute audio' : 'Mute audio'}
        aria-pressed={volume === 0}
        onclick={() => {
          if (volume > 0) {
            previousVolume = volume;
            volume = 0;
          } else volume = previousVolume || 1;
        }}
        ><svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M11 5 6 9H3v6h3l5 4Z" />{#if volume === 0}<path
              d="m16 9 5 6m0-6-5 6"
            />{:else}<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />{/if}</svg
        ></button
      ><input
        aria-label="Volume"
        title="Front camera audio"
        type="range"
        min="0"
        max="1"
        step=".01"
        bind:value={volume}
      />
    </div>
  </div>
</div>
