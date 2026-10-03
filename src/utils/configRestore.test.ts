import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeRestoredVideoConfig } from './configRestore';
import type { VideoPreviewConfig } from '../../shared/types';

function baseConfig(): VideoPreviewConfig {
  return {
    backgroundImageUrl: null,
    backgroundDim: 40,
    backgroundBlur: 0,
    fontSize: 'medium',
    textPosition: 'lower_third',
    strokeWidth: 3,
    backdropOpacity: 85,
    karaokeColor: '#56FFFC',
    textColor: '#ffffff',
    showNextLine: true,
  };
}

describe('Restored config normalization', () => {
  it('should drop dead blob: background URLs', () => {
    const out = normalizeRestoredVideoConfig({
      ...baseConfig(),
      backgroundImageUrl: 'blob:http://localhost/dead-beef',
    });
    assert.strictEqual(out.backgroundImageUrl, null);
  });

  it('should keep live http(s) background URLs and the rest intact', () => {
    const out = normalizeRestoredVideoConfig({
      ...baseConfig(),
      backgroundImageUrl: 'https://example.com/bg.jpg',
      fontSizePx: 42,
    });
    assert.strictEqual(out.backgroundImageUrl, 'https://example.com/bg.jpg');
    assert.strictEqual(out.fontSizePx, 42);
  });

  it('should not mutate the input object', () => {
    const input = { ...baseConfig(), backgroundImageUrl: 'blob:x' };
    normalizeRestoredVideoConfig(input);
    assert.strictEqual(input.backgroundImageUrl, 'blob:x');
  });
});
