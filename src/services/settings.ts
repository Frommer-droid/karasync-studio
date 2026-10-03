/**
 * Локальные настройки приложения (localStorage).
 * API-ключ хранится только в браузере пользователя и отправляется
 * вместе с запросом транскрибации — никуда больше не передаётся.
 */

const GEMINI_KEY_STORAGE_KEY = 'karasync_gemini_api_key';

export function getApiKey(): string {
  try {
    return (localStorage.getItem(GEMINI_KEY_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    const clean = (key || '').trim();
    if (clean) {
      localStorage.setItem(GEMINI_KEY_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
    }
  } catch {
    // ignore (private mode etc.)
  }
}
