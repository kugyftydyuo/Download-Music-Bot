export function subscriptionKeyboard(channels) {
  return { inline_keyboard: [
    ...channels.map((channel) => [{ text: channel.title, url: channel.url }]),
    [{ text: '✅ Проверить подписку', callback_data: 'subscription:check' }],
  ] };
}
export const modeKeyboard = {
  inline_keyboard: [[
    { text: '🎬 Видео MP4', callback_data: 'mode:video' },
    { text: '🎵 Аудио MP3', callback_data: 'mode:audio' },
  ]],
};
