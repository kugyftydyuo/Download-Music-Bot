import { AppError, throwIfAborted } from '../core/errors.js';
import { errorCode } from '../infrastructure/logger.js';

export class DownloadJobService {
  constructor({ config, subscriptions, storage, converter, telegram, logger }) {
    Object.assign(this, { config, subscriptions, storage, converter, telegram, logger });
  }
  async execute({ userId, chatId, platform, url, kind }, parentSignal) {
    const deadline = new AbortController();
    const resources = new AbortController();
    const signal = AbortSignal.any([parentSignal, deadline.signal, resources.signal]);
    const timer = setTimeout(() => deadline.abort(new AppError('TIMEOUT')), this.config.jobTimeoutMs);
    let directory;
    let stopWatch;
    try {
      throwIfAborted(signal);
      // Список каналов мог измениться, пока пользователь ждал в очереди.
      await this.subscriptions.assertAccess(userId, { fresh: true });
      throwIfAborted(signal);
      directory = await this.storage.create();
      stopWatch = this.storage.watch(directory, resources);
      await this.telegram.sendText(chatId, `Начинаю обработку ${kind === 'video' ? 'видео' : 'аудио'}…`, {}, signal);
      const source = await platform.download({ url, kind, directory, signal });
      const media = await this.converter.convert(source, kind, directory, signal);
      await this.subscriptions.assertAccess(userId, { fresh: true });
      throwIfAborted(signal);
      await this.telegram.sendMedia(chatId, media, signal);
      this.logger.info('job_completed', { platform: platform.id, kind, bytes: media.size });
    } catch (error) {
      throwIfAborted(signal);
      if (error.code === 'ENOSPC') throw new AppError('LOW_DISK');
      throw error;
    } finally {
      clearTimeout(timer);
      await stopWatch?.();
      if (directory) {
        try { await this.storage.remove(directory); }
        catch (error) { this.logger.error('temp_cleanup_failed', { code: errorCode(error) }); }
      }
    }
  }
}
