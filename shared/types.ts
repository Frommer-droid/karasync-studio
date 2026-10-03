/**
 * Shared types for Karaoke Sync Studio
 */

export type TimingSource = 'gemini' | 'interpolated' | 'manual';

export interface WordTiming {
  id: string;
  text: string;
  start: number; // in seconds
  end: number;   // in seconds
  confidence?: number; // 0 to 1
  timingSource?: TimingSource;
  lineIndex?: number;
  wordIndexInLine?: number;
  isLowConfidence?: boolean;
}

export interface LineTiming {
  id: string;
  text: string;
  start: number;
  end: number;
  words: WordTiming[];
  lineIndex?: number;
}

export interface AlignmentStats {
  totalWords: number;
  exactMatches: number;
  approxMatches: number;
  interpolated: number;
  unmatched: number;
  averageConfidence: number;
}

export type SupportedLanguage = 'auto' | 'ru' | 'en';

export interface TranscriptionRequest {
  audioBase64: string;
  mimeType: string;
  fileName: string;
  isVocalTrackUsed?: boolean;
  lyricsPrompt?: string;
  language?: SupportedLanguage;
  useReferenceLyrics?: boolean;
  /** API-ключ из интерфейса (приоритет над серверным GEMINI_API_KEY). */
  apiKey?: string;
}

export interface TranscriptionResponse {
  words: WordTiming[];
  lines: LineTiming[];
  fullText: string;
  detectedLanguage?: string;
  audioDuration?: number;
  alignmentStats?: AlignmentStats;
  isAlignedWithReference?: boolean;
}

export type ProcessingStatus = 
  | 'idle' 
  | 'uploading' 
  | 'gemini_upload' 
  | 'transcribing' 
  | 'processing' 
  | 'ready' 
  | 'error';

export interface ProcessingProgress {
  status: ProcessingStatus;
  message: string;
  percent: number;
  error?: string;
}

export interface VideoPreviewConfig {
  backgroundImageUrl: string | null;
  /** Ключ картинки фона в IndexedDB (переживает перезапуск, в отличие от blob-URL). */
  backgroundImageId?: string | null;
  backgroundDim: number; // 0 to 100%
  backgroundBlur: number; // 0 to 20px
  fontSize: 'small' | 'medium' | 'large';
  /** Explicit font size in px at 1080p reference height. Overrides `fontSize` preset when set. */
  fontSizePx?: number;
  /** Auto-fit font size to the longest line (wins over manual size when true). Default true. */
  autoFitFontSize?: boolean;
  /** Font id from the karaoke font catalog (see src/utils/fonts.ts). Default 'inter'. */
  fontFamily?: string;
  /** Font weight for lyric lines (400/500/700/800/900). Default 800. */
  fontWeight?: number;
  /** Base screen background (without custom photo). Default '#231825'. */
  backgroundColor?: string;
  /** Line box height multiplier (межстрочный интервал). Default 1.15. */
  lineHeight?: number;
  textPosition: 'bottom' | 'middle' | 'lower_third'; // default 'lower_third'
  /** Vertical anchor of the two-line block, 0 (top) to 100 (bottom). Overrides `textPosition` when set. */
  lyricsPositionY?: number;
  /** Фирменная шапка кадра (логотип, автор, тексты, QR). */
  branding?: BrandingConfig;
  /** Фоновое видео — основа кадра (под строками и шапкой). */
  backgroundVideo?: VideoClipRef | null;
  /** Видео-заставка: один клип на начало и конец (см. src/services/coverVideoStorage.ts). */
  coverVideo?: CoverVideoConfig;
  strokeWidth: number; // 0 to 12 px
  backdropOpacity: number; // 0 to 100%
  karaokeColor: string; // hex color for active word
  textColor: string;
  showNextLine: boolean;
}

/** Ссылка на видеофайл в IndexedDB (переживает перезапуск). */
export interface VideoClipRef {
  /** Ключ видеофайла в IndexedDB. */
  videoId?: string | null;
  /** Имя файла для отображения в настройках. */
  videoName?: string | null;
  /** Длительность клипа, секунды (заполняется при загрузке). */
  videoDuration?: number | null;
  /** Частота кадров клипа, fps (для предупреждения о несовпадении с fps экспорта). */
  videoFps?: number | null;
}

