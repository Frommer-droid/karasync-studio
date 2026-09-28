/**
 * Пресеты оформления: экспорт/импорт всех настроек кнопок (тексты шапки,
 * цвета, шрифты, позиции, картинки) одним файлом.
 * Песня, тайминги и API-ключ в пресет никогда не входят.
 */
import type { VideoPreviewConfig } from '../../shared/types';
import { normalizeRestoredVideoConfig } from '../utils/configRestore';
import { isDesktopApp, isElectronRenderer, saveTextFileDesktop } from './desktopBridge';
import {
  saveImage,
  getImageBlob,
  BRANDING_LOGO_KEY,
  BRANDING_AUTHOR_KEY,
  BRANDING_QR_KEY,
  BACKGROUND_IMAGE_KEY,
} from './imageStorage';

export const PRESET_APP_MARKER = 'karasync-preset';
export const PRESET_FILE_VERSION = 1;
export const PRESET_FILE_EXT = 'karasync-preset.json';

export type PresetImageSlot = 'logo' | 'author' | 'qr' | 'background';

/** Слот -> ключ IndexedDB (те же фиксированные ключи, что в imageStorage). */
export const PRESET_SLOT_KEYS: Record<PresetImageSlot, string> = {
  logo: BRANDING_LOGO_KEY,
  author: BRANDING_AUTHOR_KEY,
  qr: BRANDING_QR_KEY,
  background: BACKGROUND_IMAGE_KEY,
};

export interface PresetFile {
  app: string;
  version: number;
  name: string;
  savedAt: string;
  videoConfig: VideoPreviewConfig;
  /** Слот -> dataURL картинки. Отсутствует — картинка не входит в пресет. */
  images: Partial<Record<PresetImageSlot, string>>;
}

/** Blob -> dataURL (браузер через FileReader, node-тесты через Buffer). */
export async function blobToDataURL(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать картинку'));
      reader.readAsDataURL(blob);
    });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/** dataURL -> Blob. Кидает понятную ошибку на битом формате. */
export function dataURLToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl || '');
  if (!m) {
    throw new Error('Битая картинка в пресете (не dataURL)');
  }
  return new Blob([base64ToBytes(m[2]) as BlobPart], { type: m[1] || 'application/octet-stream' });
}

/** Имя файла пресета из названия (безопасные символы). */
export function presetFileName(name: string): string {
  const clean = (name || 'preset').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'preset';
  return `${clean}.${PRESET_FILE_EXT}`;
}

/**
 * Собирает объект пресета из текущего конфига. Чистая (кроме чтения блобов):
 * blob:-URL вычищаются, id картинок перенормируются на импорте.
 */
export async function buildPresetFile(
  videoConfig: VideoPreviewConfig,
  name: string,
  images: Partial<Record<PresetImageSlot, Blob | null>>,
): Promise<PresetFile> {
  const config: VideoPreviewConfig = {
    ...videoConfig,
    backgroundImageUrl: null,
    backgroundImageId: null,
    branding: videoConfig.branding
      ? {
          ...videoConfig.branding,
          logoImageId: null,
          authorImageId: null,
          qrImageId: null,
        }
      : videoConfig.branding,
    // Клип заставки тяжёлый — в пресет не входит, только галки.
    coverVideo: videoConfig.coverVideo
      ? {
          ...videoConfig.coverVideo,
          videoId: null,
          videoName: null,
          videoDuration: null,
          videoFps: null,
        }
      : videoConfig.coverVideo,
    // Фоновое видео — тоже файл, в пресет не входит.
    backgroundVideo: null,
  };
  const packed: Partial<Record<PresetImageSlot, string>> = {};
  for (const slot of Object.keys(images) as PresetImageSlot[]) {
    const blob = images[slot];
    if (blob) {
      packed[slot] = await blobToDataURL(blob);
    }
  }
  return {
    app: PRESET_APP_MARKER,
    version: PRESET_FILE_VERSION,
    name: (name || 'preset').trim() || 'preset',
    savedAt: new Date().toISOString(),
    videoConfig: config,
    images: packed,
  };
}

