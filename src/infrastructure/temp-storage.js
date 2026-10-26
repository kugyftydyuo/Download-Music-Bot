import { mkdir, readdir, stat, statfs, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../core/errors.js';

async function directoryBytes(directory) {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    try {
      if (entry.isDirectory()) size += await directoryBytes(file);
      else if (entry.isFile()) size += (await stat(file)).size;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return size;
}

export class TempStorage {
  constructor(config) { this.config = config; }
  async init() {
    await mkdir(this.config.tempDir, { recursive: true, mode: 0o700 });
    // Очищаем остатки аварийных завершений. TEMP_DIR должен принадлежать только боту.
    for (const entry of await readdir(this.config.tempDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^job-[A-Za-z0-9]+$/.test(entry.name)) continue;
      const file = path.join(this.config.tempDir, entry.name);
      if (Date.now() - (await stat(file)).mtimeMs > 24 * 3600_000) {
        await rm(file, { recursive: true, force: true });
      }
    }
  }
  async assertFree({ reserveJob = false } = {}) {
    const disk = await statfs(this.config.tempDir);
    const required = this.config.minFreeDiskBytes + (reserveJob ? this.config.maxJobDiskBytes : 0);
    if (disk.bavail * disk.bsize < required) throw new AppError('LOW_DISK');
  }
  async create() {
    await this.assertFree({ reserveJob: true });
    return mkdtemp(path.join(this.config.tempDir, 'job-'));
  }
  async remove(directory) { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
  watch(directory, controller) {
    let checking = false;
    let stopped = false;
    let pending = Promise.resolve();
    const check = async () => {
      if (checking || stopped || controller.signal.aborted) return;
      checking = true;
      try {
        if (await directoryBytes(directory) > this.config.maxJobDiskBytes) throw new AppError('DISK_LIMIT');
        await this.assertFree();
      } catch (error) {
        if (!stopped) controller.abort(error instanceof AppError ? error : new AppError('LOW_DISK'));
      } finally { checking = false; }
    };
    const timer = setInterval(() => { if (!checking) pending = check(); }, 500);
    timer.unref();
    // Ждём последнюю проверку перед удалением папки: исключаем гонку с readdir.
    return async () => { stopped = true; clearInterval(timer); await pending; };
  }
}
