import {
  Input,
  BlobSource,
  ALL_FORMATS,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  Output,
  Mp4OutputFormat,
  StreamTarget,
} from 'mediabunny';
import type { Channel, ExportRange } from './model';
import { createDownloadTarget } from './export-download';
const configKey = (config: any) =>
  JSON.stringify(config, (key, value) =>
    key === 'description' && value
      ? Array.from(new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength))
      : value,
  );
export async function fastExport(
  ranges: ExportRange[],
  channel: Channel,
  audio: Channel | 'mute',
  handle: any,
  cancelled: () => boolean,
  progress: (n: number) => void,
) {
  const inputs: Input[] = [];
  let output: Output | undefined, writable: any;
  try {
    const tracks = [];
    let videoKey = '',
      audioKey = '';
    for (const r of ranges) {
      const clip = r.recording.clips[channel];
      if (!clip) throw Error('Fast join requires the selected channel in every recording.');
      const input = new Input({ source: new BlobSource(clip.file), formats: ALL_FORMATS });
      inputs.push(input);
      const video = await input.getPrimaryVideoTrack(),
        sound = audio === 'mute' ? null : await input.getPrimaryAudioTrack();
      if (!video || !(await video.getCodec())) throw Error('Unsupported source video.');
      const duration = await video.computeDuration();
      if (r.start > 0.001 || Math.abs(r.end - duration) > 0.1)
        throw Error('Fast join supports whole recordings. Use Render for precise trims.');
      const first = await new EncodedPacketSink(video).getFirstPacket();
      if (!first || first.type !== 'key')
        throw Error('This recording does not begin at a keyframe. Use Render.');
      const config = await video.getDecoderConfig(),
        ac = sound ? await sound.getDecoderConfig() : null;
      const vk = configKey(config),
        ak = configKey(ac);
      if (videoKey && videoKey !== vk)
        throw Error('Video configurations differ. Use Render to join these recordings.');
      if (audio !== 'mute' && !sound)
        throw Error('A recording has no audio. Use Render to fill silence, or mute this join.');
      if (audioKey && audioKey !== ak) throw Error('Audio configurations differ. Use Render.');
      videoKey = vk;
      audioKey = ak;
      tracks.push({ video, sound, config, ac, duration });
    }
    writable = handle ? await handle.createWritable() : null;
    const download = writable ? null : createDownloadTarget();
    const target = writable
      ? new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 })
      : download!.target;
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target });
    const videoSource = new EncodedVideoPacketSource((await tracks[0].video.getCodec())!);
    output.addVideoTrack(videoSource);
    const soundSource = tracks[0].sound
      ? new EncodedAudioPacketSource((await tracks[0].sound.getCodec())!)
      : null;
    if (soundSource) output.addAudioTrack(soundSource);
    await output.start();
    let offset = 0;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const vi = new EncodedPacketSink(t.video).packets(),
        ai = t.sound ? new EncodedPacketSink(t.sound).packets() : null;
      let v = await vi.next(),
        a = ai ? await ai.next() : null;
      try {
        while (!v.done || (a && !a.done)) {
          if (cancelled()) throw Error('Export cancelled.');
          if (!v.done && (!a || a.done || v.value.timestamp <= a.value.timestamp)) {
            await videoSource.add(
              v.value.clone({ timestamp: v.value.timestamp + offset }),
              t.config ? { decoderConfig: t.config } : undefined,
            );
            v = await vi.next();
          } else if (a && !a.done) {
            if (a.value.timestamp < 0 || a.value.timestamp >= t.duration) {
              a = await ai!.next();
              continue;
            }
            await soundSource!.add(
              a.value.clone({
                timestamp: a.value.timestamp + offset,
                duration: Math.min(a.value.duration, t.duration - a.value.timestamp),
              }),
              t.ac ? { decoderConfig: t.ac } : undefined,
            );
            a = await ai!.next();
          }
        }
      } finally {
        await vi.return();
        await ai?.return();
      }
      offset += t.duration;
      progress((i + 1) / tracks.length);
    }
    videoSource.close();
    soundSource?.close();
    await output.finalize();
    return download?.getBlob() ?? null;
  } catch (e) {
    try {
      await output?.cancel();
      await writable?.abort();
    } catch {}
    throw e;
  } finally {
    inputs.forEach((i) => i.dispose());
  }
}
