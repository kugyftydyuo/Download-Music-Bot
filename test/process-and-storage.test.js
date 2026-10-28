import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcess } from '../src/infrastructure/process-runner.js';
import { TempStorage } from '../src/infrastructure/temp-storage.js';

test('process runner passes shell metacharacters literally', async () => {
  const argument = '$(echo danger); & `whoami`';
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', argument]);
  assert.equal(result.stdout, argument);
});

test('process runner handles timeout, abort, missing executable and huge output', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { timeoutMs: 80 }), { code: 'TIMEOUT' });
  const controller = new AbortController();
  const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(running, { code: 'CANCELLED' });
  await assert.rejects(runProcess('nonexistent-executable-mediabot-test-xyz', []), { code: 'PROCESS_MISSING' });
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { maxOutputBytes: 20 }), { code: 'PROCESS_FAILED' });
});

test('disk watcher aborts an oversized job and folders can be cleaned', async (t) => {
  await mkdir('work', { recursive: true });
  const root = await mkdtemp(path.resolve('work', 'storage-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new TempStorage({ tempDir: root, maxJobDiskBytes: 10, minFreeDiskBytes: 1 });
  await storage.init();
  const dir = await storage.create();
  const controller = new AbortController();
  const stop = storage.watch(dir, controller);
  await writeFile(path.join(dir, 'large.bin'), Buffer.alloc(100));
  await Promise.race([
    new Promise((done) => controller.signal.addEventListener('abort', done, { once: true })),
    delay(2500).then(() => assert.fail('Disk watcher did not abort')),
  ]);
  assert.equal(controller.signal.reason.code, 'DISK_LIMIT');
  await stop();
  await storage.remove(dir);
  assert.deepEqual(await readdir(root), []);
});

test('Linux cancellation also kills a grandchild that ignores SIGTERM', { skip: process.platform !== 'linux' }, async (t) => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work', 'process-tree-test-'));
  const pidFile = path.join(dir, 'pid');
  let grandchildPid;
  t.after(async () => {
    if (grandchildPid) { try { process.kill(grandchildPid, 'SIGKILL'); } catch { /* Уже остановлен. */ } }
    await rm(dir, { recursive: true, force: true });
  });
  const grandchild = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
  const controller = new AbortController();
  const running = runProcess(process.execPath, ['-e', parent], { signal: controller.signal, timeoutMs: 10000 });
  const outcome = assert.rejects(running, { code: 'CANCELLED' });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { grandchildPid = Number(await readFile(pidFile, 'utf8')); break; }
    catch { await delay(20); }
  }
  assert(grandchildPid, 'Grandchild did not start');
  controller.abort();
  await outcome;
  let state;
  try { state = (await readFile(`/proc/${grandchildPid}/stat`, 'utf8')).split(' ')[2]; }
  catch (error) { assert.equal(error.code, 'ENOENT'); }
  assert(state === undefined || state === 'Z', 'A descendant kept running after cancellation');
});
