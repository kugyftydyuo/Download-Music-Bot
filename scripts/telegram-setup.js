import dotenv from 'dotenv';
import { Api } from 'node-telegram-bot-api';
import { loadConfig } from '../src/config/index.js';
import { errorCode } from '../src/infrastructure/logger.js';

dotenv.config({ quiet: true });
try {
  const config = loadConfig();
  const api = new Api(config.token, { apiRoot: config.apiRoot, timeoutMs: config.telegramTimeoutMs, maxRetries: 0 });
  await api.setMyCommands({ commands: [
    { command: 'start', description: 'Начать и выбрать формат' },
    { command: 'help', description: 'Инструкция и ограничения' },
    { command: 'cancel', description: 'Отменить задачу' },
    { command: 'status', description: 'Посмотреть очередь' },
    { command: 'id', description: 'Узнать свой Telegram user ID' },
  ] });
  if (process.argv.includes('--delete-webhook')) {
    // Только по явному флагу оператора. Уже накопленные обновления сохраняем.
    await api.deleteWebhook({ drop_pending_updates: false });
    console.log('Webhook удалён.');
  }
  console.log('Меню команд Telegram настроено.');
} catch (error) {
  console.error(`Не удалось настроить Telegram. Код: ${errorCode(error)}`);
  process.exitCode = 1;
}
