import dotenv from 'dotenv';
import { Api } from 'node-telegram-bot-api';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../src/config/index.js';
import { checkDependencies } from '../src/infrastructure/dependencies.js';
import { TelegramGateway } from '../src/infrastructure/telegram.js';
import { validateChannels } from '../src/services/channels.js';
import { verifyBotChannels } from '../src/services/subscriptions.js';
import { errorCode } from '../src/infrastructure/logger.js';

dotenv.config({ quiet: true });
let telegram;

try {
  const online = process.argv.includes('--telegram');
  const config = loadConfig(process.env, { requireToken: online });

  console.log(`Node.js: ${process.version} ${Number(process.versions.node.split('.')[0]) >= 24 ? 'OK' : 'НУЖНА ВЕРСИЯ 24+'}`);

  let ok = Number(process.versions.node.split('.')[0]) >= 24;

  for (const check of await checkDependencies(config)) {
    console.log(`${check.name}: ${check.ok ? check.version : `НЕ НАЙДЕН / ОШИБКА (${check.code})`}`);
    if (!check.ok) ok = false;
  }

  let channels;
  try {
    channels = validateChannels(JSON.parse(await readFile(config.channelsFile, 'utf8')));
    console.log(`Файл каналов: OK (${channels.length})`);
  } catch {
    ok = false;
    console.log('Файл каналов: отсутствует или содержит неверный JSON/каналы. См. config/channels.example.json.');
  }

  console.log(`Максимум файла: ${config.maxUploadBytes / 1_000_000} МБ. Задач одновременно: ${config.concurrency}.`);

  if (online) {
    const api = new Api(config.token, { apiRoot: config.apiRoot, timeoutMs: config.telegramTimeoutMs, maxRetries: 0 });
    telegram = new TelegramGateway(api);
    const me = await telegram.getMe();

    console.log(`Telegram: OK (@${me.username})`);

    if (channels) {
      await verifyBotChannels(telegram, me.id, channels);
      console.log('Права бота во всех каналах: OK');
    }

    const webhook = await telegram.call(() => api.getWebhookInfo());
    if (webhook.url) {
      ok = false;
      console.log('Активен webhook. Для перехода на polling см. README.');
    }

  } else console.log('Токен, Telegram и права проверяются отдельно: npm run doctor -- --telegram');

  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(`Диагностика не пройдена. Код: ${errorCode(error)}. Проверьте .env, права и подключение.`);
  process.exitCode = 1;
} finally {
  await telegram?.close();
}
