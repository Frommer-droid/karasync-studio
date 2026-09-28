/**
 * Хранилище изображений оформления (логотип, фото автора, QR, фон) в IndexedDB.
 * В конфиге лежат только строковые id — blob-URL сессии умирают при перезагрузке,
 * а картинки восстанавливаются отсюда. Плюс кэш object-URL в памяти сессии.
 */

const DB_NAME = 'karaoke_studio_images_db';
const DB_VERSION = 1;
const STORE_NAME = 'branding_images';

export const BRANDING_LOGO_KEY = 'branding_logo';
export const BRANDING_AUTHOR_KEY = 'branding_author';
export const BRANDING_QR_KEY = 'branding_qr';
export const BACKGROUND_IMAGE_KEY = 'background_image';

function openImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open image DB'));
  });
}

export async function saveImage(key: string, blob: Blob): Promise<void> {
  const db = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(blob, key);
    req.onsuccess = () => {
      urlCache.delete(key); // сбросим кэш — следующий resolve даст свежий URL
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteImage(key: string): Promise<void> {
  try {
    const db = await openImageDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
  urlCache.delete(key);
}

async function loadImageBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openImageDatabase();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Blob картинки по id для экспорта пресета (null — нет картинки). */
export async function getImageBlob(key: string): Promise<Blob | null> {
  return loadImageBlob(key);
}

const urlCache = new Map<string, string>();

/**
 * Object-URL картинки для сессии (для <img> и canvas).
 * Кэшируется; null — если картинки с таким id нет.
 */
export async function resolveImageUrl(imageId: string | null | undefined): Promise<string | null> {
  if (!imageId) return null;
  const cached = urlCache.get(imageId);
  if (cached) return cached;
  const blob = await loadImageBlob(imageId);
  if (!blob) return null;
  try {
    const url = URL.createObjectURL(blob);
    urlCache.set(imageId, url);
    return url;
  } catch {
    return null;
  }
}

/** Прогреть кэш для списка id (вызывать при старте/восстановлении проекта). */
export async function prefetchImageUrls(imageIds: (string | null | undefined)[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const id of imageIds) {
    if (!id) continue;
    const url = await resolveImageUrl(id);
    if (url) result[id] = url;
  }
  return result;
}
