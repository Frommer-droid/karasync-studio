import { LineTiming, WordTiming, VideoPreviewConfig } from './types';
import { calculateWordProgress } from './syncAlgorithm';
import { computeBrandingLayout, composeCenteredTitleBlock } from './brandingLayout';

/** Fallback lyric font stack (same as the 'inter' catalog entry). */
const DEFAULT_RENDERER_FONT_STACK =
  'Inter, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export interface CanvasRenderOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Line for the fixed top slot (null = slot stays blank). */
  topLine: LineTiming | null;
  /** Line for the fixed bottom slot (null = slot stays blank). */
  bottomLine: LineTiming | null;
  /**
   * Auto-fitted font size (px at 1080p reference, from computeAutoFitFontPx).
   * Wins over fontSizePx/preset when set. Scaled to the actual canvas height.
   */
  fittedFontPx?: number | null;
  /** CSS font stack for lyric lines. Defaults to the Inter stack. */
  fontStack?: string | null;
  /** Font weight for lyric lines. Defaults to 800. */
  fontWeight?: number | null;
  currentTime: number;
  /** Ручное выделение в редакторе: показывается только в живом предпросмотре на паузе. */
  highlightedWordId?: string | null;
  config: VideoPreviewConfig;
  backgroundImage?: CanvasImageSource | null;
  showLiveBadge?: boolean;
  /**
   * Кадр видео-заставки для полного перекрытия (интро/аутро).
   * Если задан — рисуется cover на весь кадр вместо фона, строк и шапки.
   */
  coverFrame?: CanvasImageSource | null;
  /**
   * Кадр фонового видео — основа кадра (под строками и шапкой).
   * Имеет приоритет над фоновым фото и однотонной заливкой.
   */
  backgroundVideoFrame?: CanvasImageSource | null;
  /** Картинки фирменной шапки (null = соответствующий элемент не рисуется). */
  brandingImages?: {
    logo?: CanvasImageSource | null;
    author?: CanvasImageSource | null;
    qr?: CanvasImageSource | null;
  } | null;
  /**
   * true в живом превью: тексты шапки показывает HTML-оверлей (их можно править),
   * canvas рисует только картинки и плашку QR, чтобы не двоилось.
   * В экспорте и снапшоте всегда false — там рисует только canvas.
   */
  hideBrandingTexts?: boolean;
  debugOverlay?: {
    mediaTime: number;
    effectiveTime: number;
    lineIndex: number;
    wordIndex: number;
    syncOffsetMs: number;
    wordProgress?: number;
    exportStart?: number;
  } | null;
}

/**
 * Shared Canvas Video Renderer for Karaoke Sync Studio.
 *
 * Draws the two-line presentation pair ({topLine, bottomLine} from
 * getKaraokePresentationPair) into two FIXED slots, so lines never jump
 * when the pair changes. Words switch fully to the karaoke color at their
 * start time, using the same timing as the DOM preview.
 */
