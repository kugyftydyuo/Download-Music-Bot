import { AppError, publicMessage, throwIfAborted } from '../core/errors.js';
import { TtlStore } from '../core/ttl-store.js';
import { errorCode } from '../infrastructure/logger.js';
import { subscriptionKeyboard, modeKeyboard } from './keyboards.js';
import { UpdateGuard } from './update-guard.js';

export function registerHandlers({ bot, telegram, config, channels, subscriptions, queue, registry, jobs, logger }) {
  const sessions = new TtlStore({ ttlMs: config.sessionTtlMs });
  const cooldowns = new TtlStore({ ttlMs: config.userCooldownMs });
  const guard = new UpdateGuard();
  const keyboard = () => subscriptionKeyboard(channels.snapshot.channels);
  const menu = (chatId) => telegram.sendText(chatId, 'Что хотите скачать? Выберите формат, затем отправьте ссылку.', { reply_markup: modeKeyboard });
  const report = async (chatId, error) => {
    const options = error?.code === 'UNSUBSCRIBED' ? { reply_markup: keyboard() } : {};
    await telegram.sendText(chatId, publicMessage(error), options);
  };
  const dispatch = (userId, chatId, task) => guard.run(userId, task, async (error) => {
    logger.warn('update_failed', { code: errorCode(error) });
    try { await report(chatId, error); } catch (sendError) { logger.warn('error_reply_failed', { code: errorCode(sendError) }); }
  });

  async function handleMessage(message) {
    const { id: chatId } = message.chat;
    const userId = message.from.id;
    const text = message.text?.trim() ?? '';
    const command = text.split(/\s/, 1)[0].split('@')[0].toLowerCase();
    if (command === '/id') return telegram.sendText(chatId, `Ваш Telegram user ID: ${userId}`);
    if (command === '/cancel') {
      const cancelled = queue.cancel(userId);
      return telegram.sendText(chatId, cancelled
        ? 'Отмена запрошена. Если отправка уже началась, файл ещё может прийти.'
        : 'У вас нет задачи в очереди или обработке.');
    }
    if (command === '/status') {
      const stats = queue.stats;
      return telegram.sendText(chatId, `Обрабатывается: ${stats.active}. Ожидает: ${stats.waiting}.\nВаша задача: ${queue.has(userId) ? 'принята' : 'отсутствует'}.`);
    }
    if (command === '/reload_channels') {
      if (!config.adminIds.has(String(userId))) return telegram.sendText(chatId, 'Команда доступна только владельцу бота.');
      try {
        const snapshot = await channels.reload();
        return telegram.sendText(chatId, `Список обновлён. Каналов: ${snapshot.channels.length}. Старые проверки подписки сброшены.`);
      } catch (error) {
        logger.warn('channels_reload_failed', { code: errorCode(error) });
        return telegram.sendText(chatId, 'Не удалось обновить каналы. Проверьте JSON-файл и права администратора бота во всех каналах. Предыдущий список сохранён.');
      }
    }
    if (command === '/help') {
      return telegram.sendText(chatId,
        `/start — начать и выбрать формат\n/cancel — отменить задачу\n/status — посмотреть очередь\n/id — узнать свой ID\n\n` +
        `YouTube: MP4 до ${config.maxVideoHeight}p или MP3 192 кбит/с. Файл до ${config.maxUploadBytes / 1_000_000} МБ, ролик до ${Math.floor(config.maxDuration / 60)} мин. ` +
        'Одна ссылка = одна задача. Скачивайте только материалы, на которые у вас есть права или разрешение.');
    }
    if (command === '/start') {
      sessions.delete(userId);
      if (!channels.snapshot.channels.length) {
        await telegram.sendText(chatId, 'Привет! Помогу скачать видео или аудио из YouTube.');
        return menu(chatId);
      }
      return telegram.sendText(chatId, 'Привет! Помогу скачать видео или аудио из YouTube. Подпишитесь на каналы и нажмите кнопку проверки.', { reply_markup: keyboard() });
    }
    if (text.startsWith('/')) return telegram.sendText(chatId, 'Неизвестная команда. Список команд: /help');
    const kind = sessions.get(userId);
    if (!kind) {
      await subscriptions.assertAccess(userId);
      return menu(chatId);
    }
    if (queue.has(userId)) throw new AppError('ALREADY_QUEUED');
    if (cooldowns.get(userId)) throw new AppError('COOLDOWN');
    const resolved = registry.resolve(text);
    await subscriptions.assertAccess(userId, { fresh: true });
    let acknowledgment;
    const ticket = queue.enqueue(userId, async (signal) => {
      try {
        await acknowledgment;
        throwIfAborted(signal);
        await jobs.execute({ userId, chatId, kind, ...resolved }, signal);
      } catch (error) {
        logger.warn('job_failed', { code: errorCode(error), platform: resolved.platform.id, kind });
        if (!signal.aborted) {
          try { await report(chatId, error); }
          catch (sendError) { logger.warn('job_error_reply_failed', { code: errorCode(sendError) }); }
        }
        throw error;
      }
    });
    cooldowns.set(userId, true);
    acknowledgment = telegram.sendText(chatId, ticket.position > 0
      ? `Задача принята. Перед вами в ожидании: ${ticket.position - 1}. Используйте /cancel для отмены.`
      : 'Задача принята. Используйте /cancel для отмены.');
    // Также ожидаем в обработчике: быстрые повторные сообщения не обходят admission.
    await acknowledgment;
  }

  async function handleCallback(query) {
    try { await telegram.answerCallback(query.id, 'Обрабатываю…'); }
    catch (error) { logger.warn('callback_answer_failed', { code: errorCode(error) }); }
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    if (query.data === 'subscription:check') {
      await subscriptions.assertAccess(userId, { fresh: true });
      await telegram.sendText(chatId, 'Подписка проверена. Доступ открыт.');
      return menu(chatId);
    }
    if (['mode:video', 'mode:audio'].includes(query.data)) {
      await subscriptions.assertAccess(userId);
      const kind = query.data.slice(5);
      sessions.set(userId, kind);
      return telegram.sendText(chatId, `Выбрано: ${kind === 'video' ? 'видео MP4' : 'аудио MP3'}. Отправьте одну ссылку на ролик YouTube.`);
    }
    return telegram.sendText(chatId, 'Кнопка устарела. Начните заново: /start');
  }

  const onMessage = (ctx) => {
    const message = ctx.message;
    if (message.chat?.type !== 'private' || !message.from || message.from.is_bot) return;
    dispatch(message.from.id, message.chat.id, () => handleMessage(message));
  };
  const onCallback = (ctx) => {
    const query = ctx.callbackQuery;
    if (query.message?.chat?.type !== 'private' || query.from?.is_bot || !query.from) return;
    dispatch(query.from.id, query.message.chat.id, () => handleCallback(query));
  };
  bot.on('message', onMessage);
  bot.on('callback_query', onCallback);
  return {
    idle: () => guard.idle(),
    async close() {
      await guard.close();
    },
  };
}
