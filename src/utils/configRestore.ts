import type { VideoPreviewConfig } from '../../shared/types';

/**
 * Чистит конфиг оформления, прочитанный из localStorage:
 * blob:-URL (фон, созданный URL.createObjectURL) умирают вместе с сессией —
 * их сбрасываем, живое восстанавливается из IndexedDB по id отдельно.
 * Чистая функция — покрыта тестами.
 */
export function normalizeRestoredVideoConfig(config: VideoPreviewConfig): VideoPreviewConfig {
  const restored: VideoPreviewConfig = { ...config };
  if (
    typeof restored.backgroundImageUrl === 'string' &&
    restored.backgroundImageUrl.startsWith('blob:')
  ) {
    restored.backgroundImageUrl = null;
  }
  return restored;
}
