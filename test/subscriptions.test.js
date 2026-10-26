import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ChannelStore } from '../src/services/channels.js';
import { SubscriptionService, isSubscribed, verifyBotChannels } from '../src/services/subscriptions.js';

const channel = { id: '@example_channel', title: 'Канал', url: 'https://t.me/example_channel' };

test('membership statuses include restricted only when is_member=true', () => {
  for (const status of ['creator', 'administrator', 'member']) assert.equal(isSubscribed({ status }), true);
  for (const status of ['left', 'kicked']) assert.equal(isSubscribed({ status }), false);
  assert.equal(isSubscribed({ status: 'restricted', is_member: true }), true);
  assert.equal(isSubscribed({ status: 'restricted', is_member: false }), false);
});

test('fresh checks bypass positive cache; API failure denies access', async () => {
  let status = 'member';
  let calls = 0;
  const channels = { snapshot: { revision: 1, channels: [channel] } };
  const telegram = { async getChatMember() { calls += 1; if (status === 'error') throw new Error('network'); return { status }; } };
  const service = new SubscriptionService({ telegram, channels, cacheMs: 60000 });
  await service.assertAccess(1);
  await service.assertAccess(1);
  assert.equal(calls, 1);
  status = 'left';
  await assert.rejects(service.assertAccess(1, { fresh: true }), { code: 'UNSUBSCRIBED' });
  status = 'error';
  await assert.rejects(service.assertAccess(1), { code: 'SUBSCRIPTION_UNAVAILABLE' });
  status = 'member';
  await service.assertAccess(1);
  channels.snapshot = { revision: 2, channels: [channel] };
  await service.assertAccess(1);
  assert.equal(calls, 5);
});

test('all channels are required and a list change during verification denies access', async () => {
  const channels = { snapshot: { revision: 1, channels: [channel, { ...channel, id: '@another_channel' }] } };
  const telegram = { async getChatMember(id) { return { status: id === channel.id ? 'member' : 'left' }; } };
  const service = new SubscriptionService({ telegram, channels, cacheMs: 0 });
  await assert.rejects(service.assertAccess(1), { code: 'UNSUBSCRIBED' });
  telegram.getChatMember = async () => {
    channels.snapshot = { ...channels.snapshot, revision: channels.snapshot.revision + 1 };
    return { status: 'member' };
  };
  await assert.rejects(service.assertAccess(1), { code: 'SUBSCRIPTION_UNAVAILABLE' });
});

test('channel reload is atomic and retains old configuration on invalid JSON or permissions', async (t) => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(path.resolve('work', 'channels-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'channels.json');
  let allowed = true;
  const store = new ChannelStore({ file, verify: async () => { if (!allowed) throw new Error('not admin'); } });
  await writeFile(file, JSON.stringify([channel]));
  await store.reload();
  assert.equal(store.snapshot.revision, 1);
  await writeFile(file, '{');
  await assert.rejects(store.reload());
  assert.equal(store.snapshot.channels.length, 1);
  await writeFile(file, '[]');
  allowed = false;
  await assert.rejects(store.reload());
  assert.equal(store.snapshot.revision, 1);
  allowed = true;
  await store.reload();
  assert.equal(store.snapshot.revision, 2);
  assert.equal(store.snapshot.channels.length, 0);
});

test('startup refuses channels where bot is not an administrator', async () => {
  const telegram = {
    async getChat() { return { type: 'channel' }; },
    async getChatMember() { return { status: 'member' }; },
  };
  await assert.rejects(verifyBotChannels(telegram, 123, [channel]));
  telegram.getChatMember = async () => ({ status: 'administrator' });
  await verifyBotChannels(telegram, 123, [channel]);
});
