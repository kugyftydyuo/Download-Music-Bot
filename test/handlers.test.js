import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'node-telegram-bot-api';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { registerHandlers } from '../src/bot/handlers.js';
import { loadConfig } from '../src/config/index.js';
import { JobQueue } from '../src/core/job-queue.js';
import { PlatformRegistry } from '../src/platforms/registry.js';
import { YoutubeProvider } from '../src/platforms/youtube/provider.js';
import { TiktokProvider } from '../src/platforms/tiktok/provider.js';
import { AppError } from '../src/core/errors.js';

function fixture() {
  const bot = new Bot('test-token');
  let updateId = 0;
  const sent = [];
  const executed = [];
  let subscribed = false;
  const telegram = {
    async sendText(chatId, text, options) { sent.push({ chatId, text, options }); },
    async answerCallback() {},
  };
  const subscriptions = { async assertAccess() { if (!subscribed) throw new AppError('UNSUBSCRIBED'); } };
  const config = loadConfig({}, { requireToken: false });
  const queue = new JobQueue({ concurrency: 1, maxQueueSize: 2 });
  const handlers = registerHandlers({
    bot, telegram, config, queue, subscriptions,
    channels: { snapshot: { channels: [{ id: '@channel', title: 'Канал', url: 'https://t.me/channel' }] } },
    registry: new PlatformRegistry([new YoutubeProvider(config), new TiktokProvider(config)]),
    jobs: { async execute(job) { executed.push(job); } },
    logger: { info() {}, warn() {}, error() {} },
  });
  const emit = async (type, payload) => {
    await bot.handleUpdate({ update_id: ++updateId, [type]: payload });
    await handlers.idle();
    await nextTurn();
  };
  return { sent, executed, handlers, queue, subscribe() { subscribed = true; },
    message: (text) => emit('message', { chat: { id: 1, type: 'private' }, from: { id: 1 }, text }),
    callback: (data) => emit('callback_query', { id: 'callback', from: { id: 1 }, message: { chat: { id: 1, type: 'private' } }, data }),
  };
}

test('start -> denied -> subscribe -> select audio -> enqueue link', async () => {
  const f = fixture();
  await f.message('/start');
  assert(f.sent.at(-1).options.reply_markup.inline_keyboard.some((row) => row[0].callback_data === 'subscription:check'));
  await f.callback('mode:audio');
  assert.match(f.sent.at(-1).text, /Сначала подпишитесь/);
  assert.equal(f.executed.length, 0);
  f.subscribe();
  await f.callback('subscription:check');
  assert.equal(f.sent.at(-1).options.reply_markup.inline_keyboard[0][0].callback_data, 'mode:video');
  await f.callback('mode:audio');
  await f.message('https://youtu.be/BaW_jenozKc');
  assert.equal(f.executed.length, 1);
  assert.equal(f.executed[0].kind, 'audio');
  await f.handlers.close();
  await f.queue.close();
});

test('a URL before format selection shows a menu, an unauthorised owner command fails', async () => {
  const f = fixture();
  f.subscribe();
  await f.message('https://youtu.be/BaW_jenozKc');
  assert.equal(f.executed.length, 0);
  assert.match(f.sent.at(-1).text, /Выберите формат/);
  await f.message('/reload_channels');
  assert.match(f.sent.at(-1).text, /только владельцу/);
  await f.message('/id');
  assert.match(f.sent.at(-1).text, /ID: 1/);
  await f.handlers.close();
  await f.queue.close();
});


test('TikTok link uses the same subscription gate and selected mode', async () => {
  const f = fixture();
  f.subscribe();
  await f.callback('mode:video');
  await f.message('https://vm.tiktok.com/ABC123/');
  assert.equal(f.executed.length, 1);
  assert.equal(f.executed[0].platform.id, 'tiktok');
  assert.equal(f.executed[0].kind, 'video');
  await f.handlers.close();
  await f.queue.close();
});