/**
 * Сохраняет пресет файлом. В собранном Electron-приложении — через
 * нативный диалог main-процесса (веб-скачивания там не работают).
 * В браузере: системный диалог выбора папки где поддерживается
 * (Chrome/Edge), иначе — обычное скачивание в загрузки.
 * @returns 'saved' | 'cancelled' (отмена — тихо, без ошибки).
 */
export async function downloadPreset(preset: PresetFile): Promise<'saved' | 'cancelled'> {
  const json = JSON.stringify(preset);
  if (isDesktopApp()) {
    return saveTextFileDesktop(presetFileName(preset.name), json);
  }
  // Electron без preload-моста: <a download> там молча ничего не сохраняет
  // (нет will-download), поэтому честно сообщаем вместо ложного 'saved'.
  if (isElectronRenderer()) {
    throw new Error(
      'Мост сохранения Electron недоступен (preload не загрузился). Пересоберите приложение: npm run build.'
    );
  }
  const w = window as unknown as {
    showSaveFilePicker?: (opts?: object) => Promise<{
      createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: presetFileName(preset.name),
        types: [{ description: 'Пресет оформления', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return 'saved';
    } catch (e) {
      // Отмена диалога — тихо выходим, остальное — фолбэк ниже
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = presetFileName(preset.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return 'saved';
}

/** Проверяет и разбирает загруженный JSON. Кидает понятную ошибку. */
export function parsePresetFile(json: unknown): PresetFile {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Не похоже на файл пресета');
  }
  const p = json as Record<string, unknown>;
  if (p.app !== PRESET_APP_MARKER) {
    throw new Error('Это не файл пресета Karaoke Sync Studio');
  }
  if (p.version !== PRESET_FILE_VERSION) {
    throw new Error(`Неподдерживаемая версия пресета (${String(p.version)})`);
  }
  if (!p.videoConfig || typeof p.videoConfig !== 'object') {
    throw new Error('В пресете нет настроек оформления');
  }
  const images = (p.images && typeof p.images === 'object' ? p.images : {}) as Record<string, unknown>;
  const cleanImages: Partial<Record<PresetImageSlot, string>> = {};
  for (const slot of Object.keys(PRESET_SLOT_KEYS) as PresetImageSlot[]) {
    const v = images[slot];
    if (typeof v === 'string' && v.startsWith('data:')) {
      cleanImages[slot] = v;
    }
  }
  return {
    app: PRESET_APP_MARKER,
    version: PRESET_FILE_VERSION,
    name: typeof p.name === 'string' && p.name.trim() ? p.name : 'preset',
    savedAt: typeof p.savedAt === 'string' ? p.savedAt : '',
    videoConfig: normalizeRestoredVideoConfig(p.videoConfig as VideoPreviewConfig),
    images: cleanImages,
  };
}

/** Читает текущие картинки оформления из IndexedDB для экспорта. */
export async function collectPresetImages(): Promise<Partial<Record<PresetImageSlot, Blob | null>>> {
  const out: Partial<Record<PresetImageSlot, Blob | null>> = {};
  for (const slot of Object.keys(PRESET_SLOT_KEYS) as PresetImageSlot[]) {
    out[slot] = await getImageBlob(PRESET_SLOT_KEYS[slot]);
  }
  return out;
}

/**
 * Кладёт картинки пресета в IndexedDB и возвращает id для конфига.
 * Слоты без картинок в пресет не входят — их id остаются как были
 * (решает вызывающий код: обычно сбрасывает в null).
 */
export async function storePresetImages(
  images: Partial<Record<PresetImageSlot, string>>,
): Promise<Partial<Record<PresetImageSlot, string>>> {
  const ids: Partial<Record<PresetImageSlot, string>> = {};
  for (const slot of Object.keys(images) as PresetImageSlot[]) {
    const dataUrl = images[slot];
    if (!dataUrl) continue;
    const key = PRESET_SLOT_KEYS[slot];
    await saveImage(key, dataURLToBlob(dataUrl));
    ids[slot] = key;
  }
  return ids;
}
