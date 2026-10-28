import { AppError } from '../../core/errors.js';

function estimatedBytes(format, duration) {
  const size = Number(format.filesize || format.filesize_approx);
  if (size > 0 && Number.isFinite(size)) return size;
  const rate = Number(format.tbr);
  return rate > 0 && Number.isFinite(rate) ? rate * 1000 / 8 * duration : undefined;
}

/** Выбираем H.264/AAC, снижая разрешение, если известная оценка не помещается. */
export function selectVideoFormat(formats, { duration, maxUploadBytes, maxVideoHeight }) {
  const validId = (f) => /^[\w.-]+$/.test(String(f.format_id));

  const compatible = formats.filter((f) => validId(f) && f.ext === 'mp4' && /^avc1/.test(f.vcodec ?? '') &&
    Number(f.height) > 0 && f.height <= maxVideoHeight && f.has_drm !== true);

  const audios = formats.filter((f) => validId(f) && f.ext === 'm4a' && /^mp4a/.test(f.acodec ?? '') && f.has_drm !== true)
    .sort((a, b) => (Number(b.abr || b.tbr) || 0) - (Number(a.abr || a.tbr) || 0));

  const candidates = [];

  for (const video of compatible) {
    const vSize = estimatedBytes(video, duration);

    if (/^mp4a/.test(video.acodec ?? '')) {
      candidates.push({ id: String(video.format_id), height: video.height, rate: video.tbr || 0, size: vSize });
    } else if (!video.acodec || video.acodec === 'none') {
      for (const audio of audios) {
        const aSize = estimatedBytes(audio, duration);

        candidates.push({
          id: `${video.format_id}+${audio.format_id}`, height: video.height,
          rate: (Number(video.tbr) || 0) + (Number(audio.abr || audio.tbr) || 0),
          size: vSize && aSize ? vSize + aSize : undefined,
        });
      }
    }
  }

  candidates.sort((a, b) => b.height - a.height || b.rate - a.rate);
  const fitting = candidates.find((f) => f.size && f.size <= maxUploadBytes * 0.90);

  if (fitting) return fitting.id;
  // Оценки нет: пробуем умеренное разрешение. Реальные байты проверяются отдельно.
  const unknown = candidates.filter((f) => !f.size);
  const fallback = unknown.find((f) => f.height <= 480) ?? unknown.at(-1);

  if (fallback) return fallback.id;
  throw new AppError(candidates.length ? 'TOO_LARGE' : 'FORMAT_UNAVAILABLE');
}
