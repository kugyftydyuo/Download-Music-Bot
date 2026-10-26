import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/index.js';
import { validateChannels } from '../src/services/channels.js';
import { TtlStore } from '../src/core/ttl-store.js';
import { PlatformRegistry } from '../src/platforms/registry.js';
import { YoutubeProvider } from '../src/platforms/youtube/provider.js';

const registry = new PlatformRegistry([new YoutubeProvider({})]);
const videoId = 'dQw4w9WgXcQ';

test('configuration refuses unsafe limits and invalid owners', () => {
  const config = loadConfig({}, { requireToken: false });
  assert.equal(config.concurrency, 1);
  assert.equal(config.maxUploadBytes, 49_000_000);
  for (const env of [
    { DOWNLOAD_CONCURRENCY: '0' }, { DOWNLOAD_CONCURRENCY: '1.5' },
    { MAX_QUEUE_SIZE: '-1' }, { MAX_UPLOAD_MB: '50' },
    { MAX_JOB_DISK_MB: '50' }, { ADMIN_USER_IDS: '@admin' },
    { TELEGRAM_API_ROOT: 'https://api.telegram.org/private' },
  ]) assert.throws(() => loadConfig(env, { requireToken: false }));
  assert.throws(() => loadConfig({ BOT_TOKEN: '' }));
  assert.equal(loadConfig({ ADMIN_USER_IDS: '12, 34' }, { requireToken: false }).adminIds.has('34'), true);
});

test('accepted YouTube links become a single canonical video', () => {
  for (const url of [
    `https://youtu.be/${videoId}?t=1`, `https://www.youtube.com/watch?v=${videoId}&list=PL123`,
    `https://m.youtube.com/shorts/${videoId}`, `https://music.youtube.com/watch?v=${videoId}`,
    `https://youtube.com/live/${videoId}`, `https://youtube.com/embed/${videoId}`,
  ]) assert.equal(registry.resolve(url).url, `https://www.youtube.com/watch?v=${videoId}`);
});

test('untrusted URLs never reach yt-dlp', () => {
  for (const url of [
    'file:///etc/passwd', 'http://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://127.0.0.1/', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://evil.test/?v=dQw4w9WgXcQ', 'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com:8443/watch?v=dQw4w9WgXcQ', 'https://youtube.com/playlist?list=PL123',
    'https://youtube.com/watch?v=invalid', '--exec whoami',
    'https://youtube.com/redirect?q=https://127.0.0.1',
    `https://youtu.be/${videoId} another link`,
  ]) assert.throws(() => registry.resolve(url));
});

test('channel configuration validates public/private IDs and duplicate entries', () => {
  const publicChannel = { id: '@example_channel', title: 'Канал', url: 'https://t.me/example_channel' };
  assert.equal(validateChannels([publicChannel, { id: '-1001234567890', url: 'https://t.me/+InviteCode' }]).length, 2);
  assert.deepEqual(validateChannels([]), []);
  assert.throws(() => validateChannels([publicChannel, publicChannel]));
  assert.throws(() => validateChannels([{ ...publicChannel, url: 'https://evil.test' }]));
  assert.throws(() => validateChannels([{ ...publicChannel, id: '12345' }]));
});

test('TTL store expires values and keeps a bounded number of entries', () => {
  let now = 0;
  const store = new TtlStore({ ttlMs: 10, maxSize: 2, now: () => now });
  store.set('a', 1); store.set('b', 2); store.set('c', 3);
  assert.equal(store.get('a'), undefined);
  assert.equal(store.get('b'), 2);
  now = 11;
  assert.equal(store.get('b'), undefined);
});
