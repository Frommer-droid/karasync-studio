import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getCoverWindows, coverClipTime } from './coverVideo';
import type { LineTiming } from './types';

function mkLine(text: string, start: number, end: number): LineTiming {
  return {
    id: `line-${start}`,
    text,
    start,
    end,
    words: [{ id: `w-${start}`, text, start, end } as LineTiming['words'][number],
    ],
    lineIndex: 0,
  };
}

describe('Cover video windows', () => {
  const lines = [mkLine('первая', 20, 24), mkLine('середина', 50, 54), mkLine('последняя', 100, 104)];

  it('should cover from zero until two seconds before the first line', () => {
    const w = getCoverWindows(lines, { enabledIntro: true, enabledOutro: false });
    assert.deepStrictEqual(w.intro, { start: 0, end: 18 });
    assert.strictEqual(w.outroStart, null);
  });

  it('should start outro after the last line disappears (end + hold)', () => {
    const w = getCoverWindows(lines, { enabledIntro: false, enabledOutro: true });
    assert.strictEqual(w.intro, null);
    assert.strictEqual(w.outroStart, 106);
  });

  it('should return no windows when disabled or lines missing', () => {
    assert.deepStrictEqual(getCoverWindows(lines, { enabledIntro: false, enabledOutro: false }), {
      intro: null,
      outroStart: null,
    });
    assert.deepStrictEqual(getCoverWindows([], { enabledIntro: true, enabledOutro: true }), {
      intro: null,
      outroStart: null,
    });
  });

  it('should skip intro when the first line starts within the lead-in', () => {
    const w = getCoverWindows([mkLine('рано', 1, 3)], { enabledIntro: true, enabledOutro: false });
    assert.strictEqual(w.intro, null);
  });

  it('should loop clip time inside a window', () => {
    assert.strictEqual(coverClipTime(0, 0, 10), 0);
    assert.strictEqual(coverClipTime(3, 0, 10), 3);
    assert.strictEqual(coverClipTime(13, 0, 10), 3);
    assert.strictEqual(coverClipTime(106, 106, 10), 0);
    assert.strictEqual(coverClipTime(119.5, 106, 10), 3.5);
    assert.strictEqual(coverClipTime(5, 0, 0), 0);
  });
});
