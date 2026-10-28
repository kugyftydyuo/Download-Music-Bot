import { AppError } from '../core/errors.js';

/**
 * Контракт платформы:
 * id: string
 * supports(url: URL): boolean
 * normalize(url: URL): string — валидирует и возвращает безопасную каноническую ссылку
 * download({ url, kind, directory, signal }): Promise<{ path, title, duration }>
 *
 * Платформа отвечает за получение исходника. Очередь, подписки, FFmpeg и Telegram
 * от платформы не зависят. Новую платформу достаточно зарегистрировать в composition root.
 */
export class PlatformRegistry {
  constructor(platforms) { this.platforms = platforms; }

  resolve(text) {
    if (typeof text !== 'string' || text.length > 2048 || /\s/.test(text.trim())) throw new AppError('INVALID_URL');

    let url;
    try { url = new URL(text.trim()); } catch { throw new AppError('INVALID_URL'); }

    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new AppError('INVALID_URL');

    const platform = this.platforms.find((item) => item.supports(url));
    if (!platform) throw new AppError('UNSUPPORTED_PLATFORM');

    return { platform, url: platform.normalize(url) };
  }
}
