import type { BrandingPlacement } from './types';
import { DEFAULT_PLACEMENT } from './types';

/**
 * Геометрия фирменной шапки в долях кадра (масштабируется на любое 16:9).
 * placement: масштаб % и сдвиги в п.п. — из настроек «Позиции».
 * Чистая функция — покрыта тестами, используется canvas-рендерером и DOM-оверлеем.
 */

export interface BrandingLayout {
  logo: { cx: number; cy: number; r: number; ringWidth: number };
  author: { cx: number; cy: number; r: number };
  title: { x: number; baselineY: number; fontPx: number };
  sublines: { x: number; firstBaselineY: number; stepY: number; fontPx: number };
  qr: { x: number; y: number; size: number; pad: number };
  qrLabel: { cx: number; baselineY: number; fontPx: number; pillPadX: number; pillPadY: number };
}

function elementPlacement(
  placement: BrandingPlacement | undefined,
  key: 'logo' | 'author' | 'qr' | 'title' | 'songTitle',
): { scale: number; dx: number; dy: number } {
  const fallback = DEFAULT_PLACEMENT[key];
  const el = placement?.[key];
  const scale = Number.isFinite(el?.scale) ? Math.min(200, Math.max(50, el!.scale)) : fallback.scale;
  const dx = Number.isFinite(el?.dx) ? Math.min(20, Math.max(-20, el!.dx)) : fallback.dx;
  const dy = Number.isFinite(el?.dy) ? Math.min(20, Math.max(-20, el!.dy)) : fallback.dy;
  return { scale: scale / 100, dx: dx / 100, dy: dy / 100 };
}

export function computeBrandingLayout(  width: number,
  height: number,
  placement?: BrandingPlacement,
  lineSpacingPct: number = 100,
): BrandingLayout {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  // Эталонные кегли заданы для 1080p и масштабируются высотой кадра.
  const k = H / 1080;
  const logo = elementPlacement(placement, 'logo');
  const author = elementPlacement(placement, 'author');
  const qr = elementPlacement(placement, 'qr');
  const title = elementPlacement(placement, 'title');
  const song = elementPlacement(placement, 'songTitle');
  const spacing = Number.isFinite(lineSpacingPct)
    ? Math.min(200, Math.max(50, lineSpacingPct)) / 100
    : 1;
  return {
    logo: {
      cx: 0.095 * W + logo.dx * W,
      cy: 0.16 * H + logo.dy * H,
      r: 0.075 * W * logo.scale,
      ringWidth: Math.max(2, 3 * k),
    },
    author: {
      cx: 0.335 * W + author.dx * W,
      cy: 0.26 * H + author.dy * H,
      r: 0.062 * W * author.scale,
    },
    title: {
      x: 0.405 * W + song.dx * W,
      baselineY: 0.175 * H + song.dy * H,
      fontPx: 62 * k * song.scale,
    },
    sublines: {
      x: 0.405 * W + title.dx * W,
      firstBaselineY: 0.25 * H + title.dy * H,
      stepY: 0.073 * H * title.scale * spacing,
      fontPx: 47 * k * title.scale,
    },
    qr: {
      x: 0.815 * W + qr.dx * W,
      y: 0.06 * H + qr.dy * H,
      size: 0.16 * W * qr.scale,
      pad: 10 * k,
    },
    qrLabel: { cx: 0.895 * W, baselineY: 0.042 * H, fontPx: 34 * k, pillPadX: 18 * k, pillPadY: 10 * k },
  };
}

export interface TitleBlockTexts {
  title: string;
  sublines: string[];
  titleFontPx: number;
  subFontPx: number;
}

export interface CenteredTextRow {
  text: string;
  baselineY: number;
  fontPx: number;
}

/**
 * Центрирование «как было»: текущая раскладка (все ручные сдвиги и масштабы
 * уже запечены в layout) едет по горизонтали одним контейнером так, чтобы
 * bounding box «фото + название + строки» встал по центру экрана.
 * Взаимные смещения элементов не меняются: ничего не прилипает друг к другу,
 * вертикали не трогаем вообще. Чистая, тестируется.
 */
export function composeCenteredTitleBlock(
  layout: BrandingLayout,
  containerWidth: number,
  title: { text: string; fontPx: number },
  subs: { text: string; fontPx: number }[],
  measure: (text: string, fontPx: number, weight: number) => number,
): { authorCx: number; authorCy: number; titleX: number; sublinesX: number } {
  const W = Math.max(1, containerWidth);
  const titleW = title.text.trim() ? measure(title.text, title.fontPx, 700) : 0;
  let subsW = 0;
  for (const sub of subs) {
    if (sub.text.trim()) subsW = Math.max(subsW, measure(sub.text, sub.fontPx, 500));
  }
  const textLeft = Math.min(layout.title.x, layout.sublines.x);
  const textRight = Math.max(layout.title.x + titleW, layout.sublines.x + subsW);
  const left = Math.min(layout.author.cx - layout.author.r, textLeft);
  const right = Math.max(layout.author.cx + layout.author.r, textRight);
  const shift = W / 2 - (left + right) / 2;
  return {
    authorCx: layout.author.cx + shift,
    authorCy: layout.author.cy,
    titleX: layout.title.x + shift,
    sublinesX: layout.sublines.x + shift,
  };
}
/**
 * Сдвиг общего контейнера «фото + тексты» так, чтобы его bounding box
 * встал строго по центру кадра. measure(text, fontPx, weight) — ширина в px.
 * Возвращает dx в px (прибавить к author.cx и title.x). Чистая, тестируется.
 */
export function centerTitleBlockShift(
  layout: BrandingLayout,
  containerWidth: number,
  texts: TitleBlockTexts,
  measure: (text: string, fontPx: number, weight: number) => number,
): number {
  const W = Math.max(1, containerWidth);
  const titleW = texts.title.trim() ? measure(texts.title, texts.titleFontPx, 700) : 0;
  let subsW = 0;
  for (const sub of texts.sublines) {
    if (sub.trim()) subsW = Math.max(subsW, measure(sub, texts.subFontPx, 500));
  }
  const textLeft = layout.title.x;
  const textRight = layout.title.x + Math.max(titleW, subsW);
  const left = Math.min(layout.author.cx - layout.author.r, textLeft);
  const right = Math.max(layout.author.cx + layout.author.r, textRight);
  return W / 2 - (left + right) / 2;
}
