import { AppError, publicMessage, throwIfAborted } from '../core/errors.js';
import { TtlStore } from '../core/ttl-store.js';
import { errorCode } from '../infrastructure/logger.js';
import { subscriptionKeyboard, modeKeyboard } from './keyboards.js';
import { UpdateGuard } from './update-guard.js';
import {emojis} from "../../config/emojis.js";

export function registerHandlers({ bot, telegram, config, channels, subscriptions, queue, registry, jobs, logger }) {
  const sessions = new TtlStore({ ttlMs: config.sessionTtlMs });
  const cooldowns = new TtlStore({ ttlMs: config.userCooldownMs });
  const guard = new UpdateGuard();

  const keyboard = () => subscriptionKeyboard(channels.snapshot.channels);
  const menu = (chatId) => telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.question}>👍</tg-emoji>Что хочешь скачать?\n\n<tg-emoji emoji-id=${emojis.file}>👍</tg-emoji>Выбери формат:\n\n<tg-emoji emoji-id=${emojis.video}>👍</tg-emoji>Видео MP4 или <tg-emoji emoji-id=${emojis.audio}>👍</tg-emoji>Аудио MP3, затем отправь ссылку`, { reply_markup: modeKeyboard, parse_mode: 'HTML' });

  const report = async (chatId, error) => {
    const options = error?.code === 'UNSUBSCRIBED' ? { reply_markup: keyboard(), parse_mode: 'HTML' } : {parse_mode: 'HTML'};
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

    if (command === '/id') return telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.man}>👍</tg-emoji>Твой Telegram user ID: <code>${userId}</code>`, {parse_mode: 'HTML'});

    if (command === '/cancel') {
      const cancelled = queue.cancel(userId);
      return telegram.sendText(chatId, cancelled
        ? `<tg-emoji emoji-id=${emojis.stop}>👍</tg-emoji> Отмена запрошена.\n\n<tg-emoji emoji-id=${emojis.wifi}>👍</tg-emoji> Файл ещё может прийти если отправка уже началась`
        : `<tg-emoji emoji-id=${emojis.warning}>👍</tg-emoji> Отмена невозможна.\n\n<tg-emoji emoji-id=${emojis.error}>👍</tg-emoji> У тебя нет задач в очереди или обработке`, {parse_mode: 'HTML'});
    }

    if (command === '/status') {
      const stats = queue.stats;
      return telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.loading}>👍</tg-emoji> Обрабатывается: ${stats.active}\n\n<tg-emoji emoji-id=${emojis.time}>👍</tg-emoji> Ожидает: ${stats.waiting}\n\n<tg-emoji emoji-id=${emojis.dir}>👍</tg-emoji> Твоя задача: ${queue.has(userId) ? 'принята' : 'отсутствует'}`, {parse_mode: 'HTML'});
    }

    if (command === '/reload_channels') {
      if (!config.adminIds.has(String(userId))) return telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.cross}>👍</tg-emoji> Команда доступна только владельцу бота.`, {parse_mode: 'HTML'});

      try {
        const snapshot = await channels.reload();
        return telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.check}>👍</tg-emoji> Список обновлён. Каналов: ${snapshot.channels.length}\n\n<tg-emoji emoji-id=${emojis.reload}>👍</tg-emoji> Старые проверки подписки сброшены.`, {parse_mode: 'HTML'});
      } catch (error) {
        logger.warn('channels_reload_failed', { code: errorCode(error) });
        return telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.error}>👍</tg-emoji>Не удалось обновить каналы. Проверьте JSON-файл и права администратора бота во всех каналах. Предыдущий список сохранён.`, {parse_mode: 'HTML'});
      }
    }

    if (command === '/help') {
      return telegram.sendText(chatId,
        `/start - Перезапуск бота <tg-emoji emoji-id=${emojis.reload}>👍</tg-emoji>\n/cancel — Отменить задачу <tg-emoji emoji-id=${emojis.stop}>👍</tg-emoji>\n/status — Посмотреть очередь <tg-emoji emoji-id=${emojis.wait}>👍</tg-emoji>\n/id — Узнать свой ID <tg-emoji emoji-id=${emojis.man}>👍</tg-emoji>\n\n` +
        `<tg-emoji emoji-id=${emojis.exclamations}>👍</tg-emoji> Правила:\n\n<tg-emoji emoji-id=${emojis.YouTube}>👍</tg-emoji> YouTube:\n\n<tg-emoji emoji-id=${emojis.note}>👍</tg-emoji> MP4 до ${config.maxVideoHeight}p или MP3 192 кбит/с\n<tg-emoji emoji-id=${emojis.file}>👍</tg-emoji> Файл до ${config.maxUploadBytes / 1_000_000} МБ\n<tg-emoji emoji-id=${emojis.video}>👍</tg-emoji> Ролик до ${Math.floor(config.maxDuration / 60)} мин.\n` +
        `<tg-emoji emoji-id=${emojis.link}>👍</tg-emoji> Одна ссылка = одна задача`, {parse_mode: 'HTML'});
    }

    if (command === '/start') {
      sessions.delete(userId);

      if (!channels.snapshot.channels.length) {
        await telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.hello}>👍</tg-emoji> Добро пожаловать!\n\n<tg-emoji emoji-id=${emojis.download}>👍</tg-emoji>Я помогу тебе скачать видео или аудио из <tg-emoji emoji-id=${emojis.YouTube}>👍</tg-emoji>YouTube`, {parse_mode: 'HTML'});
        return menu(chatId);
      }

      return telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.hello}>👍</tg-emoji> Добро пожаловать!\n\n<tg-emoji emoji-id=${emojis.download}>👍</tg-emoji>Я помогу тебе скачать видео или аудио из <tg-emoji emoji-id=${emojis.YouTube}>👍</tg-emoji>YouTube\n\n<tg-emoji emoji-id=${emojis.tap}>👍</tg-emoji> Подпишись на каналы и нажми кнопку <tg-emoji emoji-id=${emojis.check}>👍</tg-emoji> Проверить.`, { reply_markup: keyboard(), parse_mode: 'HTML' });
    }

    if (text.startsWith('/')) return telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.question}>👍</tg-emoji>Неизвестная команда. Список команд: /help`, {parse_mode: 'HTML'});

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
      ? `<tg-emoji emoji-id=${emojis.check}>👍</tg-emoji> Задача принята.\n\n<tg-emoji emoji-id=${emojis.wait}>👍</tg-emoji> Перед тобой в ожидании: ${ticket.position - 1}.\n\n<tg-emoji emoji-id=${emojis.stop}>👍</tg-emoji> Используй /cancel для отмены.`
      : `<tg-emoji emoji-id=${emojis.check}>👍</tg-emoji> Задача принята.\n\n<tg-emoji emoji-id=${emojis.stop}>👍</tg-emoji> Используй /cancel для отмены.`, {parse_mode: 'HTML'});
    // Также ожидаем в обработчике: быстрые повторные сообщения не обходят admission.
    await acknowledgment;
  }

  async function handleCallback(query) {
    //try { await telegram.answerCallback(query.id, 'Обрабатываю…'); }
    //catch (error) { logger.warn('callback_answer_failed', { code: errorCode(error) }); }

    const chatId = query.message.chat.id;
    const userId = query.from.id;

    if (query.data === 'subscription:check') {
      await subscriptions.assertAccess(userId, { fresh: true });
      await telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.check2}>👍</tg-emoji> Подписка проверена.\n\n<tg-emoji emoji-id=${emojis.unlock}>👍</tg-emoji>Доступ открыт.`, {parse_mode: 'HTML'});
      return menu(chatId);
    }

    if (['mode:video', 'mode:audio'].includes(query.data)) {
      await subscriptions.assertAccess(userId);
      const kind = query.data.slice(5);
      sessions.set(userId, kind);

      const video = `<tg-emoji emoji-id=${emojis.video}>👍</tg-emoji>`
      const audio = `<tg-emoji emoji-id=${emojis.audio}>👍</tg-emoji>`
      return telegram.sendText(chatId, `Выбрано: ${kind === 'video' ? video + ' видео MP4' : audio + ' аудио MP3'}\n\n<tg-emoji emoji-id=${emojis.link}>👍</tg-emoji> Отправь одну ссылку на ролик <tg-emoji emoji-id=${emojis.YouTube}>👍</tg-emoji> YouTube.`, {parse_mode: 'HTML'});
    }

    if (query.data === "download_again") {
      await subscriptions.assertAccess(userId);
      return menu(chatId);
    }

    return telegram.sendText(chatId, `<tg-emoji emoji-id=${emojis.bucket}>👍</tg-emoji> Кнопка устарела. Начни заново: /start`, {parse_mode: 'HTML'});
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
