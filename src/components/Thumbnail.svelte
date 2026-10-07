<script module lang="ts">
  const cache = new Map<string, Blob>();
  const fileIds = new WeakMap<File, number>();
  let nextFileId = 0;
  let queue = Promise.resolve();
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Clip } from '../lib/model';
  let {
    clip,
    seconds = 0,
    delay = 0,
  }: { clip: Clip | undefined; seconds?: number; delay?: number } = $props();
  const sourceFile = $derived(clip?.file);
  const frameTime = $derived(Math.max(0, Math.round(seconds / 5) * 5));
  let ownedUrl = '';
  let displayedFile: File | undefined;
  function clearPreview() {
    if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    ownedUrl = '';
    url = '';
  }
  onDestroy(clearPreview);
  let el: HTMLSpanElement;
  let visible = $state(false),
    url = $state('');
  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
      },
      { rootMargin: '80px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  });
  $effect(() => {
    const file = sourceFile;
    if (file !== displayedFile) {
      clearPreview();
      displayedFile = file;
    }
    if (!visible || !file) return;
    const sampleTime = frameTime;
    const wait = delay;
    if (!fileIds.has(file)) fileIds.set(file, ++nextFileId);
    const key = `${fileIds.get(file)}:${sampleTime}`;
    let cancelled = false;
    // Decode only visible previews, one at a time, including after playback seeks.
    queue = queue
      .then(async () => {
        if (cancelled) return;
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        if (cancelled) return;
        let blob = cache.get(key);
        if (!blob) {
          const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
          if (cancelled) return;
          const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
          try {
            const track = await input.getPrimaryVideoTrack();
            if (!track || !(await track.canDecode()) || cancelled) return;
            const duration = await track.computeDuration();
            if (cancelled) return;
            const seekTime = Math.min(sampleTime, Math.max(0, duration - 0.001));
            const frame = await new CanvasSink(track, { width: 160, poolSize: 1 }).getCanvas(
              seekTime,
            );
            if (!frame || cancelled) return;
            const canvas = frame.canvas as HTMLCanvasElement;
            blob =
              (await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', 0.65),
              )) ?? undefined;
            if (!blob || cancelled) return;
            cache.set(key, blob);
            if (cache.size > 80) cache.delete(cache.keys().next().value!);
          } finally {
            input.dispose();
          }
        }
        if (!cancelled && blob) {
          const previous = ownedUrl;
          url = ownedUrl = URL.createObjectURL(blob);
          if (previous) URL.revokeObjectURL(previous);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });
</script>

<span bind:this={el} class="thumbnail">
  {#if url}<img src={url} alt="Recording preview" />{:else}<span>▱</span>{/if}
</span>
