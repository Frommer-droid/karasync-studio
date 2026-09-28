import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { VideoPreviewConfig } from '../../shared/types';
import { DEFAULT_BRANDING } from '../../shared/types';
import {
  buildPresetFile,
  parsePresetFile,
  downloadPreset,
  blobToDataURL,
  dataURLToBlob,
  presetFileName,
  PRESET_APP_MARKER,
  PRESET_FILE_VERSION,
} from './presets';

function baseConfig(): VideoPreviewConfig {
  return {
    fontFamily: 'inter',
    fontSize: 'medium',
    textPosition: 'lower_third',
    backgroundColor: '#231825',
    textColor: '#ffffff',
    karaokeColor: '#56FFFC',
    showNextLine: true,
    backgroundImageUrl: 'blob:http://localhost/dead',
    backgroundImageId: 'background_image',
    branding: {
      ...DEFAULT_BRANDING,
      title: 'Название',
      line1: 'Строка 1',
      logoImageId: 'branding_logo',
    },
  } as VideoPreviewConfig;
}

describe('Design presets', () => {
  it('should round-trip config and images through JSON', async () => {
    const logo = new Blob(['logo-bytes'], { type: 'image/png' });
    const preset = await buildPresetFile(baseConfig(), 'Мой пресет', { logo });
    const json = JSON.stringify(preset);
    const parsed = parsePresetFile(JSON.parse(json));

    assert.strictEqual(parsed.app, PRESET_APP_MARKER);
    assert.strictEqual(parsed.version, PRESET_FILE_VERSION);
    assert.strictEqual(parsed.name, 'Мой пресет');
    // Тексты шапки едут вместе с оформлением
    assert.strictEqual(parsed.videoConfig.branding?.title, 'Название');
    assert.strictEqual(parsed.videoConfig.branding?.line1, 'Строка 1');
    // Позиции и цвета на месте
    assert.strictEqual(parsed.videoConfig.textPosition, 'lower_third');
    // Картинка пережила сериализацию
    const back = dataURLToBlob(parsed.images.logo as string);
    assert.strictEqual(back.type, 'image/png');
    assert.strictEqual(await back.text(), 'logo-bytes');
  });

  it('should strip dead blob URLs and image ids on export', async () => {
    const preset = await buildPresetFile(baseConfig(), 'x', {});
    assert.strictEqual(preset.videoConfig.backgroundImageUrl, null);
    assert.strictEqual(preset.videoConfig.backgroundImageId, null);
    assert.strictEqual(preset.videoConfig.branding?.logoImageId, null);
    assert.strictEqual(preset.videoConfig.backgroundVideo, null);
    assert.deepStrictEqual(preset.images, {});
  });

  it('should reject foreign files with a clear error', () => {
    assert.throws(() => parsePresetFile(null), /пресета/);
    assert.throws(() => parsePresetFile({ app: 'other', version: 1 }), /не файл пресета/);
    assert.throws(
      () => parsePresetFile({ app: PRESET_APP_MARKER, version: 999, videoConfig: {} }),
      /версия/,
    );
    assert.throws(
      () => parsePresetFile({ app: PRESET_APP_MARKER, version: PRESET_FILE_VERSION }),
      /настроек/,
    );
  });

  it('should ignore non-dataURL image slots on import', () => {
    const parsed = parsePresetFile({
      app: PRESET_APP_MARKER,
      version: PRESET_FILE_VERSION,
      name: 'p',
      videoConfig: baseConfig(),
      images: { logo: 'not-a-data-url', qr: 42 },
    });
    assert.deepStrictEqual(parsed.images, {});
  });

  it('should convert blob to dataURL and back', async () => {
    const url = await blobToDataURL(new Blob(['abc'], { type: 'image/jpeg' }));
    assert.ok(url.startsWith('data:image/jpeg;base64,'));
    assert.strictEqual(await dataURLToBlob(url).text(), 'abc');
    assert.throws(() => dataURLToBlob('garbage'), /dataURL/);
  });

  it('should decode dataURL without Buffer (browser path)', async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.Buffer;
    try {
      g.Buffer = undefined;
      const blob = dataURLToBlob('data:image/png;base64,YWJj');
      assert.strictEqual(blob.type, 'image/png');
      assert.strictEqual(await blob.text(), 'abc');
    } finally {
      g.Buffer = saved;
    }
  });

  it('should save through the desktop bridge when running in Electron', async () => {
    const g = globalThis as Record<string, unknown>;
    const savedWindow = g.window;
    const calls: Array<{ fileName: string; text: string }> = [];
    g.window = {
      karaokeStudio: {
        saveTextFile: async (payload: { fileName: string; text: string }) => {
          calls.push(payload);
          return { saved: true, filePath: '/tmp/x.json' };
        },
      },
    };
    try {
      const preset = await buildPresetFile(baseConfig(), 'Мост', {});
      const result = await downloadPreset(preset);
      assert.strictEqual(result, 'saved');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].fileName, 'Мост.karasync-preset.json');
      assert.ok(calls[0].text.includes(PRESET_APP_MARKER));
    } finally {
      if (savedWindow === undefined) delete g.window;
      else g.window = savedWindow;
    }
  });

  it('should build a safe file name', () => {
    assert.strictEqual(presetFileName('Мой пресет'), 'Мой пресет.karasync-preset.json');
    assert.ok(!presetFileName('a/b\\c:d*e?f"g<h>i|j').includes('/'));
  });
});
