import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FONT_CATALOG, getFontById, DEFAULT_FONT_ID } from './fonts';

describe('Karaoke font catalog', () => {
  it('should resolve known ids and fall back to default', () => {
    assert.strictEqual(getFontById('oswald').label, 'Oswald (узкий)');
    assert.strictEqual(getFontById('nope').id, DEFAULT_FONT_ID);
    assert.strictEqual(getFontById(undefined).id, DEFAULT_FONT_ID);
  });

  it('should have non-empty stacks and google families for web fonts', () => {
    assert.ok(FONT_CATALOG.length >= 6);
    for (const font of FONT_CATALOG) {
      assert.ok(font.stack.length > 0, font.id);
      if (font.google) {
        assert.ok(font.stack.includes(font.google), font.id);
      }
    }
  });

  it('should only use cyrillic-safe google fonts', () => {
    const googleFamilies = FONT_CATALOG.filter((f) => f.google).map((f) => f.google);
    assert.ok(googleFamilies.length > 0);
    for (const family of googleFamilies) {
      assert.match(family as string, /^[A-Za-z ]+$/);
    }
  });
});
