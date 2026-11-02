import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { TiktokProvider, selectTiktokVideo } from '../src/platforms/tiktok/provider.js';
import { YoutubeProvider } from '../src/platforms/youtube/provider.js';
import { PlatformRegistry } from '../src/platforms/registry.js';
import { loadConfig } from '../src/config/index.js';
import { AppError } from '../src/core/errors.js';

const config = loadConfig({}, { requireToken: false });
const videoUrl = 'https://www.tiktok.com/@example.user/video/7669754870378859783';
const formats = [
  { format_id: 'h265', ext: 'mp4', vcodec: 'h265', acodec: 'aac', width: 720, height: 1280, filesize: 1000 },
  { format_id: 'large', ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 720, height: 1280, filesize: 90_000_000 },
  { format_id: 'small', ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 576, height: 1024, filesize: 10000 },
];
const metadata = { extractor_key: 'TikTok', webpage_url: videoUrl, duration: 10, title: 'TikTok test', formats };

test('registry dispatches TikTok and keeps YouTube routing', () => {
  const registry = new PlatformRegistry([new YoutubeProvider(config), new TiktokProvider(config)]);
  for (const [input, normalized] of [
    [`${videoUrl}?_t=tracking`, videoUrl],
    [videoUrl.replace('www.', ''), videoUrl],
    ['https://vm.tiktok.com/ZN8yj9kn2/?x=1', 'https://vm.tiktok.com/ZN8yj9kn2/'],
    ['https://vt.tiktok.com/ABC123', 'https://vt.tiktok.com/ABC123/'],
    ['https://www.tiktok.com/t/ABC123/?x=1', 'https://www.tiktok.com/t/ABC123/'],
  ]) {
    const resolved = registry.resolve(input);
    assert.equal(resolved.platform.id, 'tiktok');
    assert.equal(resolved.url, normalized);
  }
  assert.equal(registry.resolve('https://youtu.be/BaW_jenozKc').platform.id, 'youtube');
  for (const url of [
    'https://tiktok.com.evil.test/@example/video/7669754870378859783',
    'https://user:pass@vm.tiktok.com/ABC', 'https://vm.tiktok.com:8080/ABC',
    'https://www.tiktok.com/@example', 'https://www.tiktok.com/@example/live',
    'https://www.tiktok.com/@example/photo/7669754870378859783',
    'https://vm.tiktok.com/redirect/evil', 'https://www.tiktok.com/music/title-7669754870378859783',
  ]) assert.throws(() => registry.resolve(url));
});

test('TikTok chooses compatible portrait video within byte budget', () => {
  assert.equal(selectTiktokVideo(formats, config, 10), 'small');
  assert.throws(() => selectTiktokVideo([formats[0]], config, 10), { code: 'FORMAT_UNAVAILABLE' });
  assert.throws(() => selectTiktokVideo([formats[1]], config, 10), { code: 'TOO_LARGE' });
});

for (const kind of ['video', 'audio']) {
  test(`TikTok ${kind} download resolves short link and isolates YouTube auth`, async (t) => {
    await mkdir('work', { recursive: true });
    const directory = await mkdtemp(path.resolve('work', 'tiktok-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const calls = [];
    const provider = new TiktokProvider({ ...config, youtubeCookiesFile: '/must/not/be/used' }, async (_cmd, args, options) => {
      calls.push(args);
      assert.equal(options.timeoutMs, config.processTimeoutMs);
      assert(!args.includes('--cookies'));
      assert.equal(args[args.indexOf('--use-extractors') + 1], 'tiktok$,vm[.]tiktok$');
      if (args.includes('--dump-single-json')) return { stdout: JSON.stringify(metadata) };
      assert.equal(args.at(-1), videoUrl);
      assert.equal(args[args.indexOf('--format') + 1], kind === 'video' ? 'small' : 'bestaudio/best');
      const source = path.join(directory, 'source.mp4');
      await writeFile(source, 'synthetic media');
      return { stdout: source };
    });
    const media = await provider.download({ url: 'https://vm.tiktok.com/ABC123/', kind, directory });
    assert.equal(media.duration, 10);
    assert.equal(media.title, 'TikTok test');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].at(-1), 'https://vm.tiktok.com/ABC123/');
  });
}

test('TikTok rejects non-video results and limits before downloading', async () => {
  for (const [info, code] of [
    [{ ...metadata, _type: 'playlist' }, 'TIKTOK_UNSUPPORTED'],
    [{ ...metadata, extractor_key: 'Youtube' }, 'TIKTOK_UNSUPPORTED'],
    [{ ...metadata, duration: 0 }, 'TIKTOK_UNSUPPORTED'],
    [{ ...metadata, duration: config.maxDuration + 1 }, 'TOO_LONG'],
    [{ ...metadata, is_live: true }, 'LIVE_UNSUPPORTED'],
    [{ ...metadata, webpage_url: 'https://127.0.0.1/' }, 'INVALID_URL'],
  ]) {
    let calls = 0;
    const provider = new TiktokProvider(config, async () => { calls += 1; return { stdout: JSON.stringify(info) }; });
    await assert.rejects(provider.download({ url: videoUrl, kind: 'audio', directory: 'work' }), { code });
    assert.equal(calls, 1);
  }
});

test('TikTok refuses escaped output paths and skipped large files', async () => {
  for (const [stdout, code] of [['/outside/source.mp4', 'DOWNLOAD_FAILED'], ['', 'TOO_LARGE']]) {
    const provider = new TiktokProvider(config, async (_cmd, args) => args.includes('--dump-single-json')
      ? { stdout: JSON.stringify(metadata) } : { stdout });
    await assert.rejects(provider.download({ url: videoUrl, kind: 'audio', directory: path.resolve('work') }), { code });
  }
});

test('TikTok maps server restrictions without exposing diagnostics', async () => {
  const provider = new TiktokProvider(config, async () => {
    const error = new AppError('PROCESS_FAILED');
    error.diagnostic = 'Unexpected response from webpage request; private diagnostic';
    throw error;
  });
  await assert.rejects(provider.download({ url: videoUrl, kind: 'audio', directory: 'work' }), (error) => {
    assert.equal(error.code, 'TIKTOK_UNAVAILABLE');
    assert.equal(error.diagnostic, undefined);
    return true;
  });
});

test('TikTok cancellation reason is preserved', async () => {
  const provider = new TiktokProvider(config, async () => { throw new AppError('CANCELLED'); });
  await assert.rejects(provider.download({ url: videoUrl, kind: 'audio', directory: 'work' }), { code: 'CANCELLED' });
});
