import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizeForComparison,
  calculateWordSimilarity,
  parseReferenceLyrics,
  alignReferenceWithGemini,
  getKaraokePresentationPair,
  groupWordsIntoLines,
  mergeStandaloneDashTokens,
  calculateWordProgress,
} from './syncAlgorithm';
import { WordTiming, LineTiming } from './types';

describe('Instant word highlighting', () => {
  it('fills each word at its start and keeps it filled through gaps and later words', () => {
    const first = { start: 1, end: 1.4 };
    const second = { start: 2, end: 2.5 };

    assert.strictEqual(calculateWordProgress(0.999, first.start, first.end), 0);
    assert.strictEqual(calculateWordProgress(1, first.start, first.end), 1);
    assert.strictEqual(calculateWordProgress(1.2, first.start, first.end), 1);
    assert.strictEqual(calculateWordProgress(1.6, first.start, first.end), 1);
    assert.strictEqual(calculateWordProgress(1.6, second.start, second.end), 0);
    assert.strictEqual(calculateWordProgress(2, first.start, first.end), 1);
    assert.strictEqual(calculateWordProgress(2, second.start, second.end), 1);
  });

  it('uses the start even for a zero-length word and ignores invalid timestamps', () => {
    assert.strictEqual(calculateWordProgress(3, 3, 3), 1);
    assert.strictEqual(calculateWordProgress(3, 3, Number.NaN), 1);
    assert.strictEqual(calculateWordProgress(3, Number.NaN, 4), 0);
  });
});

