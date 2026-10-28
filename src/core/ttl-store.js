/** Ограниченный по памяти TTL-кеш. Чтение не продлевает срок записи. */
export class TtlStore {
  #items = new Map();

  constructor({ ttlMs, maxSize = 10000, now = Date.now }) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.now = now;
  }

  get(key) {
    const item = this.#items.get(key);
    if (!item) return undefined;

    if (item.expires <= this.now()) {
      this.#items.delete(key);
      return undefined;
    }

    return item.value;
  }

  set(key, value) {
    this.#items.delete(key);
    if (this.#items.size >= this.maxSize) this.#items.delete(this.#items.keys().next().value);

    this.#items.set(key, { value, expires: this.now() + this.ttlMs });
  }
  delete(key) { this.#items.delete(key); }
}
