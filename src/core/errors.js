/** Публичные коды ошибок отделены от технических сообщений внешних программ. */
import {emojis} from "../../config/emojis.js";

export class AppError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = `AppError`;
    this.code = code;
  }
}

const messages = {
  INVALID_URL:`<tg-emoji emoji-id=${emojis.link}>👍</tg-emoji> Отправь одну HTTPS-ссылку на ролик <tg-emoji emoji-id=${emojis.YouTube}>👍</tg-emoji> YouTube (watch, Shorts или youtu.be).`,
  UNSUPPORTED_PLATFORM: `<tg-emoji emoji-id=${emojis.no_light}>👍</tg-emoji>Пока поддерживается только <tg-emoji emoji-id=${emojis.YouTube}>👍</tg-emoji> YouTube.`,
  UNSUBSCRIBED: `<tg-emoji emoji-id=${emojis.cross}>👍</tg-emoji> Сначала подпишись на все каналы и нажми <tg-emoji emoji-id=${emojis.check}>👍</tg-emoji> Проверить.`,
  SUBSCRIPTION_UNAVAILABLE: `<tg-emoji emoji-id=${emojis.stop}>👍</tg-emoji> Сейчас не удалось проверить подписку. Попробуй чуть позже.`,
  QUEUE_FULL: `<tg-emoji emoji-id=${emojis.no_man}>👍</tg-emoji> Очередь заполнена. Попробуй через несколько минут.`,
  ALREADY_QUEUED: `<tg-emoji emoji-id=${emojis.bag}>👍</tg-emoji> У тебя уже есть задача. Дождись результата или используй /cancel.`,
  COOLDOWN: `<tg-emoji emoji-id=${emojis.wifi}>👍</tg-emoji> Слишком частые загрузки. Подожди немного и отправь ссылку снова.`,
  CLOSED: `<tg-emoji emoji-id=${emojis.loading2}>👍</tg-emoji> Бот перезапускается. Повтори запрос через минуту.`,
  TOO_LONG: `<tg-emoji emoji-id=${emojis.cross_in_circle}>👍</tg-emoji> Ролик длиннее разрешённого лимита. Выбери более короткий.`,
  TOO_LARGE: `<tg-emoji emoji-id=${emojis.download_lock}>👍</tg-emoji> Файл превышает лимит отправки. Попробуй более короткий ролик или аудио.`,
  LIVE_UNSUPPORTED: `<tg-emoji emoji-id=${emojis.live}>👍</tg-emoji> Прямые эфиры и запланированные трансляции не поддерживаются.`,
  YOUTUBE_AUTH_REQUIRED: `<tg-emoji emoji-id=${emojis.stop}>👍</tg-emoji> YouTube требует подтверждения доступа на сервере. Попробуй позже.`,
  COOKIES_UNAVAILABLE: `<tg-emoji emoji-id=${emojis.error}>👍</tg-emoji> Не удалось загрузить настройки авторизации YouTube.`,
  MEDIA_UNAVAILABLE: `<tg-emoji emoji-id=${emojis.cross_in_circle}>👍</tg-emoji> Видео недоступно: оно может быть удалено, приватным или иметь ограничения.`,
  FORMAT_UNAVAILABLE: `<tg-emoji emoji-id=${emojis.cross_in_circle}>👍</tg-emoji> Нет подходящего формата MP4/H.264 с аудио. Попробуй другой ролик или аудио.`,
  DOWNLOAD_FAILED: `<tg-emoji emoji-id=${emojis.warning}>👍</tg-emoji> YouTube не отдал медиа. Попробуй позже.`,
  PROCESS_FAILED: `<tg-emoji emoji-id=${emojis.error}>👍</tg-emoji> Не удалось обработать медиа. Попробуй другой ролик.`,
  PROCESS_MISSING: `<tg-emoji emoji-id=${emojis.no_light}>👍</tg-emoji> На сервере не настроен загрузчик или FFmpeg.`,
  TIMEOUT: `<tg-emoji emoji-id=${emojis.cross}>👍</tg-emoji> Превышено время обработки. Попробуй более короткий ролик.`,
  CANCELLED: `<tg-emoji emoji-id=${emojis.stop}>👍</tg-emoji> Задача отменена.`,
  DISK_LIMIT: `<tg-emoji emoji-id=${emojis.warning}>👍</tg-emoji> Для этой задачи требуется слишком много места. Попробуй более короткий ролик.`,
  LOW_DISK: `<tg-emoji emoji-id=${emojis.download_lock}>👍</tg-emoji> На сервере временно недостаточно свободного места. Попробуй позже.`,
  TELEGRAM_BUSY: `<tg-emoji emoji-id=${emojis.wifi}>👍</tg-emoji> Telegram временно перегружен. Попробуйте позже.`,
};

export function publicMessage(error) {
  return messages[error?.code] ?? `<tg-emoji emoji-id=${emojis.settings}>👍</tg-emoji> Не удалось выполнить запрос. Попробуй позже.`;
}

export function abortError(signal) {
  return signal?.reason instanceof AppError ? signal.reason : new AppError(`CANCELLED`);
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}