export function renderKaraokeCanvasFrame({
  ctx,
  width,
  height,
  topLine,
  bottomLine,
  fittedFontPx = null,
  fontStack = null,
  fontWeight = null,
  currentTime,
  highlightedWordId = null,
  config,
  backgroundImage = null,
  showLiveBadge = true,
  brandingImages = null,
  hideBrandingTexts = false,
  debugOverlay = null,
  coverFrame = null,
  backgroundVideoFrame = null,
}: CanvasRenderOptions): void {
  // 1. Clear background
  ctx.clearRect(0, 0, width, height);

  // 1b. Видео-заставка: полное перекрытие кадра (фон, строки и шапка не рисуются).
  const coverOn = Boolean(coverFrame);
  if (coverOn) {
    drawCoverFit(ctx, coverFrame as CanvasImageSource, width, height);
  }

  // 2. Render background: фоновое видео > фоновое фото > однотонная заливка.
  // Видео идёт как есть, без затемнения: иначе полноцветный клип сереет.
  const dimFactor = Math.max(0, Math.min(0.9, (config.backgroundDim || 40) / 100));
  if (!coverOn && backgroundVideoFrame) {
    drawCoverFit(ctx, backgroundVideoFrame, width, height);
  } else if (!coverOn && backgroundImage) {
    ctx.save();
    // Background blur simulation or direct draw
    // Cover scale
    ctx.drawImage(backgroundImage, 0, 0, width, height);

    // Apply darkening overlay
    ctx.fillStyle = `rgba(0, 0, 0, ${dimFactor})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } else if (!coverOn) {
    // Flat studio background
    ctx.fillStyle = config.backgroundColor || '#231825';
    ctx.fillRect(0, 0, width, height);
  }

  const brandingOn = Boolean(config.branding?.enabled);

  // 2b. Фирменная шапка (логотип, автор+тексты, QR). Лайв-бейдж при ней не рисуем — угол занят.
  if (brandingOn && !coverOn) {
    drawBrandingHeader(ctx, width, height, config, brandingImages, fontStack || DEFAULT_RENDERER_FONT_STACK, hideBrandingTexts);
  }

  // 3. Render Top Live Badge (if enabled)
  if (showLiveBadge && !brandingOn && !coverOn) {
    ctx.save();
    const badgeX = 32;
    const badgeY = 32;
    const badgeW = 120;
    const badgeH = 30;
    const radius = 15;

    // Badge pill background
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(badgeX, badgeY, badgeW, badgeH, radius) : ctx.rect(badgeX, badgeY, badgeW, badgeH);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Red pulsing dot
    ctx.beginPath();
    ctx.arc(badgeX + 16, badgeY + badgeH / 2, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();

    // Text
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 11px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('KARAOKE LIVE', badgeX + 28, badgeY + badgeH / 2);
    ctx.restore();
  }

  // 4. Без подложек и скримов: везде однотонный фон (см. шаг 2).

  // Determine vertical text anchor based on config.textPosition
  // (explicit lyricsPositionY percent wins over the preset)
  const positionMode = config.textPosition || 'lower_third';
  let primaryCenterY = height * 0.72; // default lower third (~72% down)

  if (Number.isFinite(config.lyricsPositionY)) {
    const clampedY = Math.min(95, Math.max(5, config.lyricsPositionY as number));
    primaryCenterY = (height * clampedY) / 100;
  } else if (positionMode === 'bottom') {
    primaryCenterY = height * 0.82;
  } else if (positionMode === 'middle') {
    primaryCenterY = height * 0.5;
  } else {
    // 'lower_third'
    primaryCenterY = height * 0.72;
  }

  // 5. Lyrics Layout & Font Metrics Setup (two fixed slots)
  // fontSizePx is px at 1080p reference height and overrides the preset multiplier.
  let sizeMultiplier = 0.046; // medium (~50px on 1080p)
  if (config.fontSize === 'small') sizeMultiplier = 0.036;
  if (config.fontSize === 'large') sizeMultiplier = 0.058;

  const baseFontSize = Number.isFinite(fittedFontPx) && (fittedFontPx as number) > 0
    ? Math.round((height * (fittedFontPx as number)) / 1080)
    : Number.isFinite(config.fontSizePx) && (config.fontSizePx as number) > 0
      ? Math.round((height * (config.fontSizePx as number)) / 1080)
      : Math.round(height * sizeMultiplier);
  const lyricFontStack = fontStack || DEFAULT_RENDERER_FONT_STACK;
  const lyricWeight = fontWeight === 400 || fontWeight === 500 || fontWeight === 700 || fontWeight === 800 || fontWeight === 900
    ? fontWeight
    : 800;
  const slotFont = `${lyricWeight} ${baseFontSize}px ${lyricFontStack}`;

  // Fixed slot positions: lines never move when the pair changes.
  const effLineHeight = Number.isFinite(config.lineHeight)
    ? Math.min(2.5, Math.max(0.8, config.lineHeight as number))
    : 1.15;
  const slotGap = baseFontSize * effLineHeight;
  let topSlotY: number;
  let bottomSlotY: number;
  if (positionMode === 'middle') {
    topSlotY = primaryCenterY - slotGap / 2;
    bottomSlotY = primaryCenterY + slotGap / 2;
  } else {
    bottomSlotY = primaryCenterY;
    topSlotY = primaryCenterY - slotGap;
  }

  const drawSlotLine = (line: LineTiming, centerY: number) => {
    ctx.save();
    ctx.font = slotFont;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const spaceWidth = ctx.measureText(' ').width;
    const wordMetrics: { word: WordTiming; width: number; highlighted: boolean }[] = [];
    let totalLineWidth = 0;

    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      const wWidth = ctx.measureText(w.text).width;
      const highlighted = highlightedWordId
        ? w.id === highlightedWordId
        : calculateWordProgress(currentTime, w.start, w.end) === 1;
      wordMetrics.push({ word: w, width: wWidth, highlighted });
      totalLineWidth += wWidth;
      if (i < line.words.length - 1) {
        totalLineWidth += spaceWidth;
      }
    }

    // Auto-scale or line-wrap if line exceeds screen width padding.
    // Порог выше цели автоподбора (0.92), чтобы не душить только что подобранный кегль.
    const maxAllowedWidth = width * 0.94;
    let scale = 1.0;
    if (totalLineWidth > maxAllowedWidth && totalLineWidth > 0) {
      scale = maxAllowedWidth / totalLineWidth;
    }

    const startX = (width - totalLineWidth * scale) / 2;
    let currentX = startX;

    // Draw each word in one color; the switch happens at its start timestamp.
    const baseColor = config.textColor || '#ffffff';
    const karaokeColor = config.karaokeColor || '#56FFFC';
    for (let i = 0; i < wordMetrics.length; i++) {
      const { word, width: origW, highlighted } = wordMetrics[i];
      const wWidth = origW * scale;

      ctx.save();
      ctx.font = slotFont;

      const drawWordAt = (x0: number, y0: number) => {
        ctx.fillStyle = highlighted ? karaokeColor : baseColor;
        ctx.fillText(word.text, x0, y0);
      };

      if (scale !== 1.0) {
        ctx.translate(currentX, centerY);
        ctx.scale(scale, scale);
        drawWordAt(0, 0);
      } else {
        drawWordAt(currentX, centerY);
      }

      ctx.restore();

      // Advance position for next word
      currentX += wWidth + spaceWidth * scale;
    }

    ctx.restore();
  };

  const hasTopLine = topLine && topLine.words && topLine.words.length > 0;
  const hasBottomLine = bottomLine && bottomLine.words && bottomLine.words.length > 0;

  if (!coverOn && hasTopLine) {
    drawSlotLine(topLine, topSlotY);
  }
  if (!coverOn && hasBottomLine) {
    drawSlotLine(bottomLine, bottomSlotY);
  }
  // No standby text: the screen stays clean between verses.

  // 6. Render Debug Timing Overlay (Development / Diagnostic mode)
  if (debugOverlay) {
    ctx.save();
    const boxX = 24;
    const boxY = 24;
    const boxW = 240;
    const boxH = 154;
    const pad = 12;

    // Semi-transparent dark background box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);
    }

    // Monospace diagnostic text
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const exportStartSec = debugOverlay.exportStart || 0;
    const videoSec = Math.max(0, debugOverlay.mediaTime - exportStartSec);

    const lines = [
      { label: 'VIDEO TC:', val: `${videoSec.toFixed(3)}s`, color: '#38bdf8' },
      { label: 'SONG TIME:', val: `${debugOverlay.mediaTime.toFixed(3)}s`, color: '#818cf8' },
      { label: 'EFFECTIVE:', val: `${debugOverlay.effectiveTime.toFixed(3)}s`, color: '#4ade80' },
      { label: 'OFFSET:', val: `${debugOverlay.syncOffsetMs >= 0 ? '+' : ''}${debugOverlay.syncOffsetMs}ms`, color: '#c084fc' },
      { label: 'LINE:', val: `${debugOverlay.lineIndex >= 0 ? debugOverlay.lineIndex + 1 : '—'}`, color: '#facc15' },
      { label: 'WORD:', val: `${debugOverlay.wordIndex >= 0 ? debugOverlay.wordIndex + 1 : '—'}`, color: '#f472b6' },
      { label: 'PROGRESS:', val: `${(debugOverlay.wordProgress ?? 0).toFixed(2)}`, color: '#fb923c' },
    ];

    let lineY = boxY + pad;
    for (const item of lines) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(item.label, boxX + pad, lineY);
      ctx.fillStyle = item.color;
      ctx.fillText(item.val, boxX + pad + 95, lineY);
      lineY += 18;
    }

    ctx.restore();
  }
}

/** Натуральный размер источника: у VideoFrame — displayWidth/Height, у картинок/видео — свои поля. */
function coverSourceSize(img: CanvasImageSource): { w: number; h: number } {
  const rec = img as unknown as {
    displayWidth?: number;
    displayHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: number;
    height?: number;
  };
  const w = rec.displayWidth || rec.naturalWidth || rec.videoWidth || rec.width || 1;
  const h = rec.displayHeight || rec.naturalHeight || rec.videoHeight || rec.height || 1;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Прямоугольник cover-fit: весь приёмник закрыт, пропорции целы, лишнее обрезается. Чистая, тестируется. */
export function coverFitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(dstW / Math.max(1, srcW), dstH / Math.max(1, srcH));
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
}

/** Рисует кадр (картинка/видео) cover-фитом на весь кадр с обрезкой краёв. */
function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  width: number,
  height: number,
): void {
  const { w: iw, h: ih } = coverSourceSize(img);
  const r = coverFitRect(iw, ih, width, height);
  ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
}

/** Рисует картинку cover-фитом в круг с центром (cx, cy) и радиусом r. */
function drawCoverCircle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  cx: number,
  cy: number,
  r: number,
): void {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLImageElement).width || 1;
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLImageElement).height || 1;
  const scale = Math.max((2 * r) / iw, (2 * r) / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.rect(x, y, w, h);
  }
}

/**
 * Фирменная шапка кадра: круглый логотип слева, круглое фото автора +
 * редактируемые текстовые строки, QR с плашкой "Поддержать" справа.
 * Геометрия — из computeBrandingLayout (доли кадра).
 */
function drawBrandingHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config: VideoPreviewConfig,
  images: { logo?: CanvasImageSource | null; author?: CanvasImageSource | null; qr?: CanvasImageSource | null } | null | undefined,
  fontStack: string,
  hideTexts: boolean,
): void {
  const branding = config.branding;
  if (!branding?.enabled) return;
  let L = computeBrandingLayout(width, height, branding.placement, branding.lineSpacing);

  // Чекбокс «блок по центру»: текущая раскладка едет одним контейнером
  // в центр — взаимные смещения фото/названия/строк не меняются.
  if (branding.blockCentered) {
    const subs = [branding.line1, branding.line2, branding.line3];
    const measureForCenter = (text: string, fontPx: number, weight: number): number => {
      ctx.save();
      ctx.font = `${weight} ${Math.round(fontPx)}px ${fontStack}`;
      const w = ctx.measureText(text).width;
      ctx.restore();
      return w;
    };
    const comp = composeCenteredTitleBlock(
      L,
      width,
      { text: branding.title || '', fontPx: L.title.fontPx },
      subs.map((s) => ({ text: s || '', fontPx: L.sublines.fontPx })),
      measureForCenter,
    );
    L = {
      ...L,
      author: { ...L.author, cx: comp.authorCx, cy: comp.authorCy },
      title: { ...L.title, x: comp.titleX },
      sublines: { ...L.sublines, x: comp.sublinesX },
    };
  }

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // Логотип в круге — точно такой же блок, как фото автора, без ободков
  if (branding.showLogo && images?.logo) {
    drawCoverCircle(ctx, images.logo, L.logo.cx, L.logo.cy, L.logo.r);
  }

  // Фото автора (круг) — рисуется всегда, тексты в превью отданы оверлею
  if (branding.showTitle && images?.author) {
    drawCoverCircle(ctx, images.author, L.author.cx, L.author.cy, L.author.r);
  }

  // Текстовый блок не зависит от галочки фото автора.
  if (!hideTexts) {
    ctx.textAlign = 'left';
    const title = (branding.title || '').trim();
    if (title) {
      ctx.font = `700 ${Math.round(L.title.fontPx)}px ${fontStack}`;
      ctx.fillStyle = branding.titleColor || '#FFF6E0';
      ctx.fillText(title, L.title.x, L.title.baselineY);
    }
    const subs = [branding.line1, branding.line2, branding.line3]
      .map((s) => (s || '').trim())
      .filter(Boolean);
    if (subs.length > 0) {
      ctx.font = `500 ${Math.round(L.sublines.fontPx)}px ${fontStack}`;
      ctx.fillStyle = branding.linesColor || '#56FFFC';
      subs.forEach((text, i) => {
        ctx.fillText(text, L.sublines.x, L.sublines.firstBaselineY + i * L.sublines.stepY);
      });
    }
  }

  // QR чистым изображением как есть: ширина из layout, высота — по пропорциям файла.
  if (branding.showQR && images?.qr) {
    const iw = (images.qr as HTMLImageElement).naturalWidth
      || (images.qr as HTMLImageElement).width || 1;
    const ih = (images.qr as HTMLImageElement).naturalHeight
      || (images.qr as HTMLImageElement).height || 1;
    ctx.drawImage(images.qr, L.qr.x, L.qr.y, L.qr.size, L.qr.size * (ih / Math.max(1, iw)));
  }

  ctx.restore();
}
