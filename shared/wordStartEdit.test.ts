import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canShiftAllWordTimings, deleteWord, getWordStartBounds, moveWordStart, shiftAllWordTimings } from './wordStartEdit';
import type { LineTiming, WordTiming } from './types';

const words: WordTiming[] = [
  { id: 'a', text: 'раз', start: 1, end: 1.8 },
  { id: 'b', text: 'два', start: 2, end: 2.2, timingSource: 'gemini', isLowConfidence: true },
  { id: 'c', text: 'три', start: 3, end: 3.5 },
];
const lines: LineTiming[] = [{ id: 'line', text: 'раз два три', start: 1, end: 3.5, words }];

describe('Editing a word start on the waveform', () => {
  it('changes only the chosen start and keeps line and flat words in sync', () => {
    const result = moveWordStart(words, lines, 'b', 1.65, 5);
    assert.ok(result);
    assert.equal(result.start, 1.65);
    assert.deepEqual(result.words.map((word) => word.start), [1, 1.65, 3]);
    assert.equal(result.words[0].end, 1.65);
    assert.equal(result.words[1].end, 2.2);
    assert.equal(result.words[1].timingSource, 'manual');
    assert.equal(result.words[1].isLowConfidence, false);
    assert.equal(result.lines[0].words[1], result.words[1]);
  });

  it('allows moving a start past its old end without moving the next word', () => {
    const result = moveWordStart(words, lines, 'b', 2.7, 5);
    assert.ok(result);
    assert.equal(result.words[1].start, 2.7);
    assert.equal(result.words[1].end, 2.75);
    assert.equal(result.words[2].start, 3);
  });

  it('keeps the marker between neighboring starts and updates the line start', () => {
    assert.deepEqual(getWordStartBounds(words, 1, 5), { min: 1.05, max: 2.95 });
    const result = moveWordStart(words, lines, 'a', 0.4, 5);
    assert.ok(result);
    assert.equal(result.lines[0].start, 0.4);
    assert.equal(result.lines[0].words[0].start, 0.4);
    assert.equal(moveWordStart(words, lines, 'missing', 1, 5), null);
  });

  it('also edits a word that is not assigned to a lyric line', () => {
    const extra: WordTiming = { id: 'extra', text: 'эхо', start: 4, end: 4.3 };
    const result = moveWordStart([...words, extra], lines, 'extra', 4.1, 5);
    assert.ok(result);
    assert.equal(result.words[3].start, 4.1);
    assert.equal(result.lines[0], lines[0]);
  });
});

describe('Shifting all word markers together', () => {
  it('moves every start and end by one step and keeps line words in sync', () => {
    const result = shiftAllWordTimings(words, lines, 0.1, 5);
    assert.ok(result);
    assert.deepEqual(result.words.map((word) => word.start), [1.1, 2.1, 3.1]);
    assert.deepEqual(result.words.map((word) => word.end), [1.9, 2.3, 3.6]);
    assert.equal(result.lines[0].start, 1.1);
    assert.equal(result.lines[0].end, 3.6);
    assert.equal(result.lines[0].words[1], result.words[1]);
    assert.equal(result.words[1].timingSource, 'gemini');
    assert.equal(result.words[1].isLowConfidence, true);
    assert.equal(words[0].start, 1);

    const restored = shiftAllWordTimings(result.words, result.lines, -0.1, 5);
    assert.ok(restored);
    assert.deepEqual(restored.words.map((word) => word.start), [1, 2, 3]);
  });

  it('rejects a step that would place any marker outside the audio', () => {
    const nearStart = [{ ...words[0], start: 0.04 }, ...words.slice(1)];
    assert.equal(canShiftAllWordTimings(nearStart, -0.05, 5), false);
    assert.equal(shiftAllWordTimings(nearStart, lines, -0.05, 5), null);
    assert.equal(canShiftAllWordTimings(words, 0.1, 3.05), false);
    assert.equal(shiftAllWordTimings(words, lines, 0.1, 3.05), null);
    assert.equal(canShiftAllWordTimings(words, 0.05, 0), false);
  });
});

describe('Deleting a word from the waveform', () => {
  it('removes only the chosen id and rebuilds the affected line', () => {
    const result = deleteWord(words, lines, 'b');
    assert.ok(result);
    assert.deepEqual(result.words.map((word) => word.id), ['a', 'c']);
    assert.deepEqual(result.lines[0].words.map((word) => word.id), ['a', 'c']);
    assert.equal(result.lines[0].text, 'раз три');
    assert.equal(result.lines[0].start, 1);
    assert.equal(result.lines[0].end, 3.5);
    assert.equal(result.lines[0].words[1], result.words[1]);
    assert.equal(result.words[1].wordIndexInLine, 1);
    assert.equal(lines[0].text, 'раз два три');
  });

  it('updates bounds after deleting an edge word', () => {
    const first = deleteWord(words, lines, 'a');
    assert.ok(first);
    assert.equal(first.lines[0].start, 2);
    assert.equal(first.lines[0].text, 'два три');

    const last = deleteWord(words, lines, 'c');
    assert.ok(last);
    assert.equal(last.lines[0].end, 2.2);
    assert.equal(last.lines[0].text, 'раз два');
  });

  it('keeps another occurrence with the same text', () => {
    const repeated = [
      { ...words[0], text: 'томится' },
      { ...words[1], text: 'томится' },
    ];
    const result = deleteWord(repeated, [{ ...lines[0], words: repeated }], 'b');
    assert.ok(result);
    assert.deepEqual(result.words.map((word) => word.id), ['a']);
    assert.equal(result.lines[0].text, 'томится');
  });

  it('removes an empty line and reindexes surviving lines', () => {
    const secondLine: LineTiming = {
      id: 'second', text: 'три', start: 3, end: 3.5, words: [words[2]], lineIndex: 1,
    };
    const firstLine: LineTiming = {
      id: 'first', text: 'раз два', start: 1, end: 2.2, words: words.slice(0, 2), lineIndex: 0,
    };
    const result = deleteWord(words, [firstLine, secondLine], 'c');
    assert.ok(result);
    assert.deepEqual(result.lines.map((line) => line.id), ['first']);
    assert.deepEqual(result.words.map((word) => word.id), ['a', 'b']);
    assert.equal(deleteWord([words[2]], [secondLine], 'c')?.lines.length, 0);
    assert.equal(deleteWord(words, lines, 'missing'), null);

    const withoutFirst = deleteWord(words, [
      { id: 'first', text: 'раз', start: 1, end: 1.8, words: [words[0]], lineIndex: 0 },
      { ...secondLine, text: 'Три!', words: [{ ...words[2], lineIndex: 1 }] },
    ], 'a');
    assert.ok(withoutFirst);
    assert.equal(withoutFirst.lines[0].text, 'Три!');
    assert.equal(withoutFirst.lines[0].lineIndex, 0);
    assert.equal(withoutFirst.lines[0].words[0].lineIndex, 0);
  });
});
