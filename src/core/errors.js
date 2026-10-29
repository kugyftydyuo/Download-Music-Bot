/** Публичные коды ошибок отделены от технических сообщений внешних программ. */
export class AppError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
  }
}

const messages = {
  INVALID_URL: 'Отправьте одну HTTPS-ссылку на ролик YouTube (watch, Shorts или youtu.be).',
  UNSUPPORTED_PLATFORM: 'Пока поддерживается только YouTube.',
  UNSUBSCRIBED: 'Сначала подпишитесь на все каналы и нажмите «Проверить подписку».',
  SUBSCRIPTION_UNAVAILABLE: 'Сейчас не удалось проверить подписку. Попробуйте чуть позже.',
  QUEUE_FULL: 'Очередь заполнена. Попробуйте через несколько минут.',
  ALREADY_QUEUED: 'У вас уже есть задача. Дождитесь результата или используйте /cancel.',
  COOLDOWN: 'Слишком частые загрузки. Подождите немного и отправьте ссылку снова.',
  CLOSED: 'Бот перезапускается. Повторите запрос через минуту.',
  TOO_LONG: 'Ролик длиннее разрешённого лимита. Выберите более короткий.',
  TOO_LARGE: 'Файл превышает лимит отправки. Попробуйте более короткий ролик или аудио.',
  LIVE_UNSUPPORTED: 'Прямые эфиры и запланированные трансляции не поддерживаются.',
  YOUTUBE_AUTH_REQUIRED: 'YouTube требует подтверждения доступа на сервере. Попробуйте позже или сообщите владельцу бота.',
  COOKIES_UNAVAILABLE: 'Не удалось загрузить настройки авторизации YouTube. Сообщите владельцу бота.',
  MEDIA_UNAVAILABLE: 'Видео недоступно: оно может быть удалено, приватным или иметь ограничения.',
  FORMAT_UNAVAILABLE: 'Нет подходящего формата MP4/H.264 с аудио. Попробуйте другой ролик или аудио.',
  DOWNLOAD_FAILED: 'YouTube не отдал медиа. Попробуйте позже; если ошибка повторяется, сообщите владельцу бота.',
  PROCESS_FAILED: 'Не удалось обработать медиа. Попробуйте другой ролик.',
  PROCESS_MISSING: 'На сервере не настроен загрузчик или FFmpeg. Сообщите владельцу бота.',
  TIMEOUT: 'Превышено время обработки. Попробуйте более короткий ролик.',
  CANCELLED: 'Задача отменена.',
  DISK_LIMIT: 'Для этой задачи требуется слишком много места. Попробуйте более короткий ролик.',
  LOW_DISK: 'На сервере временно недостаточно свободного места. Попробуйте позже.',
  TELEGRAM_BUSY: 'Telegram временно перегружен. Попробуйте позже.',
};

export function publicMessage(error) {
  return messages[error?.code] ?? 'Не удалось выполнить запрос. Попробуйте позже.';
}
export function abortError(signal) {
  return signal?.reason instanceof AppError ? signal.reason : new AppError('CANCELLED');
}
export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}
