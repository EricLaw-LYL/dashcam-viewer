<script lang="ts">
  import Player from './Player.svelte';
  import DayTimeline from './DayTimeline.svelte';
  import PlaybackControls from './PlaybackControls.svelte';
  import type { Recording } from '../lib/model';
  let {
    time = 0,
    recording,
    recordings,
    timelineSelected = recording,
    current = recording ? recording.start + time * recording.scale : 0,
    length = 0,
    playing = $bindable(false),
    speed = $bindable(1),
    volume = $bindable(1),
    seekToken = 0,
    timelineZoom = $bindable(1),
    timelinePan = $bindable(0),
    zone = 'America/Toronto',
    ontime,
    onend,
    onskip,
    onseek,
    trim,
    ontrim,
    disabled = false,
    elapsed = false,
    playbackTime = time,
    playbackLength = length,
  }: {
    recording: Recording | null;
    recordings: Recording[];
    timelineSelected?: Recording | null;
    current?: number;
    time?: number;
    length?: number;
    playing?: boolean;
    speed?: number;
    volume?: number;
    seekToken?: number;
    timelineZoom?: number;
    timelinePan?: number;
    zone?: string;
    ontime: (t: number) => void;
    onend: () => void;
    onskip: (s: number) => void;
    onseek: (r: Recording, s: number) => void;
    trim?: { start: number; end: number };
    ontrim?: (start: number, end: number) => void;
    disabled?: boolean;
    elapsed?: boolean;
    playbackTime?: number;
    playbackLength?: number;
  } = $props();
</script>

<div class="viewer-center review-pane">
  <section class="player-panel">
    <Player {recording} {time} {playing} {speed} {volume} {seekToken} {ontime} {onend} />
  </section>
  <DayTimeline
    bind:zoom={timelineZoom}
    bind:scroll={timelinePan}
    {recordings}
    selected={timelineSelected}
    {current}
    {zone}
    {onseek}
    {trim}
    {ontrim}
    {disabled}
    {elapsed}
  >
    <PlaybackControls
      time={playbackTime}
      length={playbackLength}
      disabled={!recording || disabled}
      bind:playing
      bind:speed
      bind:volume
      {onskip}
    />
  </DayTimeline>
</div>
