/**
 * Хранилище фонового видео (основа кадра) в IndexedDB.
 * В конфиге только id/имя/длительность — blob переживает перезапуски.
 */

const DB_NAME = 'karaoke_studio_background_db';
const DB_VERSION = 1;
const STORE_NAME = 'background_video_files';

export const BACKGROUND_VIDEO_KEY = 'background_clip';

export interface StoredBackgroundVideo {
  key: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  updatedAt: number;
}

function openBackgroundDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

export async function saveBackgroundVideoBlob(fileOrBlob: File | Blob, fileName?: string): Promise<StoredBackgroundVideo> {
  const db = await openBackgroundDatabase();
  const record: StoredBackgroundVideo = {
    key: BACKGROUND_VIDEO_KEY,
    blob: fileOrBlob,
    name: fileName || (fileOrBlob as File).name || 'background.mp4',
    type: fileOrBlob.type || 'video/mp4',
    size: fileOrBlob.size,
    updatedAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  return record;
}

export async function getBackgroundVideoBlob(): Promise<StoredBackgroundVideo | null> {
  try {
    const db = await openBackgroundDatabase();
    const record = await new Promise<StoredBackgroundVideo | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(BACKGROUND_VIDEO_KEY);
      req.onsuccess = () => resolve(req.result as StoredBackgroundVideo | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!record || !record.blob) return null;
    return record;
  } catch {
    return null;
  }
}

export async function clearBackgroundVideoBlob(): Promise<void> {
  try {
    const db = await openBackgroundDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(BACKGROUND_VIDEO_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}
