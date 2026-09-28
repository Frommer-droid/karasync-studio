import type { LineTiming } from './types';
import {
  getPresentationLineBounds,
  PRESENTATION_LEAD_IN_SECONDS,
  PRESENTATION_LAST_LINE_HOLD_SECONDS,
} from './syncAlgorithm';

export interface CoverWindow {
  start: number;
  end: number;
}

export interface CoverWindowsOptions {
  enabledIntro: boolean;
  enabledOutro: boolean;
}

export interface CoverWindows {
  /** Полное перекрытие кадра с начала до появления первой строки. Null — нет окна. */
  intro: CoverWindow | null;
  /** Старт перекрытия после исчезновения последней строки (конец — конец песни). Null — нет. */
  outroStart: number | null;
}

/**
 * Окна видео-заставки по строкам песни. Чистая функция.
 * Интро: [0, startПервойСтроки − leadIn]; нет, если первая строка раньше lead-in.
 * Аутро: от (endПоследнейСтроки + hold) до конца воспроизведения
 * (конец знает вызывающий код — длительность аудио/экспорта).
 */
export function getCoverWindows(
  lines: LineTiming[],
  options: CoverWindowsOptions,
): CoverWindows {
  const empty: CoverWindows = { intro: null, outroStart: null };
  if (!Array.isArray(lines) || lines.length === 0) {
    return empty;
  }

  let intro: CoverWindow | null = null;
  if (options.enabledIntro) {
    for (const line of lines) {
      const bounds = getPresentationLineBounds(line);
      if (!bounds) continue;
      const end = bounds.start - PRESENTATION_LEAD_IN_SECONDS;
      intro = end > 0 ? { start: 0, end } : null;
      break;
    }
  }

  let outroStart: number | null = null;
  if (options.enabledOutro) {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const bounds = getPresentationLineBounds(lines[i]);
      if (!bounds) continue;
      outroStart = bounds.end + PRESENTATION_LAST_LINE_HOLD_SECONDS;
      break;
    }
  }

  return { intro, outroStart };
}

/**
 * Время внутри клипа для момента t (зацикливание).
 * windowStart — начало окна (интро: 0, аутро: outroStart).
 */
export function coverClipTime(t: number, windowStart: number, clipDuration: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(windowStart) || !(clipDuration > 0)) {
    return 0;
  }
  const offset = t - windowStart;
  if (offset <= 0) return 0;
  return offset % clipDuration;
}

/** Активно ли перекрытие в момент t (конец песни endOfMedia ограничивает аутро). */
export function isCoverActive(
  windows: CoverWindows,
  t: number,
  endOfMedia: number,
): boolean {
  if (!Number.isFinite(t)) return false;
  const { intro, outroStart } = windows;
  if (intro && t >= intro.start && t < intro.end) return true;
  if (
    outroStart !== null &&
    t >= outroStart &&
    (!Number.isFinite(endOfMedia) || t <= endOfMedia)
  ) {
    return true;
  }
  return false;
}
