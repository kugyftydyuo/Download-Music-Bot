import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { AppError, throwIfAborted } from '../../core/errors.js';
import { runProcess } from '../../infrastructure/process-runner.js';
import { selectVideoFormat } from './formats.js';

const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

function classify(error) {
  if (error.code !== 'PROCESS_FAILED') return error;
  const detail = error.diagnostic ?? '';
  if (/file is larger than|max.filesize|larger than.*size/i.test(detail)) return new AppError('TOO_LARGE');
  if (/requested format.*not available/i.test(detail)) return new AppError('FORMAT_UNAVAILABLE');
  if (/private video|video unavailable|has been removed|not available in your country|sign in|age.restrict|members.only/i.test(detail)) {
    return new AppError('MEDIA_UNAVAILABLE');
  }
  return new AppError('DOWNLOAD_FAILED');
}

export class YoutubeProvider {
  id = 'youtube';
  constructor(config, run = runProcess) { this.config = config; this.run = run; }
  supports(url) { return hosts.has(url.hostname.toLowerCase()); }
  normalize(url) {
    let id;
    if (url.hostname.endsWith('youtu.be')) id = /^\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
    else if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = /^\/(?:shorts|live|embed)\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new AppError('INVALID_URL');
    // Отбрасываем playlist, redirect, timestamp и прочие параметры пользователя.
    return `https://www.youtube.com/watch?v=${id}`;
  }
  #baseArgs() {
    const args = [
      '--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-progress', '--no-warnings', '--no-colors',
      '--socket-timeout', '20', '--retries', '2', '--extractor-retries', '2', '--fragment-retries', '2', '--concurrent-fragments', '1',
      '--abort-on-unavailable-fragments',
      '--no-js-runtimes',
      '--js-runtimes', `node:${process.execPath}`,
    ];
    if (path.isAbsolute(this.config.ffmpegPath)) args.push('--ffmpeg-location', this.config.ffmpegPath);
    return args;
  }
  async #invoke(args, signal) {
    try {
      return await this.run(this.config.ytDlpPath, args, { signal, timeoutMs: this.config.processTimeoutMs });
    } catch (error) { throw classify(error); }
  }
  async download({ url, kind, directory, signal }) {
    if (!['video', 'audio'].includes(kind)) throw new AppError('PROCESS_FAILED');
    const meta = await this.#invoke([...this.#baseArgs(), '--dump-single-json', '--skip-download', '--', url], signal);
    let info;
    try { info = JSON.parse(meta.stdout); } catch { throw new AppError('DOWNLOAD_FAILED'); }
    if (info.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(info.live_status)) throw new AppError('LIVE_UNSUPPORTED');
    const duration = Number(info.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new AppError('MEDIA_UNAVAILABLE');
    if (duration > this.config.maxDuration) throw new AppError('TOO_LONG');
    if (kind === 'audio' && duration * 192000 / 8 * 1.05 > this.config.maxUploadBytes) throw new AppError('TOO_LARGE');
    const format = kind === 'video'
      ? selectVideoFormat(info.formats ?? [], { ...this.config, duration })
      : 'bestaudio/best';
    const maxSourceBytes = Math.min(this.config.maxUploadBytes * 2, Math.floor(this.config.maxJobDiskBytes / 2));
    const result = await this.#invoke([
      ...this.#baseArgs(), '--no-simulate', '--no-mtime', '--restrict-filenames', '--max-filesize', String(maxSourceBytes),
      '--format', format, '--merge-output-format', 'mp4', '--paths', directory,
      '--output', 'source.%(ext)s', '--print', 'after_move:filepath', '--', url,
    ], signal);
    throwIfAborted(signal);
    const source = result.stdout.trim().split(/\r?\n/).at(-1);
    if (!source) throw new AppError('TOO_LARGE'); // yt-dlp может пропустить слишком большой файл с exit=0.
    const file = path.resolve(source);
    if (path.dirname(file) !== path.resolve(directory) || !/^source\.[a-z0-9]{1,8}$/.test(path.basename(file))) {
      throw new AppError('DOWNLOAD_FAILED');
    }
    const resolvedFile = await realpath(file);
    if (path.dirname(resolvedFile) !== await realpath(directory)) throw new AppError('DOWNLOAD_FAILED');
    const details = await stat(file);
    if (!details.isFile() || details.size === 0) throw new AppError('DOWNLOAD_FAILED');
    if (details.size > maxSourceBytes || (kind === 'video' && details.size > this.config.maxUploadBytes)) throw new AppError('TOO_LARGE');
    return { path: resolvedFile, title: String(info.title || 'YouTube').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200), duration };
  }
}
