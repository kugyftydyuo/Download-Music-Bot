import { AppError, abortError, throwIfAborted } from '../core/errors.js';

/** Ограничиваем частоту вызовов и число ожидающих запросов Telegram. */
export class ApiScheduler {
  #queue = [];
  #active = new Set();
  #nextStart = 0;
  #chats = new Map();
  #timer;
  #closed = false;
  constructor({ intervalMs = 55, chatIntervalMs = 1100, concurrency = 8, maxPending = 400 } = {}) {
    Object.assign(this, { intervalMs, chatIntervalMs, concurrency, maxPending });
  }
  schedule(task, { chatId, signal } = {}) {
    throwIfAborted(signal);
    if (this.#closed) return Promise.reject(new AppError('CLOSED'));
    if (this.#queue.length >= this.maxPending) return Promise.reject(new AppError('TELEGRAM_BUSY'));
    return new Promise((resolve, reject) => {
      const item = { task, chatId, signal, resolve, reject };
      item.onAbort = () => {
        this.#queue = this.#queue.filter((entry) => entry !== item);
        reject(abortError(signal));
        this.#pump();
      };
      signal?.addEventListener('abort', item.onAbort, { once: true });
      this.#queue.push(item);
      this.#pump();
    });
  }
  async close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    for (const item of this.#queue.splice(0)) {
      item.signal?.removeEventListener('abort', item.onAbort);
      item.reject(new AppError('CLOSED'));
    }
    await Promise.allSettled(this.#active);
  }
  #pump() {
    clearTimeout(this.#timer);
    if (this.#closed || !this.#queue.length || this.#active.size >= this.concurrency) return;
    const now = Date.now();
    // Истёкшие записи удаляем: количество пользователей не раздувает Map бесконечно.
    for (const [id, due] of this.#chats) if (due <= now) this.#chats.delete(id);
    let soonest = Infinity;
    let index = -1;
    for (let i = 0; i < this.#queue.length; i += 1) {
      const due = Math.max(this.#nextStart, this.#chats.get(this.#queue[i].chatId) ?? 0);
      soonest = Math.min(soonest, due);
      if (due <= now) { index = i; break; }
    }
    if (index < 0) {
      this.#timer = setTimeout(() => this.#pump(), Math.max(1, soonest - now));
      return;
    }
    const item = this.#queue.splice(index, 1)[0];
    item.signal?.removeEventListener('abort', item.onAbort);
    this.#nextStart = now + this.intervalMs;
    if (item.chatId !== undefined) this.#chats.set(item.chatId, now + this.chatIntervalMs);
    const promise = Promise.resolve().then(() => {
      throwIfAborted(item.signal);
      return item.task();
    }).then(item.resolve, item.reject).finally(() => {
      this.#active.delete(promise);
      this.#pump();
    });
    this.#active.add(promise);
    this.#pump();
  }
}