describe('Reference Lyrics Alignment Algorithm', () => {
  it('should normalize text for comparison correctly', () => {
    // 1. Lowercase
    assert.strictEqual(normalizeForComparison('Привет'), 'привет');
    // 2. Unicode normalization and Russian ё -> е
    assert.strictEqual(normalizeForComparison('Ещё'), 'еще');
    assert.strictEqual(normalizeForComparison('моё'), 'мое');
    // 3. Typographic quotes and dashes
    assert.strictEqual(normalizeForComparison("don’t"), "don't");
    assert.strictEqual(normalizeForComparison('rock—and—roll'), 'rock-and-roll');
    // 4. Edge punctuation removal
    assert.strictEqual(normalizeForComparison('«Привет...»'), 'привет');
    assert.strictEqual(normalizeForComparison('"Hello,!"'), 'hello');
  });

  it('should calculate word similarity accurately', () => {
    assert.strictEqual(calculateWordSimilarity('Песня', 'песня'), 1.0);
    assert.strictEqual(calculateWordSimilarity('Звёзды', 'звезды'), 1.0);
    assert.strictEqual(calculateWordSimilarity('Привет,', 'привет'), 1.0);
    assert.ok(calculateWordSimilarity('кошка', 'кошки') >= 0.8);
    assert.ok(calculateWordSimilarity('любовь', 'любови') >= 0.8);
    assert.ok(calculateWordSimilarity('автомобиль', 'самолет') <= 0.2);
  });

  it('should preserve original casing and lines in parsed reference lyrics', () => {
    const text = 'Я помню чудное мгновенье:\nПередо мной явилась ты!';
    const { lines, words } = parseReferenceLyrics(text);

    assert.strictEqual(lines.length, 2);
    assert.strictEqual(words.length, 8);
    assert.strictEqual(words[0].originalText, 'Я');
    assert.strictEqual(words[3].originalText, 'мгновенье:');
    assert.strictEqual(words[3].normalizedText, 'мгновенье');
    assert.strictEqual(lines[0].originalText, 'Я помню чудное мгновенье:');
  });

  it('attaches a standalone dash to the preceding word without its own timing', () => {
    const parsed = parseReferenceLyrics('Дом Доротеи – мир мечтанья.');
    assert.deepStrictEqual(parsed.words.map((word) => word.originalText), [
      'Дом',
      'Доротеи –',
      'мир',
      'мечтанья.',
    ]);

    const timedWords: WordTiming[] = [
      { id: '1', text: 'Доротеи', start: 1, end: 1.4 },
      { id: '2', text: '–', start: 1.4, end: 1.8 },
      { id: '3', text: 'мир', start: 1.8, end: 2.1 },
    ];
    const normalizedWords = mergeStandaloneDashTokens(timedWords);
    const lines = groupWordsIntoLines(timedWords);

    assert.deepStrictEqual(normalizedWords.map((word) => word.text), ['Доротеи –', 'мир']);
    assert.strictEqual(normalizedWords[0].end, 1.4);
    assert.strictEqual(lines[0].words.length, 2);
  });

  it('should align exact matches with Gemini transcribed words', () => {
    const refText = 'Я помню чудное мгновенье\nПередо мной явилась ты';
    const geminiWords: WordTiming[] = [
      { id: 'g1', text: 'я', start: 1.0, end: 1.2, confidence: 0.95 },
      { id: 'g2', text: 'помню', start: 1.3, end: 1.8, confidence: 0.98 },
      { id: 'g3', text: 'чудное', start: 1.9, end: 2.5, confidence: 0.96 },
      { id: 'g4', text: 'мгновенье', start: 2.6, end: 3.4, confidence: 0.97 },
      { id: 'g5', text: 'передо', start: 4.0, end: 4.4, confidence: 0.95 },
      { id: 'g6', text: 'мной', start: 4.5, end: 4.8, confidence: 0.99 },
      { id: 'g7', text: 'явилась', start: 4.9, end: 5.4, confidence: 0.94 },
      { id: 'g8', text: 'ты', start: 5.5, end: 5.9, confidence: 0.98 },
    ];

    const result = alignReferenceWithGemini(refText, geminiWords);

    assert.strictEqual(result.alignedWords.length, 8);
    assert.strictEqual(result.stats.exactMatches, 8);
    assert.strictEqual(result.stats.interpolated, 0);
    // Preserves original casing
    assert.strictEqual(result.alignedWords[0].text, 'Я');
    assert.strictEqual(result.alignedWords[0].start, 1.0);
    assert.strictEqual(result.alignedWords[0].timingSource, 'gemini');

    // Lines start and end calculation
    assert.strictEqual(result.alignedLines.length, 2);
    assert.strictEqual(result.alignedLines[0].start, 1.0);
    assert.strictEqual(result.alignedLines[0].end, 3.4);
    assert.strictEqual(result.alignedLines[1].start, 4.0);
    assert.strictEqual(result.alignedLines[1].end, 5.9);
  });

  it('should interpolate missing words when Gemini skipped a word', () => {
    // Reference has 4 words: "В небе светит луна"
    // Gemini missed "светит"
    const refText = 'В небе светит луна';
    const geminiWords: WordTiming[] = [
      { id: 'g1', text: 'в', start: 1.0, end: 1.2 },
      { id: 'g2', text: 'небе', start: 1.3, end: 1.8 },
      // "светит" missing
      { id: 'g4', text: 'луна', start: 3.0, end: 3.5 },
    ];

    const result = alignReferenceWithGemini(refText, geminiWords);

    assert.strictEqual(result.alignedWords.length, 4);
    assert.strictEqual(result.stats.interpolated, 1);

    const interpolatedWord = result.alignedWords[2];
    assert.strictEqual(interpolatedWord.text, 'светит');
    assert.strictEqual(interpolatedWord.timingSource, 'interpolated');
    assert.strictEqual(interpolatedWord.isLowConfidence, true);
    // Interpolated between 1.8 and 3.0
    assert.ok(interpolatedWord.start >= 1.8);
    assert.ok(interpolatedWord.end <= 3.0);
  });

  it('should handle extra/spurious words in Gemini without breaking reference', () => {
    // Reference: "Hello world"
    // Gemini: "Um uh Hello wonderful world"
    const refText = 'Hello world';
    const geminiWords: WordTiming[] = [
      { id: 'g0', text: 'um', start: 0.5, end: 0.7 },
      { id: 'g1', text: 'uh', start: 0.8, end: 1.0 },
      { id: 'g2', text: 'hello', start: 1.2, end: 1.6 },
      { id: 'g3', text: 'wonderful', start: 1.7, end: 2.1 },
      { id: 'g4', text: 'world', start: 2.2, end: 2.8 },
    ];

    const result = alignReferenceWithGemini(refText, geminiWords);

    assert.strictEqual(result.alignedWords.length, 2);
    assert.strictEqual(result.alignedWords[0].text, 'Hello');
    assert.strictEqual(result.alignedWords[0].start, 1.2);
    assert.strictEqual(result.alignedWords[1].text, 'world');
    assert.strictEqual(result.alignedWords[1].start, 2.2);
  });

  it('should correctly handle Russian ё/е equivalence during alignment', () => {
    const refText = 'Моё тёмное небо';
    const geminiWords: WordTiming[] = [
      { id: 'g1', text: 'мое', start: 1.0, end: 1.4 },
      { id: 'g2', text: 'темное', start: 1.5, end: 2.0 },
      { id: 'g3', text: 'небо', start: 2.1, end: 2.6 },
    ];

    const result = alignReferenceWithGemini(refText, geminiWords);

    assert.strictEqual(result.alignedWords.length, 3);
    assert.strictEqual(result.stats.exactMatches, 3);
    assert.strictEqual(result.alignedWords[0].text, 'Моё');
    assert.strictEqual(result.alignedWords[1].text, 'тёмное');
    assert.strictEqual(result.alignedWords[0].start, 1.0);
  });
});

