import { AppError } from './errors.js';

/** Слот занят до отправки результата и удаления временных файлов. */
export class JobQueue {
  #waiting = [];
  #jobs = new Map();
  #active = 0;
  #closed = false;

  constructor({ concurrency, maxQueueSize }) {
    this.concurrency = concurrency;
    this.maxQueueSize = maxQueueSize;
  }

  get stats() { return { active: this.#active, waiting: this.#waiting.length }; }
  has(key) { return this.#jobs.has(key); }

  enqueue(key, task) {
    if (this.#closed) throw new AppError('CLOSED');
    if (this.#jobs.has(key)) throw new AppError('ALREADY_QUEUED');
    if (this.#jobs.size >= this.concurrency + this.maxQueueSize) throw new AppError('QUEUE_FULL');

    let resolve;
    const completion = new Promise((done) => { resolve = done; });
    const job = { key, task, resolve, controller: new AbortController(), running: false };

    this.#jobs.set(key, job);
    this.#waiting.push(job);

    const position = Math.max(0, this.#jobs.size - this.concurrency);
    queueMicrotask(() => this.#pump());
    // completion всегда разрешается, даже при отмене: нет unhandled rejection.
    return { position, completion };
  }

  cancel(key, reason = new AppError('CANCELLED')) {
    const job = this.#jobs.get(key);
    if (!job) return false;

    job.controller.abort(reason);

    if (!job.running) {
      this.#waiting = this.#waiting.filter((item) => item !== job);
      this.#jobs.delete(key);
      job.resolve({ status: 'cancelled' });
    }

    return true;
  }

  async close() {
    this.#closed = true;
    const running = [];

    for (const job of this.#jobs.values()) {
      if (job.running) running.push(new Promise((done) => {
        const previous = job.resolve;
        job.resolve = (result) => { previous(result); done(); };
      }));

      this.cancel(job.key);
    }
    await Promise.all(running);
  }
  #pump() {
    while (!this.#closed && this.#active < this.concurrency && this.#waiting.length) {
      const job = this.#waiting.shift();
      job.running = true;
      this.#active += 1;
      void this.#run(job);
    }
  }

  async #run(job) {
    let result;

    try {
      await job.task(job.controller.signal);
      result = { status: job.controller.signal.aborted ? 'cancelled' : 'completed' };
    } catch (error) {
      result = { status: job.controller.signal.aborted ? 'cancelled' : 'failed', error };
    } finally {
      this.#active -= 1;
      this.#jobs.delete(job.key);
      job.resolve(result);
      this.#pump();
    }
  }
}
