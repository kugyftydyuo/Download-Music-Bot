import { fromPath } from 'node-telegram-bot-api/node';
import { setTimeout as delay } from 'node:timers/promises';
import { throwIfAborted } from '../core/errors.js';
import { ApiScheduler } from './api-scheduler.js';

export class TelegramGateway {
  constructor(api, scheduler = new ApiScheduler()) { this.api = api; this.scheduler = scheduler; }
  call(operation, options) {
    return this.scheduler.schedule(async () => {
      for (let attempt = 0; ; attempt += 1) {
        throwIfAborted(options?.signal);
        try { return await operation(); }
        catch (error) {
          const wait = error?.retryAfter;
          // 429 означает явный отказ: такой запрос можно повторить без дубликата.
          // Тайм-аут отправки НЕ повторяем: Telegram уже мог принять файл.
          if (error?.errorCode !== 429 || !Number.isFinite(wait) || wait < 0 || wait > 60 || attempt >= 2) throw error;
          await delay((wait + 1) * 1000, undefined, { signal: options?.signal });
        }
      }
    }, options);
  }
  getMe() { return this.call(() => this.api.getMe()); }
  getChat(id) { return this.call(() => this.api.getChat({ chat_id: id })); }
  getChatMember(id, userId) { return this.call(() => this.api.getChatMember({ chat_id: id, user_id: userId })); }
  sendText(chatId, text, options = {}, signal) {
    return this.call(() => this.api.sendMessage({ chat_id: chatId, text, ...options }, signal), { chatId, signal });
  }
  answerCallback(id, text) {
    return this.call(() => this.api.answerCallbackQuery({ callback_query_id: id, text }));
  }
  async sendMedia(chatId, media, signal) {
    return this.call(async () => {
      throwIfAborted(signal);
      // fromPath открывает поток с диска. Весь файл в память не загружается.
      const file = await fromPath(media.path, {
        filename: media.kind === 'video' ? 'video.mp4' : 'audio.mp3',
        contentType: media.kind === 'video' ? 'video/mp4' : 'audio/mpeg',
      });
      const options = { chat_id: chatId, caption: media.title.slice(0, 900), duration: Math.ceil(media.duration) };
      if (media.kind === 'video') {
        return this.api.sendVideo({ ...options, video: file, supports_streaming: true }, signal);
      }
      return this.api.sendAudio({ ...options, audio: file, title: media.title.slice(0, 128) }, signal);
    }, { chatId, signal });
  }
  close() { return this.scheduler.close(); }
}
