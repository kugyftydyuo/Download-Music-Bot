import { TtlStore } from '../core/ttl-store.js';

/** Блокируем параллельные события одного пользователя и ограничиваем входящий поток. */
export class UpdateGuard {
  #running = new Map();
  #closed = false;
  constructor({ maxConcurrent = 32, maxPerWindow = 8, windowMs = 10000 } = {}) {
    Object.assign(this, { maxConcurrent, maxPerWindow, windowMs });
    this.rate = new TtlStore({ ttlMs: windowMs });
  }
  run(key, task, onError) {
    if (this.#closed || this.#running.has(key) || this.#running.size >= this.maxConcurrent) return false;
    const bucket = this.rate.get(key) ?? { count: 0, until: Date.now() + this.windowMs };
    if (bucket.until <= Date.now()) { bucket.count = 0; bucket.until = Date.now() + this.windowMs; }
    if (bucket.count >= this.maxPerWindow) return false;
    bucket.count += 1;
    this.rate.set(key, bucket);
    const promise = Promise.resolve().then(task).catch(onError).finally(() => this.#running.delete(key));
    this.#running.set(key, promise);
    return true;
  }
  async idle() { await Promise.allSettled(this.#running.values()); }
  async close() { this.#closed = true; await this.idle(); }
}
