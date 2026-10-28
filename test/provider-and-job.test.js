import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config/index.js';
import { AppError } from '../src/core/errors.js';
import { YoutubeProvider } from '../src/platforms/youtube/provider.js';
import { selectVideoFormat } from '../src/platforms/youtube/formats.js';
import { DownloadJobService } from '../src/services/download-job.js';

const formats = [
  { format_id: '720', ext: 'mp4', vcodec: 'avc1.64001F', acodec: 'none', height: 720, filesize: 100_000_000 },
  { format_id: '360', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'none', height: 360, filesize: 10_000_000 },
  { format_id: 'aac', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 1_000_000, abr: 128 },
];
const config = loadConfig({}, { requireToken: false });

test('format selection lowers quality to fit the Telegram budget', () => {
  assert.equal(selectVideoFormat(formats, { ...config, duration: 120 }), '360+aac');
  assert.throws(() => selectVideoFormat(formats, { ...config, maxUploadBytes: 1, duration: 120 }), { code: 'TOO_LARGE' });
  assert.throws(() => selectVideoFormat([], { ...config, duration: 120 }), { code: 'FORMAT_UNAVAILABLE' });
});

test('YouTube provider controls arguments and output path', async (t) => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp(path.resolve('work', 'provider-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const provider = new YoutubeProvider(config, async (command, args) => {
    calls.push({ command, args });
    if (args.includes('--dump-single-json')) return { stdout: JSON.stringify({ title: 'Test\nvideo', duration: 10, formats }) };
    const source = path.join(directory, 'source.mp4');
    await writeFile(source, Buffer.alloc(10));
    return { stdout: `${source}\n` };
  });
  const url = 'https://www.youtube.com/watch?v=BaW_jenozKc';
  const result = await provider.download({ url, kind: 'video', directory });
  assert.equal(result.title, 'Testvideo');
  assert.equal(result.duration, 10);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args.slice(-2), ['--', url]);
  assert(calls[1].args.includes('--ignore-config'));
  assert(calls[1].args.includes('--no-playlist'));
  assert(calls[1].args.includes('--max-filesize'));
  assert(calls[1].args.includes('--abort-on-unavailable-fragments'));
  assert(calls[1].args.includes('360+aac'));
});

test('provider refuses live/long videos before downloading and rejects escaped paths', async () => {
  for (const [info, code] of [
    [{ is_live: true, duration: 10 }, 'LIVE_UNSUPPORTED'],
    [{ duration: config.maxDuration + 1 }, 'TOO_LONG'],
    [{ duration: null }, 'MEDIA_UNAVAILABLE'],
  ]) {
    let calls = 0;
    const provider = new YoutubeProvider(config, async () => { calls += 1; return { stdout: JSON.stringify(info) }; });
    await assert.rejects(provider.download({ url: 'x', kind: 'audio', directory: 'work' }), { code });
    assert.equal(calls, 1);
  }
  const provider = new YoutubeProvider(config, async (_command, args) => ({ stdout: args.includes('--dump-single-json')
    ? JSON.stringify({ title: 'x', duration: 10 }) : '/outside/source.mp3\n' }));
  await assert.rejects(provider.download({ url: 'x', kind: 'audio', directory: path.resolve('work') }), { code: 'DOWNLOAD_FAILED' });
});

function jobFixture(overrides = {}) {
  const events = [];
  const dependencies = {
    config: { jobTimeoutMs: 1000 },
    subscriptions: { async assertAccess(_id, options) { assert.equal(options.fresh, true); events.push('check'); } },
    storage: {
      async create() { events.push('create'); return '/test/job'; },
      watch() { return async () => { events.push('stop-watch'); }; },
      async remove() { events.push('remove'); },
    },
    converter: { async convert() { events.push('convert'); return { size: 100 }; } },
    telegram: { async sendText() {}, async sendMedia() { events.push('send'); } },
    logger: { info() {}, error() {} },
    ...overrides,
  };
  const platform = { id: 'test', async download() { events.push('download'); return {}; } };
  return { service: new DownloadJobService(dependencies), events, platform };
}

test('job rechecks subscriptions before download and send, and always cleans up', async () => {
  const fixture = jobFixture();
  await fixture.service.execute({ userId: 1, chatId: 1, platform: fixture.platform, kind: 'audio', url: 'x' }, new AbortController().signal);
  assert.deepEqual(fixture.events, ['check', 'create', 'download', 'convert', 'check', 'send', 'stop-watch', 'remove']);
  fixture.events.length = 0;
  fixture.platform.download = async () => { throw new AppError('DOWNLOAD_FAILED'); };
  await assert.rejects(fixture.service.execute({ userId: 1, chatId: 1, platform: fixture.platform }, new AbortController().signal), { code: 'DOWNLOAD_FAILED' });
  assert.deepEqual(fixture.events, ['check', 'create', 'stop-watch', 'remove']);
});

test('job times out stalled work and still releases temporary storage', async () => {
  const fixture = jobFixture({ config: { jobTimeoutMs: 30 } });
  fixture.platform.download = ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  await assert.rejects(fixture.service.execute({ userId: 1, chatId: 1, platform: fixture.platform }, new AbortController().signal), { code: 'TIMEOUT' });
  assert.equal(fixture.events.at(-1), 'remove');
});

test('unsubscribed users waiting in queue never start downloading', async () => {
  const fixture = jobFixture({ subscriptions: { async assertAccess() { throw new AppError('UNSUBSCRIBED'); } } });
  await assert.rejects(fixture.service.execute({ userId: 1, platform: fixture.platform }, new AbortController().signal), { code: 'UNSUBSCRIBED' });
  assert.deepEqual(fixture.events, []);
});
