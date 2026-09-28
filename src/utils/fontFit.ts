/**
 * Автоподбор кегля под самую длинную строку песни.
 *
 * Идея: замеряем ширину каждой строки при эталонном кегле 100px ровно так,
 * как её рисует canvas (слова + натуральные пробелы, без letter-spacing),
 * находим максимальную и считаем кегль (в px на эталонном кадре 1920x1080),
 * при котором эта строка занимает AUTO_FIT_MAX_WIDTH_FRACTION ширины экрана.
 * Остальные строки рисуются тем же кеглем (они короче — просто займут меньше места).
 */

export const AUTO_FIT_REFERENCE_WIDTH = 1920;
export const AUTO_FIT_MAX_WIDTH_FRACTION = 0.92; // небольшие поля слева/справа, не впритык
export const AUTO_FIT_MIN_PX = 16;
export const AUTO_FIT_MAX_PX = 80;

/** Единый стек шрифтов для замера, DOM-слотов и canvas-рендера. */
export const SLOT_FONT_FAMILY =
  'Inter, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

function measureFont(fontStack: string, fontWeight: number): string {
  return `${fontWeight} 100px ${fontStack}`;
}

let sharedMeasureCtx: CanvasRenderingContext2D | null | undefined;
let sharedMeasureFont = '';

/**
 * Ширина текста в px при кегле 100px тем же начертанием, что на экране.
 * Работает только в браузере; вне DOM возвращает 0.
 */
export function measureTextWidth100px(
  text: string,
  fontStack: string = SLOT_FONT_FAMILY,
  fontWeight: number = 800,
): number {
  if (typeof document === 'undefined') return 0;
  if (sharedMeasureCtx === undefined) {
    try {
      sharedMeasureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      sharedMeasureCtx = null;
    }
  }
  if (!sharedMeasureCtx) return 0;
  const font = measureFont(fontStack, fontWeight);
  if (sharedMeasureFont !== font) {
    sharedMeasureCtx.font = font;
    sharedMeasureFont = font;
  }
  return sharedMeasureCtx.measureText(text).width;
}

/**
 * Кегль (px на эталоне 1080p), при котором самая длинная строка занимает
 * заданную долю ширины экрана. `measure` — ширина фрагмента при кегле 100px
 * тем же начертанием, что на экране. Суммируем слова и натуральные пробелы
 * ровно так, как их складывает canvas-рендер (пословно + spaceWidth).
 * Возвращает null, если строк нет или замерить не удалось.
 */
export function computeAutoFitFontPx(
  lines: { text: string }[],
  measure: (text: string) => number = measureTextWidth100px,
): number | null {
  const spaceWidth = measure(' ');
  let maxRatio = 0;
  for (const line of lines) {
    const text = line.text?.trim();
    if (!text) continue;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let w = 0;
    for (const word of words) {
      w += measure(word);
    }
    w += spaceWidth * (words.length - 1);
    if (w <= 0) continue;
    maxRatio = Math.max(maxRatio, w / 100);
  }
  if (maxRatio <= 0) return null;
  const px = (AUTO_FIT_REFERENCE_WIDTH * AUTO_FIT_MAX_WIDTH_FRACTION) / maxRatio;
  return Math.round(Math.min(AUTO_FIT_MAX_PX, Math.max(AUTO_FIT_MIN_PX, px)));
}

/**
 * Перевод px на эталоне 1080p в cqw для 16:9 превью:
 * отрисованный px = px1080 * H/1080, H = 9W/16  =>  cqw = px1080 / 19.2.
 */
export function fontPx1080ToCqw(px1080: number): number {
  return px1080 / 19.2;
}
