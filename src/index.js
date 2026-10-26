import dotenv from 'dotenv';
import { Bot } from 'node-telegram-bot-api';
import { loadConfig } from './config/index.js';
import { JobQueue } from './core/job-queue.js';
import { logger, errorCode } from './infrastructure/logger.js';
import { TelegramGateway } from './infrastructure/telegram.js';
import { TempStorage } from './infrastructure/temp-storage.js';
import { checkDependencies } from './infrastructure/dependencies.js';
import { ChannelStore } from './services/channels.js';
import { SubscriptionService, verifyBotChannels } from './services/subscriptions.js';
import { MediaConverter } from './services/media-converter.js';
import { DownloadJobService } from './services/download-job.js';
import { PlatformRegistry } from './platforms/registry.js';
import { YoutubeProvider } from './platforms/youtube/provider.js';
import { registerHandlers } from './bot/handlers.js';

dotenv.config({ quiet: true });
let bot;
let telegram;
let queue;
let handlers;
let stopping = false;

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  logger.info('shutdown_started');
  const hardStop = setTimeout(() => process.exit(1), 20000);
  hardStop.unref();
  try {
    // Сначала останавливаем admission, затем задачи и внешние соединения.
    const closeHandlers = handlers?.close();
    bot?.stop();
    await queue?.close();
    await closeHandlers;
    await telegram?.close();
  } catch (error) { logger.error('shutdown_failed', { code: errorCode(error) }); }
  clearTimeout(hardStop);
  process.exit(exitCode);
}

async function main() {
  const config = loadConfig();
  const dependencies = await checkDependencies(config);
  const missing = dependencies.filter((item) => !item.ok);
  if (missing.length) throw new Error(`Не найдены зависимости: ${missing.map((item) => item.name).join(', ')}. Запустите npm run doctor.`);
  const storage = new TempStorage(config);
  await storage.init();
  await storage.assertFree({ reserveJob: true });
  bot = new Bot(config.token, {
    apiRoot: config.apiRoot, timeoutMs: config.telegramTimeoutMs,
    // Не повторяем сетевой тайм-аут отправки: Telegram уже мог принять файл.
    // Явные 429 повторяет наш ограниченный TelegramGateway.
    maxRetries: 0,
  });
  telegram = new TelegramGateway(bot.api);
  const me = await telegram.getMe();
  const webhook = await telegram.call(() => bot.api.getWebhookInfo());
  if (webhook.url) throw new Error('У бота настроен webhook. Удалите его перед запуском в режиме polling. См. README.');
  const channels = new ChannelStore({
    file: config.channelsFile,
    verify: (list) => verifyBotChannels(telegram, me.id, list),
  });
  await channels.reload();
  const subscriptions = new SubscriptionService({ telegram, channels, cacheMs: config.subscriptionCacheMs });
  queue = new JobQueue({ concurrency: config.concurrency, maxQueueSize: config.maxQueueSize });
  const converter = new MediaConverter(config);
  const jobs = new DownloadJobService({ config, subscriptions, storage, converter, telegram, logger });
  // Composition root: подключение новой платформы не меняет обработчики и очередь.
  const registry = new PlatformRegistry([new YoutubeProvider(config)]);
  handlers = registerHandlers({ bot, telegram, config, channels, subscriptions, queue, registry, jobs, logger });
  bot.catch((error) => { logger.warn('middleware_failed', { code: errorCode(error) }); });
  void bot.startPolling(undefined, {
    timeout: 25, allowedUpdates: ['message', 'callback_query'], retryDelayMs: 2000,
    onError: (error) => logger.warn('polling_error', { code: errorCode(error) }),
  }).catch((error) => {
    logger.error('polling_failed', { code: errorCode(error) });
    void shutdown(1);
  });
  logger.info('bot_started', { username: me.username, channels: channels.snapshot.channels.length, concurrency: config.concurrency });
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
process.on('unhandledRejection', () => { logger.error('unhandled_rejection'); void shutdown(1); });
process.on('uncaughtException', () => { logger.error('uncaught_exception'); void shutdown(1); });

void main().catch(async (error) => {
  // Наши конфигурационные Error безопасны. Сетевые ошибки могут содержать токен.
  const message = error.constructor === Error && !error.response ? error.message : undefined;
  logger.error('startup_failed', { code: errorCode(error), ...(message ? { message } : {}) });
  await shutdown(1);
});
