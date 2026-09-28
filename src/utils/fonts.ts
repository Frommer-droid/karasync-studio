/**
 * Каталог шрифтов для караоке-строк.
 * Системные стеки работают офлайн; Google Fonts (все с кириллицей)
 * подгружаются по требованию через <link> + document.fonts.load.
 */

export interface KaraokeFont {
  id: string;
  label: string;
  stack: string;
  /** Google Font: подгрузить перед использованием. */
  google?: string;
}

export const DEFAULT_FONT_ID = 'inter';

export const DEFAULT_FONT_STACK =
  'Inter, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export const FONT_CATALOG: KaraokeFont[] = [
  { id: 'inter', label: 'Inter', stack: DEFAULT_FONT_STACK },
  {
    id: 'system',
    label: 'Системный',
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  { id: 'arial', label: 'Arial', stack: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, Tahoma, sans-serif' },
  { id: 'georgia', label: 'Georgia (с засечками)', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Моноширинный', stack: 'Consolas, "Courier New", monospace' },
  {
    id: 'montserrat',
    label: 'Montserrat',
    stack: `Montserrat, ${DEFAULT_FONT_STACK}`,
    google: 'Montserrat',
  },
  {
    id: 'oswald',
    label: 'Oswald (узкий)',
    stack: `Oswald, ${DEFAULT_FONT_STACK}`,
    google: 'Oswald',
  },
  {
    id: 'bebas',
    label: 'Bebas Neue (плакатный)',
    stack: `"Bebas Neue", ${DEFAULT_FONT_STACK}`,
    google: 'Bebas Neue',
  },
  {
    id: 'lobster',
    label: 'Lobster (рукописный)',
    stack: `Lobster, ${DEFAULT_FONT_STACK}`,
    google: 'Lobster',
  },
];

export function getFontById(id: string | undefined): KaraokeFont {
  return FONT_CATALOG.find((f) => f.id === id) || FONT_CATALOG[0];
}

const loadedGoogleFonts = new Set<string>();

function injectGoogleFontLink(family: string): void {
  if (typeof document === 'undefined') return;
  const linkId = `karaoke-google-font-${family.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@0,500;0,700;0,800;1,500&display=swap`;
  document.head.appendChild(link);
}

/**
 * Гарантирует, что шрифт загружен (для canvas-замера и отрисовки).
 * В офлайне/при ошибке молча откатывается на fallback из стека.
 */
export async function ensureFontLoaded(id: string | undefined): Promise<void> {
  const font = getFontById(id);
  if (!font.google || typeof document === 'undefined') return;
  if (loadedGoogleFonts.has(font.google)) return;
  try {
    injectGoogleFontLink(font.google);
    const faces = document.fonts;
    if (faces) {
      await Promise.all([
        faces.load(`400 100px "${font.google}"`),
        faces.load(`500 100px "${font.google}"`),
        faces.load(`700 100px "${font.google}"`),
        faces.load(`800 100px "${font.google}"`),
        faces.load(`900 100px "${font.google}"`),
        faces.load(`italic 500 100px "${font.google}"`),
      ]);
    } else {
      // Без Font Loading API просто ждём применение stylesheet.
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    loadedGoogleFonts.add(font.google);
  } catch {
    // Игнорируем: отрисовка пойдёт fallback-шрифтом из стека.
  }
}
