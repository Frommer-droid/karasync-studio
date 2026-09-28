import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeAutoFitFontPx,
  fontPx1080ToCqw,
  AUTO_FIT_MAX_PX,
  AUTO_FIT_MIN_PX,
} from './fontFit';

describe('Auto-fit font size to longest line', () => {
  // measure stub: ширина = длина * 2500 при кегле 100px (ratio = длина * 25)
  const stub = (text: string) => text.length * 2500;

  it('should size by the longest line: 1920*0.92/ratio', () => {
    // longest 'aaa' (1 слово, без зазоров) -> ratio 75 -> 1920*0.92/75 = 23.55 -> 24
    assert.strictEqual(computeAutoFitFontPx([{ text: 'a' }, { text: 'aaa' }], stub), 24);
  });

  it('should account for inter-word gaps: more words = smaller size', () => {
    // measure 3000: 'a b' -> (3000+3000+3000)/100 = 90 -> 19.63 -> 20;
    // 'ab' -> 3000/100 = 30 -> 58.88 -> 59
    assert.strictEqual(computeAutoFitFontPx([{ text: 'a b' }], () => 3000), 20);
    assert.strictEqual(computeAutoFitFontPx([{ text: 'ab' }], () => 3000), 59);
  });

  it('should sum words and natural spaces exactly as canvas draws', () => {
    const widths: Record<string, number> = { hello: 4000, world: 5000, ' ': 1000 };
    const measure = (t: string) => widths[t] ?? 0;
    // 'hello world' -> (4000+5000+1000)/100 = 100 -> 1920*0.92/100 = 17.66 -> 18
    assert.strictEqual(computeAutoFitFontPx([{ text: 'hello world' }], measure), 18);
  });

  it('should clamp to max for very short lines', () => {
    assert.strictEqual(computeAutoFitFontPx([{ text: 'я' }], () => 1), AUTO_FIT_MAX_PX);
  });

  it('should clamp to min for extremely long lines', () => {
    assert.strictEqual(computeAutoFitFontPx([{ text: 'x'.repeat(500) }], (t) => t.length * 100000), AUTO_FIT_MIN_PX);
  });

  it('should return null when there is nothing measurable', () => {
    assert.strictEqual(computeAutoFitFontPx([], stub), null);
    assert.strictEqual(computeAutoFitFontPx([{ text: '   ' }], stub), null);
    assert.strictEqual(computeAutoFitFontPx([{ text: 'abc' }], () => 0), null);
  });

  it('should convert 1080p px to cqw for 16:9 preview', () => {
    // 50px@1080p на кадре H=540 => 25px; контейнер W=960 => 25/960*100 = 2.604cqw
    assert.ok(Math.abs(fontPx1080ToCqw(50) - 2.604) < 0.01);
  });
});
