import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Api } from 'node-telegram-bot-api';
import { TelegramGateway } from '../src/infrastructure/telegram.js';
import { ApiScheduler } from '../src/infrastructure/api-scheduler.js';

const scheduler = () => new ApiScheduler({ intervalMs: 0, chatIntervalMs: 0 });
const response = (result = {}) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });

test('v2 Telegram API sends structured parameters and streams a local file', async (t) => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp(path.resolve('work', 'telegram-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'result.mp3');
  await writeFile(file, 'synthetic-audio-payload');
  const calls = [];
  const api = new Api('test-token', { maxRetries: 0, fetch: async (url, init) => {
    const body = init.body instanceof ReadableStream ? await new Response(init.body).text() : String(init.body);
    calls.push({ method: url.split('/').at(-1), body });
    return response({ message_id: 1 });
  } });
  const gateway = new TelegramGateway(api, scheduler());
  await gateway.sendText(123, 'Тест', { reply_markup: { inline_keyboard: [] } });
  await gateway.getChatMember('@channel', 123);
  await gateway.answerCallback('callback-id', 'Готово');
  await gateway.sendMedia(123, { path: file, kind: 'audio', title: 'Музыка', duration: 1 });
  assert.deepEqual(calls.map((call) => call.method), ['sendMessage', 'getChatMember', 'answerCallbackQuery', 'sendAudio']);
  assert.match(calls.at(-1).body, /synthetic-audio-payload/);
  assert.match(calls.at(-1).body, /audio\.mp3/);
  assert.match(calls.at(-1).body, /audio\/mpeg/);
  await gateway.close();
});

test('ambiguous network failure is not retried by library or gateway', async () => {
  let attempts = 0;
  const api = new Api('test-token', { maxRetries: 0, fetch: async () => { attempts += 1; throw new TypeError('network'); } });
  const gateway = new TelegramGateway(api, scheduler());
  await assert.rejects(gateway.sendText(1, 'test'), { code: 'EFETCH' });
  assert.equal(attempts, 1);
  await gateway.close();
});

test('a definite Telegram 429 is retried after retry_after', async () => {
  let attempts = 0;
  const api = new Api('test-token', { maxRetries: 0, fetch: async () => {
    attempts += 1;
    return attempts === 1
      ? new Response(JSON.stringify({ ok: false, error_code: 429, description: 'rate limit', parameters: { retry_after: 0 } }), { status: 429 })
      : response({ message_id: 1 });
  } });
  const gateway = new TelegramGateway(api, scheduler());
  await gateway.sendText(1, 'test');
  assert.equal(attempts, 2);
  await gateway.close();
});

test('abort signal reaches an active Telegram request', async () => {
  const api = new Api('test-token', { maxRetries: 0, fetch: async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) return reject(init.signal.reason);
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }) });
  const gateway = new TelegramGateway(api, scheduler());
  const controller = new AbortController();
  const pending = gateway.sendText(1, 'test', {}, controller.signal);
  controller.abort();
  await assert.rejects(pending);
  await gateway.close();
});
