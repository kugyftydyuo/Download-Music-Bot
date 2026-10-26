import path from 'node:path';
import { stat } from 'node:fs/promises';
import { AppError } from '../core/errors.js';
import { runProcess } from '../infrastructure/process-runner.js';

export class MediaConverter {
  constructor(config, run = runProcess) { this.config = config; this.run = run; }
  async convert(source, kind, directory, signal) {
    const output = path.join(directory, kind === 'video' ? 'result.mp4' : 'result.mp3');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '1', '-i', source.path,
      '-map_metadata', '-1', '-map_chapters', '-1'];
    if (kind === 'video') args.push('-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart');
    else args.push('-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-threads', '1');
    args.push(output);
    const options = { signal, timeoutMs: this.config.processTimeoutMs };
    await this.run(this.config.ffmpegPath, args, options);
    const size = (await stat(output)).size;
    if (!size || size > this.config.maxUploadBytes) throw new AppError('TOO_LARGE');
    const probe = await this.run(this.config.ffprobePath, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', output,
    ], options);
    let data;
    try { data = JSON.parse(probe.stdout); } catch { throw new AppError('PROCESS_FAILED'); }
    const duration = Number(data.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new AppError('PROCESS_FAILED');
    if (duration > this.config.maxDuration + 2) throw new AppError('TOO_LONG');
    const audio = data.streams?.find((s) => s.codec_type === 'audio');
    const video = data.streams?.find((s) => s.codec_type === 'video');
    if (!audio || (kind === 'audio' && audio.codec_name !== 'mp3') ||
        (kind === 'video' && (video?.codec_name !== 'h264' || audio.codec_name !== 'aac'))) {
      throw new AppError('FORMAT_UNAVAILABLE');
    }
    return { path: output, kind, title: source.title, duration, size };
  }
}
