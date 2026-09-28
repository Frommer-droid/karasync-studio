import type { LineTiming, WordTiming } from './types';

const MIN_WORD_SPACING = 0.05;

/** Remove a lyric token from the canonical lines and their flat word list. */
export function deleteWord(
  words: WordTiming[],
  lines: LineTiming[],
  wordId: string,
): { words: WordTiming[]; lines: LineTiming[] } | null {
  if (!words.some((word) => word.id === wordId)
    && !lines.some((line) => line.words.some((word) => word.id === wordId))) return null;

  if (!lines.length) return { words: words.filter((word) => word.id !== wordId), lines };

  const keptLines = lines.flatMap((line) => {
    if (!line.words.some((word) => word.id === wordId)) return [line];
    const remaining = line.words.filter((word) => word.id !== wordId);
    if (!remaining.length) return [];
    const lineWords = remaining.map((word, wordIndexInLine) => ({ ...word, wordIndexInLine }));
    return [{
      ...line,
      words: lineWords,
      text: lineWords.map((word) => word.text).join(' '),
      start: Math.min(...lineWords.map((word) => word.start)),
      end: Math.max(...lineWords.map((word) => word.end)),
    }];
  });
  const nextLines = keptLines.map((line, lineIndex) => {
    if (line.lineIndex === lineIndex && line.words.every((word) => word.lineIndex === lineIndex)) return line;
    return { ...line, lineIndex, words: line.words.map((word) => ({ ...word, lineIndex })) };
  });

  return { words: nextLines.flatMap((line) => line.words), lines: nextLines };
}

export function getWordStartBounds(words: WordTiming[], index: number, duration: number) {
  const word = words[index];
  const previous = words[index - 1];
  const next = words[index + 1];
  const trackEnd = Math.max(duration, ...words.map((item) => item.end));
  const min = previous && previous.start < word.start
    ? previous.start + MIN_WORD_SPACING
    : 0;
  const max = next && next.start > word.start
    ? next.start - MIN_WORD_SPACING
    : trackEnd;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/** Change one lyric boundary without shifting the starts of neighboring words. */
export function moveWordStart(
  words: WordTiming[],
  lines: LineTiming[],
  wordId: string,
  requestedStart: number,
  duration: number,
): { words: WordTiming[]; lines: LineTiming[]; start: number } | null {
  const lineWords = lines.flatMap((line) => line.words);
  const lineWordIds = new Set(lineWords.map((word) => word.id));
  const ordered = [...lineWords, ...words.filter((word) => !lineWordIds.has(word.id))];
  const index = ordered.findIndex((word) => word.id === wordId);
  if (index < 0 || !Number.isFinite(requestedStart)) return null;

  const word = ordered[index];
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const { min, max } = getWordStartBounds(ordered, index, duration);
  const start = Math.round(Math.min(max, Math.max(min, requestedStart)) * 1000) / 1000;
  if (start === word.start) return null;

  const replacements = new Map<string, WordTiming>();
  if (previous && previous.end > start && previous.start < start) {
    replacements.set(previous.id, {
      ...previous,
      end: start,
      timingSource: 'manual',
    });
  }
  replacements.set(wordId, {
    ...word,
    start,
    end: Math.round(Math.max(start + MIN_WORD_SPACING, Math.min(word.end, next?.start ?? Infinity)) * 1000) / 1000,
    timingSource: 'manual',
    isLowConfidence: false,
  });

  const nextLines = lines.map((line) => {
    if (!line.words.some((item) => replacements.has(item.id))) return line;
    const lineWords = line.words.map((item) => replacements.get(item.id) ?? item);
    return {
      ...line,
      words: lineWords,
      start: Math.min(...lineWords.map((item) => item.start)),
      end: Math.max(...lineWords.map((item) => item.end)),
    };
  });
  const nextWords = words.map((item) => replacements.get(item.id) ?? item);
  return { words: nextWords, lines: nextLines, start };
}

/** Only a full step is allowed: a global nudge must preserve relative spacing. */
export function canShiftAllWordTimings(words: WordTiming[], delta: number, duration: number): boolean {
  if (!words.length || !Number.isFinite(delta) || !Number.isFinite(duration) || duration <= 0) return false;
  const deltaMs = Math.round(delta * 1000);
  if (deltaMs === 0) return false;
  const durationMs = Math.round(duration * 1000);
  return words.every((word) => {
    const shiftedStartMs = Math.round(word.start * 1000) + deltaMs;
    return Number.isFinite(word.start) && shiftedStartMs >= 0 && shiftedStartMs <= durationMs;
  });
}

/** Shift the whole transcription against a stationary waveform in one undo step. */
export function shiftAllWordTimings(
  words: WordTiming[],
  lines: LineTiming[],
  delta: number,
  duration: number,
): { words: WordTiming[]; lines: LineTiming[] } | null {
  const lineWords = lines.flatMap((line) => line.words);
  const lineWordIds = new Set(lineWords.map((word) => word.id));
  const ordered = [...lineWords, ...words.filter((word) => !lineWordIds.has(word.id))];
  if (!canShiftAllWordTimings([...words, ...lineWords], delta, duration)) return null;

  const deltaMs = Math.round(delta * 1000);
  const shiftedById = new Map<string, WordTiming>();
  for (const word of ordered) {
    shiftedById.set(word.id, {
      ...word,
      start: (Math.round(word.start * 1000) + deltaMs) / 1000,
      end: (Math.round(word.end * 1000) + deltaMs) / 1000,
    });
  }

  const nextWords = ordered.map((word) => shiftedById.get(word.id)!);
  const nextLines = lines.map((line) => {
    if (!line.words.length) return line;
    const shiftedWords = line.words.map((word) => shiftedById.get(word.id)!);
    return {
      ...line,
      words: shiftedWords,
      start: Math.min(...shiftedWords.map((word) => word.start)),
      end: Math.max(...shiftedWords.map((word) => word.end)),
    };
  });
  return { words: nextWords, lines: nextLines };
}