describe('Two-line karaoke screen presentation', () => {
  function makeLine(id: string, text: string, wordTimes: [string, number, number][]): LineTiming {
    const words: WordTiming[] = wordTimes.map(([wText, start, end], i) => ({
      id: `${id}-w${i}`,
      text: wText,
      start,
      end,
    }));
    return { id, text, start: words[0].start, end: words[words.length - 1].end, words };
  }

  // L0: 10-11, L1: 12-13 (short gap), L2: 20-21 (long pause after L1), L3: 22-23 (short gap)
  const lines: LineTiming[] = [
    makeLine('l0', 'Первая строка', [['Первая', 10.0, 10.5], ['строка', 10.6, 11.0]]),
    makeLine('l1', 'Вторая строка', [['Вторая', 12.0, 12.5], ['строка', 12.6, 13.0]]),
    makeLine('l2', 'Третья строка', [['Третья', 20.0, 20.5], ['строка', 20.6, 21.0]]),
    makeLine('l3', 'Четвёртая строка', [['Четвёртая', 22.0, 22.5], ['строка', 22.6, 23.0]]),
  ];

  it('should show nothing before the lead-in window', () => {
    const pair = getKaraokePresentationPair(lines, 7.9);
    assert.strictEqual(pair.top, null);
    assert.strictEqual(pair.bottom, null);
    assert.strictEqual(pair.anchorLine, null);
  });

  it('should show current + next line during lead-in, anchored top/bottom', () => {
    const pair = getKaraokePresentationPair(lines, 9.5);
    assert.strictEqual(pair.anchorLine?.id, 'l0');
    assert.strictEqual(pair.top?.id, 'l0');
    assert.strictEqual(pair.bottom?.id, 'l1');
  });

  it('should keep the pair while the anchor line is sung', () => {
    const pair = getKaraokePresentationPair(lines, 10.7);
    assert.strictEqual(pair.anchorLine?.id, 'l0');
    assert.strictEqual(pair.top?.id, 'l0');
    assert.strictEqual(pair.bottom?.id, 'l1');
  });

  it('should hold the previous pair during a short gap', () => {
    const pair = getKaraokePresentationPair(lines, 11.5);
    assert.strictEqual(pair.anchorLine?.id, 'l0');
    assert.strictEqual(pair.top?.id, 'l0');
    assert.strictEqual(pair.bottom?.id, 'l1');
  });

  it('should advance the pair and suppress lookahead across a long pause', () => {
    const pair = getKaraokePresentationPair(lines, 12.3);
    assert.strictEqual(pair.anchorLine?.id, 'l1');
    assert.strictEqual(pair.bottom?.id, 'l1');
    assert.strictEqual(pair.top, null);
  });

  it('should blank the screen during a long pause', () => {
    const pair = getKaraokePresentationPair(lines, 15.0);
    assert.strictEqual(pair.top, null);
    assert.strictEqual(pair.bottom, null);
    assert.strictEqual(pair.anchorLine, null);
  });

  it('should restart alternation at the top slot for a new phrase', () => {
    const pair = getKaraokePresentationPair(lines, 20.3);
    assert.strictEqual(pair.anchorLine?.id, 'l2');
    assert.strictEqual(pair.top?.id, 'l2');
    assert.strictEqual(pair.bottom?.id, 'l3');
  });

  it('should suppress the lookahead slot when showLookahead is false', () => {
    const pair = getKaraokePresentationPair(lines, 9.5, { showLookahead: false });
    assert.strictEqual(pair.anchorLine?.id, 'l0');
    assert.strictEqual(pair.top?.id, 'l0');
    assert.strictEqual(pair.bottom, null);
  });

  it('should hold the last line for two seconds after it is fully sung', () => {
    const pair = getKaraokePresentationPair(lines, 24.0);
    assert.strictEqual(pair.anchorLine?.id, 'l3');
    assert.strictEqual(pair.top, null);
    assert.strictEqual(pair.bottom?.id, 'l3');
  });

  it('should show nothing after the last line ends', () => {
    const pair = getKaraokePresentationPair(lines, 25.5);
    assert.strictEqual(pair.top, null);
    assert.strictEqual(pair.bottom, null);
  });

  it('should return empty pair for empty input', () => {
    const pair = getKaraokePresentationPair([], 10.0);
    assert.strictEqual(pair.top, null);
    assert.strictEqual(pair.bottom, null);
  });
});

