import { runProcess } from './process-runner.js';

export async function checkDependencies(config, run = runProcess) {
  const checks = [
    ['yt-dlp', config.ytDlpPath, ['--version']],
    ['FFmpeg', config.ffmpegPath, ['-version']],
    ['ffprobe', config.ffprobePath, ['-version']],
  ];
  return Promise.all(checks.map(async ([name, command, args]) => {
    try {
      const result = await run(command, args, { timeoutMs: 10000 });
      return { name, ok: true, version: result.stdout.split(/\r?\n/, 1)[0] };
    } catch (error) { return { name, ok: false, code: error.code }; }
  }));
}
