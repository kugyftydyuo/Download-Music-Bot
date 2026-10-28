import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JobQueue } from '../src/core/job-queue.js';
import { ApiScheduler } from '../src/infrastructure/api-scheduler.js';

test('burst of 100 users stays within concurrency and queue limits', async () => {
  const queue = new JobQueue({ concurrency: 3, maxQueueSize: 12 });
  let active = 0;
  let peak = 0;
  let rejected = 0;
  const tickets = [];
  for (let id = 0; id < 100; id += 1) {
    try {
      tickets.push(queue.enqueue(id, async () => {
        active += 1; peak = Math.max(peak, active);
        await delay(5);
        active -= 1;
      }));
    } catch (error) { assert.equal(error.code, 'QUEUE_FULL'); rejected += 1; }
  }
  assert.equal(tickets.length, 15);
  assert.equal(rejected, 85);
  const results = await Promise.all(tickets.map((ticket) => ticket.completion));
  assert(results.every((result) => result.status === 'completed'));
  assert.equal(peak, 3);
  assert.deepEqual(queue.stats, { active: 0, waiting: 0 });
});

test('duplicates are refused, waiting cancellation releases capacity', async () => {
  const queue = new JobQueue({ concurrency: 1, maxQueueSize: 1 });
  let release;
  const first = queue.enqueue(1, () => new Promise((done) => { release = done; }));
  assert.throws(() => queue.enqueue(1, async () => {}), { code: 'ALREADY_QUEUED' });
  const second = queue.enqueue(2, async () => assert.fail('Cancelled job ran'));
  assert.equal(queue.cancel(2), true);
  assert.equal((await second.completion).status, 'cancelled');
  const third = queue.enqueue(3, async () => {});
  await Promise.resolve();
  release();
  await Promise.all([first.completion, third.completion]);
  assert.equal(queue.has(1), false);
});

test('failures free the slot; close cancels running and pending jobs', async () => {
  const queue = new JobQueue({ concurrency: 1, maxQueueSize: 3 });
  const failed = queue.enqueue(1, async () => { throw new Error('expected'); });
  assert.equal((await failed.completion).status, 'failed');
  const running = queue.enqueue(2, (signal) => new Promise((done) => signal.addEventListener('abort', done, { once: true })));
  const pending = queue.enqueue(3, async () => assert.fail('Closed queue started a job'));
  await Promise.resolve();
  await queue.close();
  assert.equal((await running.completion).status, 'cancelled');
  assert.equal((await pending.completion).status, 'cancelled');
  assert.throws(() => queue.enqueue(4, async () => {}), { code: 'CLOSED' });
});

test('Telegram scheduler bounds pending calls and respects per-chat spacing', async () => {
  const scheduler = new ApiScheduler({ intervalMs: 2, chatIntervalMs: 35, concurrency: 2, maxPending: 2 });
  const calls = [];
  const a = scheduler.schedule(() => { calls.push(Date.now()); }, { chatId: 1 });
  const b = scheduler.schedule(() => { calls.push(Date.now()); }, { chatId: 1 });
  const c = scheduler.schedule(() => {}, { chatId: 2 });
  await assert.rejects(scheduler.schedule(() => {}), { code: 'TELEGRAM_BUSY' });
  await Promise.all([a, b, c]);
  assert(calls[1] - calls[0] >= 25);
  await scheduler.close();
});

test('cancelled scheduled calls never execute', async () => {
  const scheduler = new ApiScheduler({ intervalMs: 2, chatIntervalMs: 500 });
  await scheduler.schedule(() => {}, { chatId: 1 });
  const controller = new AbortController();
  const pending = scheduler.schedule(() => assert.fail('Cancelled API operation ran'), { chatId: 1, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  await scheduler.close();
});
