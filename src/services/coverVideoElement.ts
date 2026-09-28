/**
 * Подача кадров видео-заставки для realtime-путей (превью и realtime-экспорт):
 * скрытый muted <video>-элемент, зацикленный на окне показа.
 * Для offline-экспорта кадры декодируются отдельно (см. coverVideoDecoder).
 */
import { getCoverVideoBlob } from './coverVideoStorage';
import { getCoverWindows, coverClipTime, isCoverActive, type CoverWindows } from '../../shared/coverVideo';

export interface LoadedCoverVideo {
  el: HTMLVideoElement;
  url: string;
  duration: number;
  name: string;
}

/** Грузит клип из IndexedDB в <video>-элемент. Null — нет клипа или битый файл. */
export async function loadCoverVideoElement(): Promise<LoadedCoverVideo | null> {
  const record = await getCoverVideoBlob();
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  const el = document.createElement('video');
  el.muted = true;
  el.preload = 'auto';
  el.loop = true;
  el.src = url;
  await new Promise<void>((resolve) => {
    el.onloadedmetadata = () => resolve();
    el.onerror = () => resolve();
  });
  const duration = Number.isFinite(el.duration) ? el.duration : 0;
  if (!(duration > 0)) {
    URL.revokeObjectURL(url);
    return null;
  }
  return { el, url, duration, name: record.name };
}

/** Освобождает элемент и его object-URL. */
export function releaseCoverVideoElement(loaded: LoadedCoverVideo | null): void {
  if (!loaded) return;
  try {
    loaded.el.pause();
  } catch {
    // ignore
  }
  loaded.el.removeAttribute('src');
  try {
    URL.revokeObjectURL(loaded.url);
  } catch {
    // ignore
  }
}

function seekCover(el: HTMLVideoElement, t: number): void {
  try {
    const fast = (el as HTMLVideoElement & { fastSeek?: (t: number) => void }).fastSeek;
    if (typeof fast === 'function') fast.call(el, t);
    else el.currentTime = t;
  } catch {
    // ignore — покажем текущий кадр
  }
}

function ensurePaused(el: HTMLVideoElement): void {
  if (!el.paused) {
    try {
      el.pause();
    } catch {
      // ignore
    }
  }
}

function ensurePlaying(el: HTMLVideoElement): void {
  if (el.paused) {
    void el.play().catch(() => {});
  }
}

/**
 * Кадр клипа для момента t или null (вне окна / элемент не готов).
 * Сам управляет play/pause/seek элемента. За prerollSec до окна начинает
 * греть элемент, чтобы первый кадр заставки был готов ровно к границе.
 * На паузе аудио (mediaPaused) видео не играет, а заморожено на нужном
 * кадре — иначе убегающее время даёт seek по кругу и мигание.
 */
export function coverFrameForTime(
  el: HTMLVideoElement,
  clipDuration: number,
  windows: CoverWindows,
  t: number,
  endOfMedia: number,
  prerollSec = 0.5,
  mediaPaused = false,
): HTMLVideoElement | null {
  if (!(clipDuration > 0) || !isCoverActive(windows, t, endOfMedia)) {
    let warming = false;
    if (prerollSec > 0 && clipDuration > 0 && !mediaPaused) {
      const starts: number[] = [];
      if (windows.intro) starts.push(windows.intro.start);
      if (windows.outroStart !== null) starts.push(windows.outroStart);
      for (const s of starts) {
        if (t >= s - prerollSec && t < s) {
          warming = true;
          if (Math.abs(el.currentTime) > 0.3) {
            seekCover(el, 0);
          }
          ensurePlaying(el);
          break;
        }
      }
    }
    if (!warming) {
      ensurePaused(el);
    }
    return null;
  }
  const winStart = windows.intro && t >= windows.intro.start && t < windows.intro.end
    ? windows.intro.start
    : (windows.outroStart ?? 0);
  const ct = coverClipTime(t, winStart, clipDuration);
  if (mediaPaused) {
    // Замороженный кадр: один точный seek, без игры и дрейфа.
    ensurePaused(el);
    if (Math.abs(el.currentTime - ct) > 0.04) {
      seekCover(el, ct);
    }
  } else {
    if (Math.abs(el.currentTime - ct) > 0.3) {
      seekCover(el, ct);
    }
    ensurePlaying(el);
  }
  return el.readyState >= 2 ? el : null;
}
