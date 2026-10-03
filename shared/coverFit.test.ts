import { describe, it } from 'node:test';
import assert from 'node:assert';
import { coverFitRect } from './canvasKaraokeRenderer';

describe('Cover-fit rect keeps aspect ratio', () => {
  it('should fill exactly when aspects match (16:9 -> 1920x1080)', () => {
    assert.deepStrictEqual(coverFitRect(1920, 1080, 1920, 1080), { dx: 0, dy: 0, dw: 1920, dh: 1080 });
  });

  it('should fill width and crop top/bottom for a narrower clip (4:3 -> 16:9)', () => {
    const r = coverFitRect(1440, 1080, 1920, 1080);
    assert.strictEqual(r.dx, 0);
    assert.strictEqual(r.dw, 1920);
    assert.strictEqual(r.dh, 1440);
    assert.strictEqual(r.dy, -180); // верх/низ обрезаны, ширина полная
  });

  it('should crop top/bottom for a vertical clip (9:16 -> 16:9)', () => {
    const r = coverFitRect(1080, 1920, 1920, 1080);
    assert.strictEqual(r.dx, 0);
    assert.strictEqual(r.dw, 1920);
    assert.ok(r.dh > 1080 && r.dy < 0);
  });

  it('should never stretch: output keeps source aspect and covers destination', () => {
    for (const [sw, sh] of [[640, 360], [640, 480], [1080, 1080], [720, 1280], [3840, 2160]] as const) {
      const r = coverFitRect(sw, sh, 1920, 1080);
      assert.ok(Math.abs(r.dw / r.dh - sw / sh) < 1e-9, `${sw}x${sh}`);
      assert.ok(r.dw >= 1920 && r.dh >= 1080);
    }
  });
});
