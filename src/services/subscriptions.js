import { AppError } from '../core/errors.js';
import { TtlStore } from '../core/ttl-store.js';

export function isSubscribed(member) {
  return ['creator', 'administrator', 'member'].includes(member.status) ||
    (member.status === 'restricted' && member.is_member === true);
}

export class SubscriptionService {
  #pending = new Map();

  constructor({ telegram, channels, cacheMs }) {
    this.telegram = telegram;
    this.channels = channels;
    this.cache = new TtlStore({ ttlMs: cacheMs });
  }

  async assertAccess(userId, { fresh = false } = {}) {
    const snapshot = this.channels.snapshot;
    const key = `${snapshot.revision}:${userId}`;

    if (!fresh && this.cache.get(key)) return;
    if (this.#pending.has(key)) return this.#pending.get(key);

    const check = this.#check(userId, snapshot, key);
    this.#pending.set(key, check);

    try { await check; } finally { this.#pending.delete(key); }
  }

  async #check(userId, snapshot, key) {
    try {
      const members = await Promise.all(snapshot.channels.map((channel) => this.telegram.getChatMember(channel.id, userId)));

      if (snapshot.revision !== this.channels.snapshot.revision) throw new AppError('SUBSCRIPTION_UNAVAILABLE');
      if (!members.every(isSubscribed)) throw new AppError('UNSUBSCRIBED');

      this.cache.set(key, true);
    } catch (error) {
      this.cache.delete(key);

      if (error instanceof AppError) throw error;
      // Сбой Telegram или отсутствие прав бота не считается отсутствием подписки.
      throw new AppError('SUBSCRIPTION_UNAVAILABLE');
    }
  }
}

export async function verifyBotChannels(telegram, botId, channels) {
  await Promise.all(channels.map(async (channel) => {
    const [chat, member] = await Promise.all([
      telegram.getChat(channel.id), telegram.getChatMember(channel.id, botId),
    ]);

    if (chat.type !== 'channel' || !['administrator', 'creator'].includes(member.status)) {
      throw new Error(`Добавьте бота администратором канала ${channel.id}`);
    }
  }));
}
