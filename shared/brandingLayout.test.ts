import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeBrandingLayout, centerTitleBlockShift, composeCenteredTitleBlock } from './brandingLayout';
describe('Branding header layout', () => {
  it('should keep all elements inside the frame at 1080p', () => {
    const l = computeBrandingLayout(1920, 1080);
    assert.ok(l.logo.cx - l.logo.r >= 0 && l.logo.cx + l.logo.r <= 1920);
    assert.ok(l.logo.cy - l.logo.r >= 0);
    assert.ok(l.author.cx - l.author.r >= 0 && l.author.cx + l.author.r <= 1920);
    assert.ok(l.qr.x >= 0 && l.qr.x + l.qr.size <= 1920 && l.qr.y >= 0);
    assert.ok(l.title.x >= 0 && l.title.x < 1920);
    assert.ok(l.sublines.firstBaselineY + 2 * l.sublines.stepY < 1080);
  });

  it('should order elements left to right: logo, author, title, qr', () => {
    const l = computeBrandingLayout(1920, 1080);
    assert.ok(l.logo.cx < l.author.cx);
    assert.ok(l.author.cx + l.author.r < l.title.x);
    assert.ok(l.title.x < l.qr.x);
  });

  it('should scale linearly with frame size', () => {
    const a = computeBrandingLayout(1920, 1080);
    const b = computeBrandingLayout(1280, 720);
    const ratio = 1280 / 1920;
    assert.ok(Math.abs(b.logo.cx - a.logo.cx * ratio) < 0.01);
    assert.ok(Math.abs(b.qr.size - a.qr.size * ratio) < 0.01);
    assert.ok(Math.abs(b.title.fontPx - a.title.fontPx * ratio) < 0.5);
  });

  it('should apply placement scale and offsets', () => {
    const base = computeBrandingLayout(1920, 1080);
    const mod = computeBrandingLayout(1920, 1080, {
      logo: { scale: 200, dx: 10, dy: -5 },
      author: { scale: 150, dx: -4, dy: 2 },
      qr: { scale: 50, dx: 0, dy: 0 },
      title: { scale: 100, dx: 0, dy: 0 },
    });
    assert.ok(Math.abs(mod.logo.r - base.logo.r * 2) < 0.01);
    assert.ok(Math.abs(mod.logo.cx - (base.logo.cx + 192)) < 0.01);
    assert.ok(Math.abs(mod.logo.cy - (base.logo.cy - 54)) < 0.01);
    assert.ok(Math.abs(mod.qr.size - base.qr.size * 0.5) < 0.01);
    assert.ok(Math.abs(mod.author.r - base.author.r * 1.5) < 0.01);
    assert.ok(Math.abs(mod.author.cx - (base.author.cx - 76.8)) < 0.01);
    // title untouched
    assert.strictEqual(mod.title.fontPx, base.title.fontPx);
  });

  it('should clamp placement to safe ranges', () => {
    const mod = computeBrandingLayout(1920, 1080, {
      logo: { scale: 500, dx: 100, dy: -100 },
      author: { scale: 100, dx: 0, dy: 0 },
      qr: { scale: 0, dx: 0, dy: 0 },
      title: { scale: 100, dx: 0, dy: 0 },
    });
    const base = computeBrandingLayout(1920, 1080);
    assert.ok(Math.abs(mod.logo.r - base.logo.r * 2) < 0.01);
    assert.ok(Math.abs(mod.logo.cx - (base.logo.cx + 384)) < 0.01);
    assert.ok(Math.abs(mod.qr.size - base.qr.size * 0.5) < 0.01);
  });

  it('should move song title independently from sublines', () => {
    const base = computeBrandingLayout(1920, 1080);
    const mod = computeBrandingLayout(1920, 1080, {
      logo: { scale: 100, dx: 0, dy: 0 },
      author: { scale: 100, dx: 0, dy: 0 },
      qr: { scale: 100, dx: 0, dy: 0 },
      title: { scale: 100, dx: 0, dy: 0 },
      songTitle: { scale: 150, dx: 5, dy: -3 },
    });
    // Название уехало и выросло, строки на месте
    assert.ok(Math.abs(mod.title.x - (base.title.x + 96)) < 0.01);
    assert.ok(Math.abs(mod.title.baselineY - (base.title.baselineY - 32.4)) < 0.01);
    assert.ok(Math.abs(mod.title.fontPx - base.title.fontPx * 1.5) < 0.01);
    assert.strictEqual(mod.sublines.x, base.sublines.x);
    assert.strictEqual(mod.sublines.firstBaselineY, base.sublines.firstBaselineY);
    assert.strictEqual(mod.sublines.fontPx, base.sublines.fontPx);
  });

  it('should center the joint author+text block', () => {
    const l = computeBrandingLayout(1920, 1080);
    // Заглушка замера: ширина = 10px на символ независимо от кегля
    const measure = (text: string) => text.length * 10;
    const shift = centerTitleBlockShift(
      l, 1920,
      { title: 'ABCDE', sublines: ['AB', '', 'ABCDEFGH'], titleFontPx: 62, subFontPx: 47 },
      measure,
    );
    // titleW=50, subsW=80; textRight = title.x+80
    const left = Math.min(l.author.cx - l.author.r, l.title.x);
    const right = Math.max(l.author.cx + l.author.r, l.title.x + 80);
    assert.ok(Math.abs(shift - (960 - (left + right) / 2)) < 0.01);
    // Пустые тексты: правая граница всё равно по якорю title.x
    const shiftEmpty = centerTitleBlockShift(
      l, 1920,
      { title: '   ', sublines: ['', ' '], titleFontPx: 62, subFontPx: 47 },
      measure,
    );
    const leftEmpty = Math.min(l.author.cx - l.author.r, l.title.x);
    const rightEmpty = Math.max(l.author.cx + l.author.r, l.title.x);
    assert.ok(Math.abs(shiftEmpty - (960 - (leftEmpty + rightEmpty) / 2)) < 0.01);
  });

  it('should scale sublines step with lineSpacing', () => {
    const base = computeBrandingLayout(1920, 1080);
    const wide = computeBrandingLayout(1920, 1080, undefined, 200);
    const narrow = computeBrandingLayout(1920, 1080, undefined, 50);
    assert.ok(Math.abs(wide.sublines.stepY - base.sublines.stepY * 2) < 0.01);
    assert.ok(Math.abs(narrow.sublines.stepY - base.sublines.stepY * 0.5) < 0.01);
    // Отступ названия от первой строки не трогаем
    assert.ok(Math.abs(wide.sublines.firstBaselineY - base.sublines.firstBaselineY) < 0.01);
  });

  it('should center current arrangement as one container without re-gluing', () => {
    const l = computeBrandingLayout(1920, 1080);
    // measure: 10px на символ
    const measure = (text: string) => text.length * 10;
    const comp = composeCenteredTitleBlock(
      l, 1920,
      { text: 'ABCDE', fontPx: l.title.fontPx },
      [
        { text: 'AB', fontPx: l.sublines.fontPx },
        { text: '', fontPx: l.sublines.fontPx },
        { text: 'ABCDEFGH', fontPx: l.sublines.fontPx },
      ],
      measure,
    );
    // titleW=50, subsW=80 → textRight = title.x+80; фото осталось где было
    const left = Math.min(l.author.cx - l.author.r, l.title.x);
    const right = Math.max(l.author.cx + l.author.r, l.title.x + 80);
    const shift = 960 - (left + right) / 2;
    assert.ok(Math.abs(comp.authorCx - (l.author.cx + shift)) < 0.01);
    assert.ok(Math.abs(comp.titleX - (l.title.x + shift)) < 0.01);
    assert.ok(Math.abs(comp.sublinesX - (l.sublines.x + shift)) < 0.01);
    // Компактный блок действительно по центру
    const finalLeft = Math.min(comp.authorCx - l.author.r, comp.titleX);
    const finalRight = Math.max(comp.authorCx + l.author.r, comp.titleX + 80);
    assert.ok(Math.abs((finalLeft + finalRight) / 2 - 960) < 0.01);
    // Вертикаль фото не трогаем — как была
    assert.strictEqual(comp.authorCy, l.author.cy);
  });

  it('should preserve relative offsets of photo/title/sublines when centering', () => {
    const l = computeBrandingLayout(1920, 1080, {
      logo: { scale: 100, dx: 0, dy: 0 },
      author: { scale: 100, dx: 5, dy: 2 },
      qr: { scale: 100, dx: 0, dy: 0 },
      title: { scale: 100, dx: -2, dy: 0 },
      songTitle: { scale: 100, dx: 3, dy: 1 },
    });
    const measure = (text: string) => text.length * 10;
    const comp = composeCenteredTitleBlock(
      l, 1920,
      { text: 'ABC', fontPx: l.title.fontPx },
      [{ text: 'AB', fontPx: l.sublines.fontPx }],
      measure,
    );
    // Взаимные смещения сохранились один в один
    assert.ok(Math.abs((comp.authorCx - comp.titleX) - (l.author.cx - l.title.x)) < 0.01);
    assert.ok(Math.abs((comp.titleX - comp.sublinesX) - (l.title.x - l.sublines.x)) < 0.01);
    assert.strictEqual(comp.authorCy, l.author.cy);
  });
});
