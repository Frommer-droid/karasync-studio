/**
 * Мост к main-процессу собранного приложения (Electron).
 * В браузере моста нет — там работают обычные веб-скачивания.
 */

interface DesktopBridge {
  saveTextFile: (payload: { fileName: string; text: string }) => Promise<{
    saved: boolean;
    filePath?: string;
  }>;
}

function getBridge(): DesktopBridge | null {
  try {
    const w = window as unknown as { karaokeStudio?: DesktopBridge };
    if (w.karaokeStudio && typeof w.karaokeStudio.saveTextFile === 'function') {
      return w.karaokeStudio;
    }
  } catch {
    // ignore (SSR/тесты без window)
  }
  return null;
}

/** true — рендер внутри Electron (даже если preload-мост не загрузился). */
export function isElectronRenderer(): boolean {
  try {
    const ua =
      (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/electron/i.test(ua)) return true;
    const w = window as unknown as {
      process?: { versions?: { electron?: string } };
    };
    if (w.process?.versions?.electron) return true;
  } catch {
    // ignore
  }
  return false;
}

/** true — работаем внутри собранного Electron-приложения. */
export function isDesktopApp(): boolean {
  return getBridge() !== null;
}

/**
 * Сохранить текстовый файл через нативный диалог.
 * @returns 'saved' | 'cancelled'. Ошибки кидает исключением.
 */
export async function saveTextFileDesktop(
  fileName: string,
  text: string
): Promise<'saved' | 'cancelled'> {
  const bridge = getBridge();
  if (!bridge) {
    throw new Error('Мост desktop-приложения недоступен');
  }
  const result = await bridge.saveTextFile({ fileName, text });
  return result && result.saved ? 'saved' : 'cancelled';
}