export interface CoverVideoConfig extends VideoClipRef {
  /** Показывать клип с начала до появления первой строки (за 2с до неё). */
  enabledIntro: boolean;
  /** Показывать клип после исчезновения последней строки до конца. */
  enabledOutro: boolean;
}

export interface KaraokeProject {
  audioUrl: string | null;
  audioFileName: string;
  audioDuration: number;
  audioMimeType: string;
  providedLyrics: string;
  language: SupportedLanguage;
  useReferenceLyrics: boolean;
  words: WordTiming[];
  lines: LineTiming[];
  originalWords?: WordTiming[];
  originalLines?: LineTiming[];
  fullText: string;
  alignmentStats?: AlignmentStats;
  isAlignedWithReference?: boolean;
  videoConfig: VideoPreviewConfig;
  savedAt?: string;
}

/**
 * Фирменная шапка кадра. Картинки хранятся в IndexedDB по id
 * (см. src/services/imageStorage.ts) — в конфиге только ключи,
 * поэтому всё переживает перезагрузки.
 */
export interface BrandingConfig {
  enabled: boolean;
  showLogo: boolean;
  showTitle: boolean; // историческое имя: видимость только фото автора; текст шапки независим
  showQR: boolean;
  logoImageId?: string | null;
  authorImageId?: string | null;
  qrImageId?: string | null;
  title: string;
  line1: string;
  line2: string;
  line3: string;
  donateLabel: string;
  titleColor: string;
  linesColor: string;
  /** Межстрочный интервал трёх строк, % (100 — как задумано). */
  lineSpacing?: number;
  /** Общий блок «фото + тексты» по центру экрана. */
  blockCentered?: boolean;
  /** Позиции элементов: масштаб % (100 — как задумано), сдвиги в п.п. ширины/высоты. */
  placement?: BrandingPlacement;
}

export interface BrandingElementPlacement {
  /** Масштаб размера, % (50–200). */
  scale: number;
  /** Сдвиг по горизонтали, п.п. ширины (−20…+20). */
  dx: number;
  /** Сдвиг по вертикали, п.п. высоты (−20…+20). */
  dy: number;
}

export interface BrandingPlacement {
  logo: BrandingElementPlacement;
  author: BrandingElementPlacement;
  qr: BrandingElementPlacement;
  /** Три строки (бежево-голубым): общий сдвиг/масштаб блока строк. */
  title: BrandingElementPlacement;
  /** Название песни (бежевое): независимые сдвиг/масштаб. Опционально —
      старые проекты и пресеты без ключа падают на дефолт. */
  songTitle?: BrandingElementPlacement;
}

export const DEFAULT_ELEMENT_PLACEMENT: BrandingElementPlacement = { scale: 100, dx: 0, dy: 0 };

export const DEFAULT_PLACEMENT: BrandingPlacement = {
  logo: { ...DEFAULT_ELEMENT_PLACEMENT },
  author: { ...DEFAULT_ELEMENT_PLACEMENT },
  qr: { ...DEFAULT_ELEMENT_PLACEMENT },
  title: { ...DEFAULT_ELEMENT_PLACEMENT },
  songTitle: { ...DEFAULT_ELEMENT_PLACEMENT },
};

export const DEFAULT_BRANDING: BrandingConfig = {
  enabled: true,
  showLogo: true,
  showTitle: true,
  showQR: true,
  logoImageId: null,
  authorImageId: null,
  qrImageId: null,
  title: '',
  line1: '',
  line2: '',
  line3: '',
  donateLabel: 'Поддержать',
  titleColor: '#FFF6E0',
  linesColor: '#56FFFC',
  placement: {
    logo: { ...DEFAULT_ELEMENT_PLACEMENT },
    author: { ...DEFAULT_ELEMENT_PLACEMENT },
    qr: { ...DEFAULT_ELEMENT_PLACEMENT },
    title: { ...DEFAULT_ELEMENT_PLACEMENT },
  },
};
