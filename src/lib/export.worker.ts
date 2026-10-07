/// <reference lib="webworker" />
import {
  Input,
  BlobSource,
  ALL_FORMATS,
  CanvasSink,
  CanvasSource,
  AudioSampleSink,
  AudioSampleSource,
  AudioSample,
  Output,
  Mp4OutputFormat,
  StreamTarget,
  canEncodeVideo,
  canEncodeAudio,
} from 'mediabunny';
import { fastExport } from './fast-export';
import { createDownloadTarget } from './export-download';
import { stripRects, channelName } from './model';
import type { Channel, ExportRange } from './model';
let cancelled = false;
self.onmessage = async ({ data }) => {
  if (data.cancel) {
    cancelled = true;
    return;
  }
  cancelled = false;
  const {
    ranges,
    channels,
    width,
    height,
    audio,
    handle,
    fit,
    speed = 1,
  } = data as {
    speed?: number;
    ranges: ExportRange[];
    channels: Channel[];
    width: number;
    height: number;
    audio: Channel | 'mute';
    handle: any;
    fit: 'contain' | 'cover';
  };
  let output: Output | undefined, writable: any;
  const inputs: Input[] = [];
  try {
    if (!channels.length || !ranges.length) throw Error('Choose a range and at least one channel.');
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 8)
      throw Error('Playback speed must be between 0.25× and 8×.');
    if (data.mode === 'fast') {
      if (speed !== 1) throw Error('Changing playback speed requires rendered export.');
      if (channels.length !== 1)
        throw Error('Fast join supports one channel. Choose Render to stack channels.');
      const blob = await fastExport(
        ranges,
        channels[0],
        audio,
        handle,
        () => cancelled,
        (value) => postMessage({ type: 'progress', value }),
      );
      postMessage({ type: 'done', blob });
      return;
    }
    if (!(await canEncodeVideo('avc', { width, height, bitrate: 8000000 * channels.length })))
      throw Error(
        'H.264 encoding is unavailable on this browser/device. Try desktop Chrome or Edge.',
      );
    if (
      audio !== 'mute' &&
      !(await canEncodeAudio('aac', { sampleRate: 48000, numberOfChannels: 1 }))
    )
      throw Error('AAC encoding is unavailable. Choose muted export or another supported browser.');
    const total = ranges.reduce((s, r) => s + (r.end - r.start) / speed, 0);
    writable = handle ? await handle.createWritable() : undefined;
    const download = writable ? null : createDownloadTarget();
    const target = writable
      ? new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 })
      : download!.target;
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target });
    const canvas = new OffscreenCanvas(width, height),
      ctx = canvas.getContext('2d')!;
    const source = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: 8000000 * channels.length,
    });
    output.addVideoTrack(source, { frameRate: 30 });
    const audioSource =
      audio !== 'mute' ? new AudioSampleSource({ codec: 'aac', bitrate: 128000 }) : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();
    let offset = 0;
    const startTime = performance.now();
    for (const range of ranges) {
      const duration = (range.end - range.start) / speed;
      if (!Number.isFinite(duration) || duration <= 0)
        throw Error('Each range needs an end after its start.');
      const rects = stripRects(channels, width, height),
        opened: Input[] = [],
        iterators: any[] = [];
      // One continuous 30 fps clock, including joins at fractional frame boundaries.
      const firstFrame = Math.ceil(offset * 30 - 1e-8);
      const frames = Math.ceil((offset + duration) * 30 - 1e-8) - firstFrame;
      const localTime = (f: number) => (firstFrame + f) / 30 - offset;
      function* timestamps() {
        for (let f = 0; f < frames; f++) yield range.start + localTime(f) * speed;
      }
      let audioIter: AsyncGenerator<AudioSample, void, unknown> | undefined,
        nextAudio: IteratorResult<AudioSample, void> | undefined;
      try {
        for (const rect of rects) {
          const clip = range.recording.clips[rect.channel];
          if (!clip) {
            iterators.push(null);
            continue;
          }
          const input = new Input({ source: new BlobSource(clip.file), formats: ALL_FORMATS });
          opened.push(input);
          inputs.push(input);
          const track = await input.getPrimaryVideoTrack();
          if (!track || !(await track.canDecode()))
            throw Error(
              `${channelName[rect.channel]} cannot be decoded for export. HEVC decoding support is required.`,
            );
          const end = await track.computeDuration();
          const sink = new CanvasSink(track, {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            fit,
            poolSize: 2,
          });
          iterators.push({ iterator: sink.canvasesAtTimestamps(timestamps()), end });
        }
        if (audioSource && audio !== 'mute') {
          const clip = range.recording.clips[audio];
          if (clip) {
            const input = new Input({ source: new BlobSource(clip.file), formats: ALL_FORMATS });
            opened.push(input);
            inputs.push(input);
            const track = await input.getPrimaryAudioTrack();
            if (track) {
              if (!(await track.canDecode()))
                throw Error('The selected audio cannot be decoded. Choose muted export.');
              audioIter = new AudioSampleSink(track).samples(
                Math.max(0, range.start - 0.2),
                range.end,
              );
              nextAudio = await audioIter.next();
            }
          }
        }
        let audioAt = 0;
        async function addAudioUntil(localEnd: number) {
          if (!audioSource) return;
          while (
            nextAudio &&
            !nextAudio.done &&
            nextAudio.value.timestamp < range.start + localEnd * speed
          ) {
            const sample = nextAudio.value;
            const begin = Math.max(range.start, sample.timestamp),
              end = Math.min(range.end, sample.timestamp + sample.duration);
            if (end > begin) {
              const startFrame = Math.max(
                  0,
                  Math.round((begin - sample.timestamp) * sample.sampleRate),
                ),
                endFrame = Math.min(
                  sample.numberOfFrames,
                  Math.round((end - sample.timestamp) * sample.sampleRate),
                );
              if (endFrame > startFrame) {
                const trimmed = sample.trim(startFrame, endFrame);
                const outputBegin = Math.round(((begin - range.start) / speed) * 48000) / 48000,
                  outputEnd = Math.round(((end - range.start) / speed) * 48000) / 48000;
                const length = Math.round((outputEnd - outputBegin) * 48000),
                  mono = new Float32Array(length);
                if (!length) {
                  trimmed.close();
                  sample.close();
                  nextAudio = await audioIter!.next();
                  continue;
                }
                for (let ch = 0; ch < trimmed.numberOfChannels; ch++) {
                  const a = new Float32Array(trimmed.numberOfFrames);
                  trimmed.copyTo(a, { planeIndex: ch, format: 'f32-planar' });
                  for (let i = 0; i < length; i++) {
                    const pos = (i * trimmed.sampleRate * speed) / 48000,
                      j = Math.min(Math.floor(pos), a.length - 1),
                      k = Math.min(j + 1, a.length - 1);
                    mono[i] +=
                      (a[j] * (1 - (pos - Math.floor(pos))) + a[k] * (pos - Math.floor(pos))) /
                      trimmed.numberOfChannels;
                  }
                }
                if (outputBegin > audioAt + 1 / 48000) {
                  const silence = new AudioSample({
                    data: new Float32Array(Math.round((outputBegin - audioAt) * 48000)),
                    format: 'f32',
                    sampleRate: 48000,
                    numberOfChannels: 1,
                    timestamp: offset + audioAt,
                  });
                  await audioSource.add(silence);
                  silence.close();
                }
                const out = new AudioSample({
                  data: mono,
                  format: 'f32',
                  sampleRate: 48000,
                  numberOfChannels: 1,
                  timestamp: offset + outputBegin,
                });
                await audioSource.add(out);
                out.close();
                trimmed.close();
                audioAt = outputEnd;
              }
            }
            sample.close();
            nextAudio = await audioIter!.next();
          }
          if (!audioIter || nextAudio?.done) {
            const missing = localEnd - audioAt;
            if (missing > 0) {
              const silence = new AudioSample({
                data: new Float32Array(Math.round(missing * 48000)),
                format: 'f32',
                sampleRate: 48000,
                numberOfChannels: 1,
                timestamp: offset + audioAt,
              });
              await audioSource.add(silence);
              silence.close();
              audioAt = localEnd;
            }
          }
        }
        for (let f = 0; f < frames; f++) {
          if (cancelled) throw Error('Export cancelled.');
          ctx.fillStyle = '#090d11';
          ctx.fillRect(0, 0, width, height);
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i],
              it = iterators[i];
            const frame = it ? await it.iterator.next() : null;
            if (frame?.value && range.start + localTime(f) * speed < it.end) {
              ctx.drawImage(frame.value.canvas, r.x, r.y, r.width, r.height);
            } else {
              ctx.fillStyle = '#80939e';
              ctx.font = `${Math.max(18, height / 45)}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillText(`${channelName[r.channel]} · No footage`, width / 2, r.y + r.height / 2);
            }
          }
          await source.add((firstFrame + f) / 30, 1 / 30);
          if (f % 15 === 0 || f === frames - 1)
            await addAudioUntil(Math.min(duration, localTime(f + 1)));
          if (f % 15 === 0) {
            const done = (firstFrame + f) / 30;
            postMessage({
              type: 'progress',
              value: done / total,
              elapsed: (performance.now() - startTime) / 1000,
            });
          }
        }
        await addAudioUntil(duration);
      } finally {
        for (const it of iterators) await it?.iterator.return();
        if (nextAudio && !nextAudio.done) nextAudio.value.close();
        await audioIter?.return();
        for (const input of opened) input.dispose();
      }
      offset += duration;
    }
    source.close();
    audioSource?.close();
    await output.finalize();
    postMessage({
      type: 'done',
      blob: download?.getBlob() ?? null,
    });
  } catch (e) {
    try {
      await output?.cancel();
      await writable?.abort();
    } catch {}
    postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    for (const input of inputs) input.dispose();
  }
};
