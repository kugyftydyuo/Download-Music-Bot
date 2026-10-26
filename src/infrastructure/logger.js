// Не логируем токены, ссылки, тексты сообщений, полные Error или stderr процессов.
// В ошибках Telegram URL запроса может содержать токен.
function write(level, event, fields = {}) {
  const record = { time: new Date().toISOString(), level, event, ...fields };
  (level === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(record)}\n`);
}
export const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
export function errorCode(error) {
  return String(error?.errorCode ?? error?.response?.body?.error_code ?? error?.code ?? error?.name ?? 'UNKNOWN').slice(0, 80);
}
