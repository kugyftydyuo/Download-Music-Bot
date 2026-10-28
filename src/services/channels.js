import { readFile } from 'node:fs/promises';

export function validateChannels(input) {
  if (!Array.isArray(input) || input.length > 10) throw new Error('Нужен массив из 0–10 каналов');

  const channels = input.map((channel) => {
    const id = String(channel?.id ?? '');

    if (!/^@[A-Za-z][\w]{4,31}$/.test(id) && !/^-100\d{5,}$/.test(id)) {
      throw new Error('id канала должен быть @username или -100...');
    }

    let url;
    try { url = new URL(channel.url); } catch { throw new Error('Неверная ссылка канала'); }

    if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.port || url.username || url.password) {
      throw new Error('Ссылка канала должна начинаться с https://t.me/');
    }

    return Object.freeze({ id, title: String(channel.title || id).slice(0, 60), url: url.href });
  });

  if (new Set(channels.map((c) => c.id.toLowerCase())).size !== channels.length) {
    throw new Error('Каналы не должны повторяться');
  }

  return Object.freeze(channels);
}

/** Сначала проверяем весь новый список, затем одним присваиванием заменяем старый. */
export class ChannelStore {
  #snapshot = Object.freeze({ revision: 0, channels: [] });
  #reloading;

  constructor({ file, verify }) { this.file = file; this.verify = verify; }

  get snapshot() { return this.#snapshot; }

  async reload() {
    if (this.#reloading) return this.#reloading;

    this.#reloading = this.#load();

    try { return await this.#reloading; } finally { this.#reloading = undefined; }
  }

  async #load() {
    const text = await readFile(this.file, 'utf8');

    if (Buffer.byteLength(text) > 64000) throw new Error('Слишком большой файл каналов');
    let input;
    try { input = JSON.parse(text); } catch { throw new Error('В файле каналов неверный JSON'); }

    const channels = validateChannels(input);
    await this.verify(channels);

    this.#snapshot = Object.freeze({ revision: this.#snapshot.revision + 1, channels });
    return this.#snapshot;
  }
}