describe('Repeated lines with a long gap (chorus sung twice)', () => {
  function gemWords(text: string, start: number): WordTiming[] {
    const out: WordTiming[] = [];
    let t = start;
    text.split(' ').forEach((w, i) => {
      out.push({ id: `g-${start}-${i}`, text: w, start: t, end: t + 0.9, confidence: 0.95 });
      t += 1.1;
    });
    return out;
  }

  // Припев поётся в 100с и 164с; во второй раз Gemini распознал только хвост.
  const geminiRepeat: WordTiming[] = [
    ...gemWords('куплет первая строка', 10),
    ...gemWords('припев строка один', 100),
    ...gemWords('припев строка два', 104),
    ...gemWords('строка два', 164),
  ];
  const refRepeat = [
    'куплет первая строка',
    'припев строка один',
    'припев строка два',
    'припев строка один',
    'припев строка два',
  ].join('\n');

  it('should not smear interpolated repeat words across the long pause', () => {
    const result = alignReferenceWithGemini(refRepeat, geminiRepeat);
    for (const w of result.alignedWords) {
      assert.ok(
        w.end - w.start <= 1.0,
        `word "${w.text}" spans ${(w.end - w.start).toFixed(2)}s`,
      );
    }
  });

  it('should blank the screen in the long gap between repeats', () => {
    const result = alignReferenceWithGemini(refRepeat, geminiRepeat);
    const pair = getKaraokePresentationPair(result.alignedLines, 130, { showLookahead: true });
    assert.strictEqual(pair.top, null);
    assert.strictEqual(pair.bottom, null);
    assert.strictEqual(pair.anchorLine, null);
  });

  it('should anchor the repeat (not the tail) while it is sung the second time', () => {
    const result = alignReferenceWithGemini(refRepeat, geminiRepeat);
    const pair = getKaraokePresentationPair(result.alignedLines, 161, { showLookahead: true });
    assert.strictEqual(pair.anchorLine?.text, 'припев строка один');
  });

  it('should resurface the repeat two seconds before it is sung again', () => {
    const result = alignReferenceWithGemini(refRepeat, geminiRepeat);
    const repeatStart = result.alignedLines[3].start;
    const pair = getKaraokePresentationPair(result.alignedLines, repeatStart - 1.5, { showLookahead: true });
    assert.strictEqual(pair.anchorLine?.text, 'припев строка один');
  });
});
