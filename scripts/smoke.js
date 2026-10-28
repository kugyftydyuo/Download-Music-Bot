import dotenv from 'dotenv';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/index.js';
import { runProcess } from '../src/infrastructure/process-runner.js';
import { MediaConverter } from '../src/services/media-converter.js';
import { errorCode } from '../src/infrastructure/logger.js';

// Проверка реального FFmpeg на синтетическом ролике: без токена и без YouTube.
dotenv.config({ quiet: true });
await mkdir('work', { recursive: true });
const directory = await mkdtemp(path.resolve('work', 'smoke-'));

try {
  const config = loadConfig(process.env, { requireToken: false });
  const sourcePath = path.join(directory, 'source.mp4');

  await runProcess(config.ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath,
  ], { timeoutMs: 15000 });

  const converter = new MediaConverter(config);
  for (const kind of ['video', 'audio']) {
    const media = await converter.convert({ path: sourcePath, title: 'Smoke test', duration: 1 }, kind, directory);
    assert(media.size > 0 && media.duration >= 0.9 && media.duration < 2);

    console.log(`${kind}: OK (${media.size} байт)`);
  }
} catch (error) {
  console.error(`Проверка FFmpeg не пройдена. Код: ${errorCode(error)}`);
  process.exitCode = 1;
} finally { await rm(directory, { recursive: true, force: true }); }
