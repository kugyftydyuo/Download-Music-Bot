import path from 'node:path';

function number(env, name, fallback, min, max) {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name}: ожидается целое число от ${min} до ${max}`);
  }

  return value;
}

export function loadConfig(env = process.env, { requireToken = true } = {}) {
  const token = env.BOT_TOKEN?.trim() ?? '';

  if (requireToken && !/^\d+:[\w-]{20,}$/.test(token)) {
    throw new Error('Укажите действительный BOT_TOKEN в .env');
  }

  const adminIds = (env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (adminIds.some((id) => !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    throw new Error('ADMIN_USER_IDS: нужны числовые Telegram user ID через запятую');
  }

  const apiRoot = new URL(env.TELEGRAM_API_ROOT || 'https://api.telegram.org');
  if (!['http:', 'https:'].includes(apiRoot.protocol) || apiRoot.username || apiRoot.password ||
      apiRoot.search || apiRoot.hash || apiRoot.pathname !== '/') {
    throw new Error('TELEGRAM_API_ROOT: нужен HTTP(S)-адрес без пути и пароля');
  }

  const cloudApi = apiRoot.hostname === 'api.telegram.org';
  if (cloudApi && (apiRoot.protocol !== 'https:' || apiRoot.port)) {
    throw new Error('Для api.telegram.org используйте https://api.telegram.org');
  }

  const maxUploadBytes = number(env, 'MAX_UPLOAD_MB', 49, 1, cloudApi ? 49 : 1900) * 1_000_000;
  const maxJobDiskBytes = number(env, 'MAX_JOB_DISK_MB', 250, 10, 20000) * 1_000_000;
  if (maxJobDiskBytes < maxUploadBytes * 4) {
    throw new Error('MAX_JOB_DISK_MB должен быть не меньше MAX_UPLOAD_MB × 4');
  }

  return Object.freeze({
    token, adminIds: new Set(adminIds), apiRoot: apiRoot.origin,
    channelsFile: path.resolve(env.CHANNELS_FILE || './config/channels.json'),
    concurrency: number(env, 'DOWNLOAD_CONCURRENCY', 1, 1, 8),
    maxQueueSize: number(env, 'MAX_QUEUE_SIZE', 20, 0, 1000),
    userCooldownMs: number(env, 'USER_COOLDOWN_SECONDS', 15, 0, 3600) * 1000,
    maxDuration: number(env, 'MAX_DURATION_SECONDS', 1200, 10, 21600),
    maxVideoHeight: number(env, 'MAX_VIDEO_HEIGHT', 720, 144, 1080),
    maxUploadBytes, maxJobDiskBytes,
    minFreeDiskBytes: number(env, 'MIN_FREE_DISK_MB', 512, 10, 100000) * 1_000_000,
    jobTimeoutMs: number(env, 'JOB_TIMEOUT_SECONDS', 600, 10, 7200) * 1000,
    processTimeoutMs: number(env, 'PROCESS_TIMEOUT_SECONDS', 180, 5, 3600) * 1000,
    telegramTimeoutMs: number(env, 'TELEGRAM_TIMEOUT_SECONDS', 180, 40, 3600) * 1000,
    sessionTtlMs: number(env, 'SESSION_TTL_SECONDS', 86400, 60, 604800) * 1000,
    subscriptionCacheMs: number(env, 'SUBSCRIPTION_CACHE_SECONDS', 60, 0, 600) * 1000,
    tempDir: path.resolve(env.TEMP_DIR || './data/tmp'),
    ytDlpPath: env.YT_DLP_PATH || 'yt-dlp',
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH || 'ffprobe',
  });
}
