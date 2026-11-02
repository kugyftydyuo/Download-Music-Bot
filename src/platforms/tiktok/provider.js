import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { AppError, throwIfAborted } from '../../core/errors.js';
import { runProcess } from '../../infrastructure/process-runner.js';

const hosts = new Set(['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

function classify(error) {
  if (error.code !== 'PROCESS_FAILED') return error;
  const diagnostic = error.diagnostic ?? '';
  if (/impersonat.*(?:not available|no.*target)|curl_cffi.*not available/i.test(diagnostic)) return new AppError('TIKTOK_UNAVAILABLE');
  if (/HTTP Error (?:403|429)|unexpected response from webpage|captcha|login required|log in/i.test(diagnostic)) return new AppError('TIKTOK_UNAVAILABLE');
  if (/requested format.*not available/i.test(diagnostic)) return new AppError('FORMAT_UNAVAILABLE');
  if (/private|not available|not found|removed|deleted/i.test(diagnostic)) return new AppError('MEDIA_UNAVAILABLE');
  if (/max.filesize|larger than.*size/i.test(diagnostic)) return new AppError('TOO_LARGE');
  return new AppError('DOWNLOAD_FAILED');
}

/** TikTok выдаёт готовые MP4: выбираем совместимые дорожки без перекодирования. */
export function selectTiktokVideo(formats, config, duration) {
  const candidates = formats.filter((f) => /^[\w.-]+$/.test(String(f.format_id)) && f.ext === 'mp4' &&
    /^(?:h264|avc1)/.test(f.vcodec ?? '') && /^(?:aac|mp4a)/.test(f.acodec ?? '') &&
    f.has_drm !== true && Number(f.width) > 0 && Number(f.height) > 0 &&
    Math.min(f.width, f.height) <= config.maxVideoHeight)
    .sort((a, b) => b.width * b.height - a.width * a.height || (b.tbr || 0) - (a.tbr || 0));
  if (!candidates.length) throw new AppError('FORMAT_UNAVAILABLE');
  const estimate = (f) => Number(f.filesize || f.filesize_approx) || Number(f.tbr || 0) * 1000 / 8 * duration;
  const fitting = candidates.find((f) => estimate(f) > 0 && estimate(f) <= config.maxUploadBytes * 0.9);
  const unknown = candidates.filter((f) => !estimate(f)).at(-1);
  const chosen = fitting ?? unknown;
  if (!chosen) throw new AppError('TOO_LARGE');
  return String(chosen.format_id);
}

export class TiktokProvider {
  id = 'tiktok';
  constructor(config, run = runProcess) { this.config = config; this.run = run; }
  supports(url) { return hosts.has(url.hostname.toLowerCase()); }
  normalize(url) {
    if (!this.supports(url) || url.protocol !== 'https:' || url.username || url.password || url.port) throw new AppError('INVALID_URL');
    const short = /^\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
    if (['vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname) && short) return `https://${url.hostname}/${short[1]}/`;
    if (['tiktok.com', 'www.tiktok.com'].includes(url.hostname)) {
      const video = /^\/@([\w.-]+)\/video\/(\d{10,25})\/?$/.exec(url.pathname);
      if (video) return `https://www.tiktok.com/@${video[1]}/video/${video[2]}`;
      const share = /^\/t\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
      if (share) return `https://www.tiktok.com/t/${share[1]}/`;
    }
    throw new AppError('INVALID_URL');
  }
  async #invoke(args, signal) {
    try { return await this.run(this.config.ytDlpPath, args, { signal, timeoutMs: this.config.processTimeoutMs }); }
    catch (error) { throw classify(error); }
  }
  async download({ url, kind, directory, signal }) {
    if (!['audio', 'video'].includes(kind)) throw new AppError('PROCESS_FAILED');
    const canonical = this.normalize(new URL(url));
    const base = [
      '--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-progress', '--no-warnings', '--no-colors',
      // Короткую ссылку раскрывает только TikTokVM. Generic extractor выключен.
      '--use-extractors', 'tiktok$,vm[.]tiktok$', '--socket-timeout', '20', '--retries', '2', '--extractor-retries', '2',
      '--fragment-retries', '2', '--abort-on-unavailable-fragments', '--concurrent-fragments', '1',
    ];
    const metadata = await this.#invoke([...base, '--dump-single-json', '--skip-download', '--', canonical], signal);
    let info;
    try { info = JSON.parse(metadata.stdout); } catch { throw new AppError('DOWNLOAD_FAILED'); }
    if (info._type === 'playlist' || info.extractor_key !== 'TikTok') throw new AppError('TIKTOK_UNSUPPORTED');
    if (info.is_live || ['is_live', 'is_upcoming'].includes(info.live_status)) throw new AppError('LIVE_UNSUPPORTED');
    const duration = Number(info.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new AppError('TIKTOK_UNSUPPORTED');
    if (duration > this.config.maxDuration) throw new AppError('TOO_LONG');
    // Повторно скачиваем уже проверенный ролик, не раскрывая короткую ссылку дважды.
    const videoUrl = this.normalize(new URL(info.webpage_url));
    if (!/^https:\/\/www\.tiktok\.com\/@[\w.-]+\/video\/\d+$/.test(videoUrl)) throw new AppError('TIKTOK_UNSUPPORTED');
    const format = kind === 'video' ? selectTiktokVideo(info.formats ?? [], this.config, duration) : 'bestaudio/best';
    if (kind === 'audio' && duration * 192000 / 8 * 1.05 > this.config.maxUploadBytes) throw new AppError('TOO_LARGE');
    const maxBytes = Math.min(this.config.maxUploadBytes * 2, Math.floor(this.config.maxJobDiskBytes / 2));
    const result = await this.#invoke([
      ...base, '--no-simulate', '--no-mtime', '--restrict-filenames', '--max-filesize', String(maxBytes),
      '--format', format, '--paths', directory, '--output', 'source.%(ext)s', '--print', 'after_move:filepath', '--', videoUrl,
    ], signal);
    throwIfAborted(signal);
    const printed = result.stdout.trim().split(/\r?\n/).at(-1);
    if (!printed) throw new AppError('TOO_LARGE');
    const file = path.resolve(printed);
    if (path.dirname(file) !== path.resolve(directory) || !/^source\.[a-z0-9]{1,8}$/.test(path.basename(file))) throw new AppError('DOWNLOAD_FAILED');
    const resolved = await realpath(file);
    if (path.dirname(resolved) !== await realpath(directory)) throw new AppError('DOWNLOAD_FAILED');
    const details = await stat(resolved);
    if (!details.isFile() || !details.size) throw new AppError('DOWNLOAD_FAILED');
    if (details.size > maxBytes || (kind === 'video' && details.size > this.config.maxUploadBytes)) throw new AppError('TOO_LARGE');
    return { path: resolved, title: String(info.title || 'TikTok').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200), duration };
  }
}
