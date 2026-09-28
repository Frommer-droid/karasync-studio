/**
 * Persistent storage for the original uploaded audio song using IndexedDB.
 * Ensures the original audio File/Blob survives browser reloads, hot reloads,
 * and page transitions without losing the audio payload or requiring re-transcription.
 */

const DB_NAME = 'karaoke_studio_audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'original_audio_files';
const CURRENT_AUDIO_KEY = 'active_project_original_audio';
const CURRENT_VOCAL_KEY = 'active_project_vocal_audio';

export interface StoredAudioRecord {
  key: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  updatedAt: number;
}

function openAudioDatabase(): Promise<IDBDatabase> {
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

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'));
    };
  });
}

/**
 * Save the original audio File/Blob to IndexedDB.
 */
export async function saveOriginalAudioBlob(
  fileOrBlob: File | Blob,
  fileName?: string
): Promise<void> {
  try {
    const db = await openAudioDatabase();
    const name = fileName || (fileOrBlob as File).name || 'original_song.mp3';
    const type = fileOrBlob.type || 'audio/mpeg';
    const size = fileOrBlob.size;

    const record: StoredAudioRecord = {
      key: CURRENT_AUDIO_KEY,
      blob: fileOrBlob,
      name,
      type,
      size,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const putRequest = store.put(record);

      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    });
  } catch (error) {
    console.warn('[AudioStorage] Failed to save original audio to IndexedDB:', error);
  }
}

/**
 * Retrieve the original audio File/Blob from IndexedDB.
 */
export async function getOriginalAudioBlob(): Promise<{
  file: File;
  blob: Blob;
  name: string;
  size: number;
  type: string;
} | null> {
  try {
    const db = await openAudioDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(CURRENT_AUDIO_KEY);

      getRequest.onsuccess = () => {
        const record = getRequest.result as StoredAudioRecord | undefined;
        if (!record || !record.blob) {
          return resolve(null);
        }

        const restoredFile = new File([record.blob], record.name || 'original_song.mp3', {
          type: record.type || record.blob.type || 'audio/mpeg',
          lastModified: record.updatedAt || Date.now(),
        });

        resolve({
          file: restoredFile,
          blob: record.blob,
          name: record.name || 'original_song.mp3',
          size: record.size || record.blob.size,
          type: record.type || record.blob.type || 'audio/mpeg',
        });
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  } catch (error) {
    console.warn('[AudioStorage] Failed to get original audio from IndexedDB:', error);
    return null;
  }
}

/**
 * Clear the stored original audio from IndexedDB.
 */
export async function clearOriginalAudioBlob(): Promise<void> {
  try {
    const db = await openAudioDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const deleteRequest = store.delete(CURRENT_AUDIO_KEY);

      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  } catch (error) {
    console.warn('[AudioStorage] Failed to delete original audio from IndexedDB:', error);
  }
}

/** Keep the unmodified vocal stem for the waveform after a page reload. */
export async function saveVocalAudioBlob(file: File): Promise<void> {
  try {
    const db = await openAudioDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        key: CURRENT_VOCAL_KEY,
        blob: file,
        name: file.name,
        type: file.type,
        size: file.size,
        updatedAt: Date.now(),
      } satisfies StoredAudioRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn('[AudioStorage] Failed to save vocal audio to IndexedDB:', error);
  }
}

export async function getVocalAudioBlob(): Promise<File | null> {
  try {
    const db = await openAudioDatabase();
    return await new Promise<File | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(CURRENT_VOCAL_KEY);
      request.onsuccess = () => {
        const record = request.result as StoredAudioRecord | undefined;
        resolve(record?.blob
          ? new File([record.blob], record.name || 'vocal.wav', {
              type: record.type || record.blob.type,
              lastModified: record.updatedAt || Date.now(),
            })
          : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('[AudioStorage] Failed to restore vocal audio from IndexedDB:', error);
    return null;
  }
}

export async function clearVocalAudioBlob(): Promise<void> {
  try {
    const db = await openAudioDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(CURRENT_VOCAL_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn('[AudioStorage] Failed to delete vocal audio from IndexedDB:', error);
  }
}
