import {emojis} from "../../config/emojis.js";

export function subscriptionKeyboard(channels) {
  return { inline_keyboard: [
    ...channels.map((channel) => [{ text: channel.title, url: channel.url }]),
    [{ text: 'Проверить', icon_custom_emoji_id: emojis.check, callback_data: 'subscription:check' }],
  ] };
}

export const modeKeyboard = {
  inline_keyboard: [[
    { text: 'Видео MP4', icon_custom_emoji_id: emojis.video, callback_data: 'mode:video' },
    { text: 'Аудио MP3', icon_custom_emoji_id: emojis.audio, callback_data: 'mode:audio' },
  ]],
};

export const downloadAgainKeyboard = {
  inline_keyboard: [
    [{text: 'Скачать еще раз', icon_custom_emoji_id: emojis.download2, callback_data: 'download_again'}]
  ]
}
