import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderKaraokeCanvasFrame } from './canvasKaraokeRenderer';
import { DEFAULT_BRANDING } from './types';
import type { LineTiming, VideoPreviewConfig } from './types';

describe('Canvas word highlighting', () => {
  it('draws whole words in one color as soon as each starts', () => {
    const line: LineTiming = {
      id: 'line', text: 'Первое второе', start: 1, end: 2.5,
      words: [
        { id: 'first', text: 'Первое', start: 1, end: 1.4 },
        { id: 'second', text: 'второе', start: 2, end: 2.5 },
      ],
    };
    const config = {
      backgroundColor: '#000000', textColor: '#ffffff', karaokeColor: '#00ffff',
    } as VideoPreviewConfig;

    const drawAt = (currentTime: number) => {
      const words: { text: string; color: string }[] = [];
      const ctx = {
        fillStyle: '',
        clearRect() {}, fillRect() {}, save() {}, restore() {},
        measureText(text: string) { return { width: text.length * 10 }; },
        fillText(text: string) { words.push({ text, color: this.fillStyle }); },
      } as unknown as CanvasRenderingContext2D;

      renderKaraokeCanvasFrame({
        ctx, width: 1920, height: 1080,
        topLine: line, bottomLine: null, currentTime, config,
        showLiveBadge: false,
      });
      return words;
    };

    assert.deepStrictEqual(drawAt(0.999), [
      { text: 'Первое', color: '#ffffff' },
      { text: 'второе', color: '#ffffff' },
    ]);
    assert.deepStrictEqual(drawAt(1), [
      { text: 'Первое', color: '#00ffff' },
      { text: 'второе', color: '#ffffff' },
    ]);
    assert.deepStrictEqual(drawAt(1.6), [
      { text: 'Первое', color: '#00ffff' },
      { text: 'второе', color: '#ffffff' },
    ]);
    assert.deepStrictEqual(drawAt(2), [
      { text: 'Первое', color: '#00ffff' },
      { text: 'второе', color: '#00ffff' },
    ]);
  });
});

describe('Branding author photo visibility', () => {
  it('keeps the title and lines in the exported frame when the author photo is hidden', () => {
    const drawnTexts: string[] = [];
    let drawnImages = 0;
    const ctx = {
      clearRect() {}, fillRect() {}, save() {}, restore() {},
      fillText(text: string) { drawnTexts.push(text); },
      drawImage() { drawnImages += 1; },
    } as unknown as CanvasRenderingContext2D;
    const config = {
      backgroundColor: '#231825',
      branding: {
        ...DEFAULT_BRANDING,
        showTitle: false,
        authorImageId: 'author-photo',
        title: 'Название песни',
        line1: 'Первая строка',
      },
    } as VideoPreviewConfig;

    renderKaraokeCanvasFrame({
      ctx, width: 1920, height: 1080,
      topLine: null, bottomLine: null, currentTime: 0, config,
      brandingImages: { author: {} as CanvasImageSource },
      showLiveBadge: false,
    });

    assert.deepStrictEqual(drawnTexts, ['Название песни', 'Первая строка']);
    assert.strictEqual(drawnImages, 0);
  });
});
