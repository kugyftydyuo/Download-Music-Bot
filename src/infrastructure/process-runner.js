import { spawn } from 'node:child_process';
import { AppError, abortError, throwIfAborted } from '../core/errors.js';

/** shell:false + массив аргументов: ссылка не может стать командой оболочки. */
export function runProcess(command, args, { signal, timeoutMs = 180000, maxOutputBytes = 4_000_000 } = {}) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stdoutBytes = 0;
    let stderr = '';
    let failure;
    let forceTimer;
    let termination = Promise.resolve();
    let finishTermination;
    const groupExists = () => {
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { return error.code !== 'ESRCH'; }
    };
    const stop = (error) => {
      if (failure) return;
      failure = error;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        // Убиваем дерево, включая FFmpeg, запущенный yt-dlp.
        termination = new Promise((done) => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => { child.kill(); done(); });
          killer.on('close', done);
        });
      } else {
        const killGroup = (sig) => { try { process.kill(-child.pid, sig); } catch { /* Уже завершён. */ } };
        killGroup('SIGTERM');
        termination = new Promise((done) => {
          finishTermination = done;
          forceTimer = setTimeout(() => { killGroup('SIGKILL'); done(); }, 2000);
        });
      }
    };
    const onAbort = () => stop(abortError(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => stop(new AppError('TIMEOUT')), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > maxOutputBytes) stop(new AppError('PROCESS_FAILED', 'Process output limit'));
      else stdout += chunk;
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-64000); });
    child.on('error', (error) => {
      failure ??= new AppError(error.code === 'ENOENT' ? 'PROCESS_MISSING' : 'PROCESS_FAILED');
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // Родитель мог завершиться раньше FFmpeg. Ждём остановку всей группы,
      // чтобы не удалить папку, в которую ещё пишет оставшийся потомок.
      if (forceTimer && !groupExists()) {
        clearTimeout(forceTimer);
        finishTermination();
      }
      await termination;
      if (failure) return reject(failure);
      if (code !== 0) {
        const error = new AppError('PROCESS_FAILED');
        // Только для внутренней классификации. Не писать это поле в журнал.
        error.diagnostic = stderr;
        return reject(error);
      }
      resolve({ stdout, stderr });
    });
  });
}
