/**
 * Хранилище видео-заставки (один клип на начало и конец) в IndexedDB.
 * В конфиге только id/имя/длительность — blob переживает перезапуски.
 */

const DB_NAME = 'karaoke_studio_cover_db';
const DB_VERSION = 1;
const STORE_NAME = 'cover_video_files';

export const COVER_VIDEO_KEY = 'cover_clip';

export interface StoredCoverVideo {
  key: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  updatedAt: number;
}

function openCoverDatabase(): Promise<IDBDatabase> {
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

export async function saveCoverVideoBlob(fileOrBlob: File | Blob, fileName?: string): Promise<StoredCoverVideo> {
  const db = await openCoverDatabase();
  const record: StoredCoverVideo = {
    key: COVER_VIDEO_KEY,
    blob: fileOrBlob,
    name: fileName || (fileOrBlob as File).name || 'cover.mp4',
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

export async function getCoverVideoBlob(): Promise<StoredCoverVideo | null> {
  try {
    const db = await openCoverDatabase();
    const record = await new Promise<StoredCoverVideo | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(COVER_VIDEO_KEY);
      req.onsuccess = () => resolve(req.result as StoredCoverVideo | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!record || !record.blob) return null;
    return record;
  } catch {
    return null;
  }
}

export async function clearCoverVideoBlob(): Promise<void> {
  try {
    const db = await openCoverDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(COVER_VIDEO_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

/** Длительность видеоблоба в секундах (0 — не удалось определить). */
export function probeVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      const done = (value: number) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      video.onloadedmetadata = () => {
        done(Number.isFinite(video.duration) ? video.duration : 0);
      };
      video.onerror = () => done(0);
      video.src = url;
    } catch {
      resolve(0);
    }
  });
}
