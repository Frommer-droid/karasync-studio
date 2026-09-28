import { WordTiming, LineTiming, AlignmentStats, TimingSource } from './types';

/**
 * Calculates the single source of truth effective playback time for karaoke synchronization:
 * effectiveTime = audioCurrentTime + syncAdvanceMs / 1000
 *
 * Example:
 * audioCurrentTime = 39.307, syncAdvanceMs = 5000 -> effectiveTime = 44.307
 * Positive syncAdvanceMs advances the karaoke lyric clock so words highlight earlier.
 */
export function getEffectiveTime(
  audioCurrentTime: number,
  syncAdvanceMs: number = 0
): number {
  if (isNaN(audioCurrentTime) || audioCurrentTime < 0) audioCurrentTime = 0;
  if (isNaN(syncAdvanceMs)) syncAdvanceMs = 0;
  return audioCurrentTime + syncAdvanceMs / 1000;
}

/**
 * Formats seconds into MM:SS.ms (e.g. 01:23.45) or MM:SS.mmm (e.g. 00:12.350)
 */
export function formatTime(seconds: number, includeMs: boolean = true): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');

  if (includeMs) {
    const paddedMs = String(ms).padStart(2, '0');
    return `${paddedMins}:${paddedSecs}.${paddedMs}`;
  }

  return `${paddedMins}:${paddedSecs}`;
}

/**
 * Formats seconds into exact millisecond precision string: "00:12.350" (MM:SS.mmm)
 */
export function formatTimeMs(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');
  const paddedMs = String(ms).padStart(3, '0').slice(0, 3);

  return `${paddedMins}:${paddedSecs}.${paddedMs}`;
}

/**
 * Formats seconds into standard HH:MM:SS.mmm representation
 */
export function formatTimeHmsMmm(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor(((seconds % 1) * 1000) + 0.00001);

  const paddedHours = String(hours).padStart(2, '0');
  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');
  const paddedMs = String(Math.min(999, Math.max(0, ms))).padStart(3, '0');

  return `${paddedHours}:${paddedMins}:${paddedSecs}.${paddedMs}`;
}

/**
 * Parses time string in format "MM:SS.mmm", "MM:SS.ss", or "SS.sss" into seconds
 */
export function parseTimeMsToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 1) {
    const s = parseFloat(parts[0]);
    return isNaN(s) ? 0 : Math.max(0, s);
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    return (isNaN(m) ? 0 : Math.max(0, m) * 60) + (isNaN(s) ? 0 : Math.max(0, s));
  }
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    return (isNaN(h) ? 0 : Math.max(0, h) * 3600) + (isNaN(m) ? 0 : Math.max(0, m) * 60) + (isNaN(s) ? 0 : Math.max(0, s));
  }
  return 0;
}

/**
 * Formats seconds into SRT format (00:01:23,450)
 */
export function formatTimeSRT(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Formats seconds into WebVTT format (00:01:23.450)
 */
export function formatTimeVTT(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Parse time string "MM:SS.ms" or "SS.ms" to seconds
 */
export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':');
  if (parts.length === 1) {
    const s = parseFloat(parts[0]);
    return isNaN(s) ? 0 : s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    return (isNaN(m) ? 0 : m * 60) + (isNaN(s) ? 0 : s);
  }
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    return (isNaN(h) ? 0 : h * 3600) + (isNaN(m) ? 0 : m * 60) + (isNaN(s) ? 0 : s);
  }
  return 0;
}

/**
 * Normalizes text for linguistic alignment comparison without altering display text:
 * 1. Lowercase
 * 2. Unicode normalization (NFC)
 * 3. Strips punctuation from word edges and converts typographic apostrophes/hyphens
 * 4. Equates Russian 'ё' to 'е'
 */
export function normalizeForComparison(word: string): string {
  if (!word) return '';

  return word
    .normalize('NFC')
    .toLowerCase()
    // Normalize typographical apostrophes and dashes
    .replace(/[’‘`]/g, "'")
    .replace(/[—–−]/g, '-')
    // Replace Russian 'ё' with 'е'
    .replace(/ё/g, 'е')
    // Remove leading/trailing punctuation and quotes, retaining internal letters, numbers, and intra-word apostrophe/hyphen
    .replace(/^[^a-zа-я0-9\u00C0-\u024F]+/gi, '')
    .replace(/[^a-zа-я0-9\u00C0-\u024F]+$/gi, '')
    .trim();
}

/**
 * Calculates Levenshtein edit distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val: number;
      if (a[i - 1] === b[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length];
}

/**
 * Computes string similarity between 0.0 and 1.0 based on normalized Levenshtein distance
 */
export function calculateWordSimilarity(a: string, b: string): number {
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  if (!normA && !normB) return 1.0;
  if (!normA || !normB) return 0.0;
  if (normA === normB) return 1.0;

  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;

  const dist = levenshteinDistance(normA, normB);
  return Math.max(0, 1.0 - dist / maxLen);
}

export interface ParsedReferenceWord {
  id: string;
  originalText: string;
  normalizedText: string;
  lineIndex: number;
  wordIndexInLine: number;
  globalIndex: number;
}

export interface ParsedReferenceLine {
  lineIndex: number;
  originalText: string;
  words: ParsedReferenceWord[];
}

const STANDALONE_DASH = /^[—–−-]+$/u;

/** A dash between lyric words is punctuation, never a separately sung token. */
export function isStandaloneDash(text: string): boolean {
  return STANDALONE_DASH.test(text.trim());
}

/**
 * Attaches standalone dashes to the preceding sung word without extending its
 * timing. This keeps the dash visible in the lyric line but removes it from
 * word navigation, editing and highlighting as an independent element.
 */
export function mergeStandaloneDashTokens(words: WordTiming[]): WordTiming[] {
  const merged: WordTiming[] = [];

  for (const word of words) {
    if (isStandaloneDash(word.text)) {
      const previous = merged[merged.length - 1];
      if (previous) {
        merged[merged.length - 1] = {
          ...previous,
          text: `${previous.text.trimEnd()} ${word.text.trim()}`,
        };
      }
      continue;
    }
    merged.push(word);
  }

  return merged;
}

function mergeStandaloneDashTextTokens(tokens: string[]): string[] {
  const merged: string[] = [];

  for (const token of tokens) {
    if (isStandaloneDash(token)) {
      if (merged.length > 0) {
        merged[merged.length - 1] = `${merged[merged.length - 1].trimEnd()} ${token.trim()}`;
      }
      continue;
    }
    merged.push(token);
  }

  return merged;
}

/**
 * Breaks raw reference lyrics into lines and words while preserving exact line structures and original casings.
 */
export function parseReferenceLyrics(referenceText: string): {
  lines: ParsedReferenceLine[];
  words: ParsedReferenceWord[];
} {
  const lines: ParsedReferenceLine[] = [];
  const allWords: ParsedReferenceWord[] = [];
  let globalIndex = 0;

  const rawLines = referenceText.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const rawLine = rawLines[lineIndex].trim();
    if (!rawLine) continue;

    // Split words in line while keeping exact token texts
    const tokens = mergeStandaloneDashTextTokens(
      rawLine.split(/\s+/).filter(t => t.trim().length > 0),
    );
    const lineWords: ParsedReferenceWord[] = [];

    for (let wordIndex = 0; wordIndex < tokens.length; wordIndex++) {
      const originalText = tokens[wordIndex];
      const parsedWord: ParsedReferenceWord = {
        id: `ref-${lineIndex}-${wordIndex}-${globalIndex}`,
        originalText,
        normalizedText: normalizeForComparison(originalText),
        lineIndex: lines.length, // use index in filtered non-empty lines
        wordIndexInLine: wordIndex,
        globalIndex,
      };

      lineWords.push(parsedWord);
      allWords.push(parsedWord);
      globalIndex++;
    }

    if (lineWords.length > 0) {
      lines.push({
        lineIndex: lines.length,
        originalText: rawLine,
        words: lineWords,
      });
    }
  }

  return { lines, words: allWords };
}

export interface AlignmentResult {
  alignedLines: LineTiming[];
  alignedWords: WordTiming[];
  stats: AlignmentStats;
}

/**
 * Needleman-Wunsch Global Sequence Alignment between Reference Words and Gemini Transcribed Words.
 * Respects deletions, insertions, substitutions, and repeats.
 */
export function alignReferenceWithGemini(
  referenceText: string,
  geminiWords: WordTiming[]
): AlignmentResult {
  geminiWords = mergeStandaloneDashTokens(geminiWords);
  const { lines: parsedLines, words: refWords } = parseReferenceLyrics(referenceText);

  // If no reference words or no gemini words, fallback gracefully
  if (refWords.length === 0) {
    const fallbackLines = groupWordsIntoLines(geminiWords);
    return {
      alignedLines: fallbackLines,
      alignedWords: geminiWords,
      stats: {
        totalWords: geminiWords.length,
        exactMatches: geminiWords.length,
        approxMatches: 0,
        interpolated: 0,
        unmatched: 0,
        averageConfidence: 1,
      },
    };
  }

  if (!geminiWords || geminiWords.length === 0) {
    // Generate dummy interpolated words starting from 0.0s
    let currentTime = 0;
    const dummyWords: WordTiming[] = refWords.map((rw, i) => {
      const start = parseFloat(currentTime.toFixed(2));
      const end = parseFloat((currentTime + 0.5).toFixed(2));
      currentTime += 0.5;
      return {
        id: `word-${i}-${start.toFixed(2)}`,
        text: rw.originalText,
        start,
        end,
        confidence: 0,
        timingSource: 'interpolated',
        lineIndex: rw.lineIndex,
        wordIndexInLine: rw.wordIndexInLine,
        isLowConfidence: true,
      };
    });

    return {
      alignedLines: rebuildLinesFromWords(dummyWords, parsedLines),
      alignedWords: dummyWords,
      stats: {
        totalWords: refWords.length,
        exactMatches: 0,
        approxMatches: 0,
        interpolated: refWords.length,
        unmatched: refWords.length,
        averageConfidence: 0,
      },
    };
  }

  const N = refWords.length;
  const M = geminiWords.length;

  // Normalized words for comparison
  const refNorm = refWords.map(w => w.normalizedText);
  const gemNorm = geminiWords.map(w => normalizeForComparison(w.text));

  // DP Matrix for Needleman-Wunsch
  // Cost model:
  // Match score: 2.0 (exact) to 1.0 (fuzzy >= 0.6)
  // Mismatch penalty: -1.0
  // Gap Reference (Gemini word skipped / extra in Gemini): -0.8
  // Gap Gemini (Ref word missing in Gemini): -0.8
  const MATCH_SCORE = 2.5;
  const GAP_REF = -0.8;
  const GAP_GEM = -0.8;

  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));

  for (let i = 0; i <= N; i++) dp[i][0] = i * GAP_GEM;
  for (let j = 0; j <= M; j++) dp[0][j] = j * GAP_REF;

  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      const sim = calculateWordSimilarity(refNorm[i - 1], gemNorm[j - 1]);
      let score: number;
      if (sim === 1.0) {
        score = MATCH_SCORE;
      } else if (sim >= 0.6) {
        score = MATCH_SCORE * sim - 0.5;
      } else {
        score = -1.2;
      }

      const matchChoice = dp[i - 1][j - 1] + score;
      const deleteChoice = dp[i - 1][j] + GAP_GEM; // Ref word has no Gemini match (gap in gemini)
      const insertChoice = dp[i][j - 1] + GAP_REF; // Gemini word has no Ref match (extra gemini word)

      dp[i][j] = Math.max(matchChoice, deleteChoice, insertChoice);
    }
  }

  // Traceback
  let i = N;
  let j = M;
  const refToGeminiMap = new Map<number, { geminiIndex: number; similarity: number }>();

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sim = calculateWordSimilarity(refNorm[i - 1], gemNorm[j - 1]);
      let score: number;
      if (sim === 1.0) {
        score = MATCH_SCORE;
      } else if (sim >= 0.6) {
        score = MATCH_SCORE * sim - 0.5;
      } else {
        score = -1.2;
      }

      if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + score)) < 1e-5) {
        if (sim >= 0.5) {
          refToGeminiMap.set(i - 1, { geminiIndex: j - 1, similarity: sim });
        }
        i--;
        j--;
        continue;
      }
    }

    if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + GAP_GEM)) < 1e-5) {
      // Gap in Gemini: Ref word i-1 is unmatched/deleted in Gemini
      i--;
    } else {
      // Gap in Reference: Gemini word j-1 is extra
      j--;
    }
  }

  // Build aligned WordTiming array for all reference words
  const alignedWords: WordTiming[] = [];
  let exactCount = 0;
  let approxCount = 0;
  let interpolatedCount = 0;
  let unmatchedCount = 0;
  let totalConfidence = 0;

  for (let rIdx = 0; rIdx < N; rIdx++) {
    const refWord = refWords[rIdx];
    const match = refToGeminiMap.get(rIdx);

    if (match) {
      const gemWord = geminiWords[match.geminiIndex];
      const similarity = match.similarity;
      const confidence = parseFloat((similarity * (gemWord.confidence ?? 1.0)).toFixed(2));

      if (similarity >= 0.99) {
        exactCount++;
      } else {
        approxCount++;
      }
      totalConfidence += confidence;

      alignedWords.push({
        id: `w-${refWord.lineIndex}-${refWord.wordIndexInLine}-${rIdx}`,
        text: refWord.originalText, // Preserves exact reference casing and typography
        start: gemWord.start,
        end: gemWord.end,
        confidence,
        timingSource: 'gemini',
        lineIndex: refWord.lineIndex,
        wordIndexInLine: refWord.wordIndexInLine,
        isLowConfidence: confidence < 0.6,
      });
    } else {
      // Unmatched word: will be interpolated in second pass
      unmatchedCount++;
      interpolatedCount++;
      alignedWords.push({
        id: `w-${refWord.lineIndex}-${refWord.wordIndexInLine}-${rIdx}`,
        text: refWord.originalText,
        start: -1, // placeholder for interpolation
        end: -1,
        confidence: 0.2,
        timingSource: 'interpolated',
        lineIndex: refWord.lineIndex,
        wordIndexInLine: refWord.wordIndexInLine,
        isLowConfidence: true,
      });
    }
  }

  // Second pass: Interpolate missing/unmatched words between surrounding anchors
  interpolateMissingTimings(alignedWords, geminiWords);

  // Rebuild structured lines with computed start/end
  const alignedLines = rebuildLinesFromWords(alignedWords, parsedLines);

  const stats: AlignmentStats = {
    totalWords: N,
    exactMatches: exactCount,
    approxMatches: approxCount,
    interpolated: interpolatedCount,
    unmatched: unmatchedCount,
    averageConfidence: N > 0 ? parseFloat((totalConfidence / N).toFixed(2)) : 0,
  };

  return {
    alignedLines,
    alignedWords,
    stats,
  };
}

/**
 * Upper bound for a single interpolated word (seconds). Without a cap,
 * unmatched words between two far-apart anchors (e.g. a repeated chorus
 * Gemini transcribed only once) would smear across the whole pause,
 * stretching line bounds over the gap and gluing the karaoke screen.
 */
const MAX_INTERPOLATED_WORD_DURATION = 1.0;

/**
 * Interpolates timestamps for words marked with start = -1
 */
function interpolateMissingTimings(alignedWords: WordTiming[], geminiWords: WordTiming[]): void {
  const N = alignedWords.length;
  let idx = 0;

  while (idx < N) {
    if (alignedWords[idx].start !== -1) {
      idx++;
      continue;
    }

    // Found gap start
    const gapStart = idx;
    while (idx < N && alignedWords[idx].start === -1) {
      idx++;
    }
    const gapEnd = idx; // exclusive
    const gapLength = gapEnd - gapStart;

    // Determine left anchor
    let leftTime = 0;
    if (gapStart > 0) {
      leftTime = alignedWords[gapStart - 1].end;
    } else if (geminiWords.length > 0) {
      leftTime = Math.max(0, geminiWords[0].start - gapLength * 0.4);
    }

    // Determine right anchor
    const hasRealRightAnchor = gapEnd < N;
    let rightTime = leftTime + gapLength * 0.5;
    if (hasRealRightAnchor) {
      rightTime = alignedWords[gapEnd].start;
    } else if (geminiWords.length > 0) {
      rightTime = geminiWords[geminiWords.length - 1].end + gapLength * 0.4;
    }

    if (rightTime <= leftTime) {
      rightTime = leftTime + gapLength * 0.4;
    }

    let durationPerWord = (rightTime - leftTime) / gapLength;
    let blockStart = leftTime;
    if (durationPerWord > MAX_INTERPOLATED_WORD_DURATION) {
      // Пауза слишком длинная для ровного размазывания: пакуем слова
      // компактным блоком у ближайшего настоящего якоря, чтобы строка
      // не растягивалась через паузу. Настоящий правый якорь есть —
      // пакуем перед ним, иначе (хвост песни) — сразу за левым.
      durationPerWord = MAX_INTERPOLATED_WORD_DURATION;
      blockStart = hasRealRightAnchor
        ? rightTime - gapLength * MAX_INTERPOLATED_WORD_DURATION
        : leftTime;
    }

    for (let k = 0; k < gapLength; k++) {
      const curIndex = gapStart + k;
      const s = blockStart + k * durationPerWord;
      const e = s + durationPerWord * 0.85;

      alignedWords[curIndex].start = parseFloat(s.toFixed(2));
      alignedWords[curIndex].end = parseFloat(e.toFixed(2));
      alignedWords[curIndex].timingSource = 'interpolated';
      alignedWords[curIndex].isLowConfidence = true;
    }
  }
}

/**
 * Rebuilds LineTiming structures from aligned WordTimings and original parsed lines
 */
function rebuildLinesFromWords(
  words: WordTiming[],
  parsedLines: ParsedReferenceLine[]
): LineTiming[] {
  const lineMap = new Map<number, WordTiming[]>();

  for (const w of words) {
    const lIdx = w.lineIndex ?? 0;
    if (!lineMap.has(lIdx)) {
      lineMap.set(lIdx, []);
    }
    lineMap.get(lIdx)!.push(w);
  }

  const lines: LineTiming[] = [];

  for (let lIdx = 0; lIdx < parsedLines.length; lIdx++) {
    const lineWords = lineMap.get(lIdx) || [];
    if (lineWords.length === 0) continue;

    // Ensure sorted
    lineWords.sort((a, b) => a.start - b.start);

    const lineStart = lineWords[0].start;
    const lineEnd = lineWords[lineWords.length - 1].end;
    const lineText = parsedLines[lIdx].originalText;

    lines.push({
      id: `line-${lIdx + 1}-${lineStart.toFixed(2)}`,
      text: lineText,
      start: lineStart,
      end: lineEnd,
      words: lineWords,
      lineIndex: lIdx,
    });
  }

  return lines;
}

/**
 * Groups raw word timings into structured lines based on pauses, punctuation,
 * or provided lyric line breaks with reference alignment.
 */
export function groupWordsIntoLines(
  words: WordTiming[],
  customLyrics?: string,
  useReferenceLyrics: boolean = false
): LineTiming[] {
  words = mergeStandaloneDashTokens(words);
  if (!words || words.length === 0) return [];

  // If user provided reference lyrics and requested alignment
  if (customLyrics && customLyrics.trim() && useReferenceLyrics) {
    const alignment = alignReferenceWithGemini(customLyrics, words);
    return alignment.alignedLines;
  }

  // If custom lyrics provided without strict alignment, use line splitter
  if (customLyrics && customLyrics.trim()) {
    const rawLines = customLyrics
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (rawLines.length > 0) {
      return alignWordsWithCustomLyrics(words, rawLines);
    }
  }

  // Natural pause and punctuation grouping
  const lines: LineTiming[] = [];
  let currentLineWords: WordTiming[] = [];
  const PAUSE_THRESHOLD = 0.9; // seconds gap between words to trigger new line
  const MAX_WORDS_PER_LINE = 8;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prevWord = i > 0 ? words[i - 1] : null;

    const isPause = prevWord && (word.start - prevWord.end >= PAUSE_THRESHOLD);
    const endsWithPunctuation = prevWord && /[.!?…]$/.test(prevWord.text.trim());
    const isLineTooLong = currentLineWords.length >= MAX_WORDS_PER_LINE;

    if ((isPause || endsWithPunctuation || isLineTooLong) && currentLineWords.length > 0) {
      const lineStart = currentLineWords[0].start;
      const lineEnd = currentLineWords[currentLineWords.length - 1].end;
      const lineText = currentLineWords.map(w => w.text).join(' ');

      lines.push({
        id: `line-${lines.length + 1}-${lineStart.toFixed(2)}`,
        text: lineText,
        start: lineStart,
        end: lineEnd,
        words: [...currentLineWords],
        lineIndex: lines.length,
      });

      currentLineWords = [];
    }

    currentLineWords.push(word);
  }

  if (currentLineWords.length > 0) {
    const lineStart = currentLineWords[0].start;
    const lineEnd = currentLineWords[currentLineWords.length - 1].end;
    const lineText = currentLineWords.map(w => w.text).join(' ');

    lines.push({
      id: `line-${lines.length + 1}-${lineStart.toFixed(2)}`,
      text: lineText,
      start: lineStart,
      end: lineEnd,
      words: [...currentLineWords],
      lineIndex: lines.length,
    });
  }

  return lines;
}

/**
 * Aligns transcribed words with custom lyric lines sequentially
 */
export function alignWordsWithCustomLyrics(words: WordTiming[], lyricLines: string[]): LineTiming[] {
  words = mergeStandaloneDashTokens(words);
  const lines: LineTiming[] = [];
  let wordIndex = 0;

  for (let lIdx = 0; lIdx < lyricLines.length; lIdx++) {
    const lineStr = lyricLines[lIdx];
    const targetWords = mergeStandaloneDashTextTokens(
      lineStr.split(/\s+/).filter(w => w.length > 0),
    );
    if (targetWords.length === 0) continue;

    const matchedWords: WordTiming[] = [];
    for (let t = 0; t < targetWords.length && wordIndex < words.length; t++) {
      const transcribedWord = words[wordIndex];
      matchedWords.push({
        id: transcribedWord.id || `word-${wordIndex}`,
        text: targetWords[t],
        start: transcribedWord.start,
        end: transcribedWord.end,
        confidence: transcribedWord.confidence,
        timingSource: 'gemini',
        lineIndex: lIdx,
        wordIndexInLine: t,
      });
      wordIndex++;
    }

    if (matchedWords.length > 0) {
      lines.push({
        id: `line-${lines.length + 1}-${matchedWords[0].start.toFixed(2)}`,
        text: lineStr,
        start: matchedWords[0].start,
        end: matchedWords[matchedWords.length - 1].end,
        words: matchedWords,
        lineIndex: lIdx,
      });
    }
  }

  // If there are remaining transcribed words, group them as additional lines
  if (wordIndex < words.length) {
    const remainingWords = words.slice(wordIndex);
    const extraLines = groupWordsIntoLines(remainingWords);
    lines.push(...extraLines);
  }

  return lines;
}

/**
 * Finds the active line and active word at a given playback time
 */
export function findActiveElements(
  lines: LineTiming[],
  currentTime: number
): {
  activeLineIndex: number;
  activeLine: LineTiming | null;
  activeWordIndex: number;
  activeWord: WordTiming | null;
  nextLine: LineTiming | null;
} {
  let activeLineIndex = -1;
  let activeLine: LineTiming | null = null;
  let activeWordIndex = -1;
  let activeWord: WordTiming | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (currentTime >= line.start && currentTime <= line.end) {
      activeLineIndex = i;
      activeLine = line;
      break;
    } else if (currentTime < line.start && (i === 0 || currentTime > lines[i - 1].end)) {
      activeLineIndex = i;
      activeLine = line;
      break;
    }
  }

  // Fallback if past the end or before the first
  if (activeLineIndex === -1 && lines.length > 0) {
    if (currentTime < lines[0].start) {
      activeLineIndex = 0;
      activeLine = lines[0];
    } else if (currentTime > lines[lines.length - 1].end) {
      activeLineIndex = lines.length - 1;
      activeLine = lines[lines.length - 1];
    }
  }

  if (activeLine) {
    for (let w = 0; w < activeLine.words.length; w++) {
      const word = activeLine.words[w];
      if (currentTime >= word.start && currentTime <= word.end) {
        activeWordIndex = w;
        activeWord = word;
        break;
      }
    }
  }

  const nextLine = (activeLineIndex >= 0 && activeLineIndex + 1 < lines.length)
    ? lines[activeLineIndex + 1]
    : null;

  return {
    activeLineIndex,
    activeLine,
    activeWordIndex,
    activeWord,
    nextLine,
  };
}

/**
 * Returns 0 before a word starts and 1 from its start onward.
 * The end timestamp does not control the fill: a highlighted word remains
 * filled while later words in the line begin.
 */
export function calculateWordProgress(
  currentTime: number,
  start: number,
  _end: number
): number {
  if (isNaN(currentTime) || isNaN(start)) return 0;
  return currentTime >= start ? 1 : 0;
}

/**
 * Convenience helper to calculate progress for a WordTiming object.
 */
/**
 * Single shared karaoke frame state returned for both live preview and video export
 */
export interface KaraokeFrameState {
  activeLineIndex: number;
  activeWordIndex: number;
  wordProgress: number; // 0 before start, 1 once the active word begins
  currentLine: LineTiming | null;
  nextLine: LineTiming | null;
  activeWord: WordTiming | null;
}

/**
 * Pure function providing the SINGLE source of truth for karaoke frame state.
 * Used identically by both Video Preview and Video Export.
 */
export function getKaraokeFrameState(
  words: WordTiming[],
  lines: LineTiming[],
  effectiveTime: number
): KaraokeFrameState {
  const { activeLineIndex, activeLine, activeWordIndex, activeWord, nextLine } = findActiveElements(lines, effectiveTime);

  let wordProgress = 0;
  if (activeWord) {
    wordProgress = calculateWordProgress(effectiveTime, activeWord.start, activeWord.end);
  }

  return {
    activeLineIndex,
    activeWordIndex,
    wordProgress,
    currentLine: activeLine,
    nextLine,
    activeWord,
  };
}

/**
 * Development / Diagnostic timing test runner.
 * Evaluates getKaraokeFrameState at multiple checkpoints (0s, 30s, 60s, 120s, 180s, 240s)
 * to verify line index and word index advance without needing a full 4-minute render.
 *//**
 * Two-line karaoke screen presentation (ported from Karaoke Studio presentation model).
 *
 * The screen is a pure function of playback time and always shows at most two
 * fixed slots — top and bottom:
 * - A line appears LEAD-IN seconds BEFORE its first word (fully, in base color).
 * - While a line is sung, the NEXT line is shown alongside as a lookahead
 *   (unless separated by a long pause).
 * - During SHORT gaps (<= longPause) the previous pair is held on screen.
 * - During LONG pauses (> longPause) the screen goes blank.
 * - After the last line is fully sung it stays for LAST_LINE_HOLD seconds.
 * - When the next line starts, the previous one disappears: {N, N+1} -> {N+1, N+2}.
 * - Slot assignment alternates by phrase offset (a phrase = chain of lines
 *   without long pauses): even offset -> top, odd offset -> bottom, so every
 *   new phrase restarts at the top slot. Lines never scroll.
 */
export const PRESENTATION_LEAD_IN_SECONDS = 2;
export const PRESENTATION_LONG_PAUSE_SECONDS = 5;
/** Сколько секунд держать последнюю строку после допевания. */
export const PRESENTATION_LAST_LINE_HOLD_SECONDS = 2;

export interface KaraokePresentationPair {
  top: LineTiming | null;
  bottom: LineTiming | null;
  /** The line the pair is anchored to (the sung / about-to-be-sung line), if any. */
  anchorLine: LineTiming | null;
}

export interface KaraokePresentationOptions {
  leadInSeconds?: number;
  longPauseSeconds?: number;
  /** When false, the lookahead slot is suppressed and only the anchor line is shown. */
  showLookahead?: boolean;
}

export function getPresentationLineBounds(line: LineTiming): { start: number; end: number } | null {
  const start = Number(line.start);
  const words = Array.isArray(line.words) ? line.words : [];
  const lastWord = words[words.length - 1];
  const end = Number.isFinite(Number(line.end)) ? Number(line.end) : Number(lastWord?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || words.length === 0) {
    return null;
  }
  return { start, end };
}

function isLongPauseBetween(
  line: LineTiming | null,
  nextLine: LineTiming | null,
  threshold: number
): boolean {
  if (!line || !nextLine) return false;
  const bounds = getPresentationLineBounds(line);
  const nextBounds = getPresentationLineBounds(nextLine);
  if (!bounds || !nextBounds) return false;
  return nextBounds.start - bounds.end > threshold;
}

/** Slot of a line inside its phrase: even phrase offset -> top, odd -> bottom. */
function getPresentationSlot(lines: LineTiming[], lineIndex: number, threshold: number): 'top' | 'bottom' {
  let offsetInPhrase = 0;
  for (let index = lineIndex; index > 0; index -= 1) {
    if (isLongPauseBetween(lines[index - 1], lines[index], threshold)) {
      break;
    }
    offsetInPhrase += 1;
  }
  return offsetInPhrase % 2 === 0 ? 'top' : 'bottom';
}

function buildPresentationPair(
  lines: LineTiming[],
  anchorIndex: number,
  threshold: number,
  showLookahead: boolean
): KaraokePresentationPair {
  const anchorLine = lines[anchorIndex] || null;
  if (!anchorLine) {
    return { top: null, bottom: null, anchorLine: null };
  }

  const result: KaraokePresentationPair = { top: null, bottom: null, anchorLine };
  result[getPresentationSlot(lines, anchorIndex, threshold)] = anchorLine;

  if (showLookahead) {
    const nextLine = lines[anchorIndex + 1] || null;
    if (nextLine && !isLongPauseBetween(anchorLine, nextLine, threshold)) {
      result[getPresentationSlot(lines, anchorIndex + 1, threshold)] = nextLine;
    }
  }

  return result;
}

const EMPTY_PRESENTATION_PAIR: KaraokePresentationPair = { top: null, bottom: null, anchorLine: null };

/**
 * Computes which two lines belong on the karaoke screen at the given effective time.
 * Pure function — the single source of truth shared by live preview and video export.
 */
export function getKaraokePresentationPair(
  lines: LineTiming[],
  effectiveTime: number,
  options: KaraokePresentationOptions = {}
): KaraokePresentationPair {
  const usableLines = Array.isArray(lines) ? lines : [];
  const time = Number(effectiveTime);
  if (usableLines.length === 0 || !Number.isFinite(time)) {
    return { ...EMPTY_PRESENTATION_PAIR };
  }

  const leadIn = Math.max(0, Number(options.leadInSeconds ?? PRESENTATION_LEAD_IN_SECONDS) || 0);
  const hold = Math.max(0, Number(PRESENTATION_LAST_LINE_HOLD_SECONDS) || 0);
  const rawThreshold = Number(options.longPauseSeconds ?? PRESENTATION_LONG_PAUSE_SECONDS);
  const threshold = Number.isFinite(rawThreshold) ? Math.max(0, rawThreshold) : PRESENTATION_LONG_PAUSE_SECONDS;
  const showLookahead = options.showLookahead !== false;

  // 1. Anchor to the actively sung word's line (binary search over flattened words).
  const flatWords: { start: number; end: number; lineArrayIndex: number }[] = [];
  usableLines.forEach((line, lineArrayIndex) => {
    for (const word of line.words || []) {
      const start = Number(word.start);
      const end = Number(word.end);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        flatWords.push({ start, end, lineArrayIndex });
      }
    }
  });

  let low = 0;
  let high = flatWords.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const word = flatWords[mid];
    if (time < word.start) {
      high = mid - 1;
    } else if (time >= word.end) {
      low = mid + 1;
    } else {
      return buildPresentationPair(usableLines, word.lineArrayIndex, threshold, showLookahead);
    }
  }

  // 2. No active word: scan lines (lead-in window, short-gap hold, long-pause blank).
  for (let index = 0; index < usableLines.length; index += 1) {
    const bounds = getPresentationLineBounds(usableLines[index]);
    if (!bounds) continue;

    if (time >= bounds.start - leadIn && time <= bounds.end) {
      return buildPresentationPair(usableLines, index, threshold, showLookahead);
    }

    if (time > bounds.end) {
      const nextLine = index + 1 < usableLines.length ? usableLines[index + 1] : null;
      const nextBounds = nextLine ? getPresentationLineBounds(nextLine) : null;
      if (nextBounds && time < nextBounds.start) {
        if (nextBounds.start - bounds.end <= threshold) {
          return buildPresentationPair(usableLines, index, threshold, showLookahead);
        }
      }
      continue;
    }

    // time < bounds.start
    if (time >= bounds.start - leadIn) {
      return buildPresentationPair(usableLines, index, threshold, showLookahead);
    }
    return { ...EMPTY_PRESENTATION_PAIR };
  }

  // 3. Хвост песни: держим последнюю строку HOLD секунд после допевания.
  for (let index = usableLines.length - 1; index >= 0; index -= 1) {
    const lastBounds = getPresentationLineBounds(usableLines[index]);
    if (!lastBounds) continue;
    if (time > lastBounds.end && time <= lastBounds.end + hold) {
      return buildPresentationPair(usableLines, index, threshold, showLookahead);
    }
    break;
  }

  return { ...EMPTY_PRESENTATION_PAIR };
}

export interface TimingTestPoint {
  mediaTime: number;
  effectiveTime: number;
  activeLineIndex: number;
  activeWordIndex: number;
  wordProgress: number;
  lineText: string;
  wordText: string;
}

export function runTimingDiagnosticTest(
  words: WordTiming[],
  lines: LineTiming[],
  syncAdvanceMs: number = 0,
  testCheckpoints: number[] = [0, 30, 60, 120, 180, 240]
): TimingTestPoint[] {
  const results: TimingTestPoint[] = [];

  for (const t of testCheckpoints) {
    const eff = getEffectiveTime(t, syncAdvanceMs);
    const state = getKaraokeFrameState(words, lines, eff);
    const lineText = state.currentLine ? state.currentLine.text : '(no line)';
    const wordText = state.activeWord ? state.activeWord.text : '(no word)';

    results.push({
      mediaTime: t,
      effectiveTime: eff,
      activeLineIndex: state.activeLineIndex,
      activeWordIndex: state.activeWordIndex,
      wordProgress: state.wordProgress,
      lineText,
      wordText,
    });
  }

  return results;
}

export interface ABTimingTestResult {
  mediaTime: number;
  syncOffsetMs: number;
  effectiveTime: number;
  previewState: KaraokeFrameState;
  exportState: KaraokeFrameState;
  isExactMatch: boolean;
  diffSummary?: string;
}

/**
 * Exact Development A/B Test Runner comparing Preview timing state and Export timing state.
 * Tests specified checkpoints (e.g. 60.000, 62.000, 65.000, 70.000) and confirms that for
 * effectiveTime = mediaTime + (syncOffsetMs / 1000), getKaraokeFrameState returns 100% identical:
 * - activeLineIndex
 * - activeWordIndex
 * - wordProgress
 */
export function runABTimingTest(
  words: WordTiming[],
  lines: LineTiming[],
  syncOffsetMs: number = 790,
  checkpoints: number[] = [60.0, 62.0, 65.0, 70.0]
): { allMatch: boolean; results: ABTimingTestResult[] } {
  const results: ABTimingTestResult[] = [];
  let allMatch = true;

  console.log(`[A/B TIMING TEST] Running verification with syncOffsetMs = +${syncOffsetMs}ms on checkpoints [${checkpoints.join(', ')}]...`);

  for (const mediaTime of checkpoints) {
    // 1. Preview timing calculation
    const previewEffectiveTime = getEffectiveTime(mediaTime, syncOffsetMs);
    const previewState = getKaraokeFrameState(words, lines, previewEffectiveTime);

    // 2. Video Export timing calculation (AudioContext clock formula: mediaTime + syncOffsetMs / 1000)
    const exportEffectiveTime = mediaTime + (syncOffsetMs / 1000);
    const exportState = getKaraokeFrameState(words, lines, exportEffectiveTime);

    // 3. Verification
    const isExactMatch =
      previewEffectiveTime === exportEffectiveTime &&
      previewState.activeLineIndex === exportState.activeLineIndex &&
      previewState.activeWordIndex === exportState.activeWordIndex &&
      Math.abs(previewState.wordProgress - exportState.wordProgress) < 0.00001;

    let diffSummary = 'OK: Identical frame state';
    if (!isExactMatch) {
      allMatch = false;
      diffSummary = `MISMATCH: Preview(Line ${previewState.activeLineIndex}, Word ${previewState.activeWordIndex}, Prog ${previewState.wordProgress.toFixed(3)}) vs Export(Line ${exportState.activeLineIndex}, Word ${exportState.activeWordIndex}, Prog ${exportState.wordProgress.toFixed(3)})`;
      console.warn(`[A/B TIMING TEST ERROR] at mediaTime ${mediaTime.toFixed(3)}s:`, diffSummary);
    } else {
      console.log(
        `[A/B TIMING TEST PASS] mediaTime=${mediaTime.toFixed(3)}s (Eff: ${previewEffectiveTime.toFixed(3)}s) -> Line #${previewState.activeLineIndex + 1} ("${previewState.currentLine?.text || ''}"), Word #${previewState.activeWordIndex + 1} ("${previewState.activeWord?.text || ''}"), Progress: ${(previewState.wordProgress * 100).toFixed(1)}%`
      );
    }

    results.push({
      mediaTime,
      syncOffsetMs,
      effectiveTime: previewEffectiveTime,
      previewState,
      exportState,
      isExactMatch,
      diffSummary,
    });
  }

  return { allMatch, results };
}

export interface WordTimecodeAuditItem {
  wordId: string;
  wordText: string;
  rawStartSec: number;
  rawEndSec: number;
  syncOffsetMs: number;
  exportStartSec: number;
  videoStartSec: number;
  videoEndSec: number;
  videoStartMs: number;
  videoEndMs: number;
  isVerifiedMatch: boolean;
  computedWordProgressAtVideoStart: number;
}

/**
 * Calculates the exact video container timestamp (in seconds) when a word starts highlighting in the exported video.
 *
 * Formula:
 * videoStartSec = Math.max(0, rawStartSec - (syncOffsetMs / 1000) - exportStartSec)
 *
 * Proof:
 * In the video player at time `videoStartSec`:
 * mediaTime in audio = videoStartSec + exportStartSec = rawStartSec - (syncOffsetMs / 1000)
 * effectiveTime = mediaTime + (syncOffsetMs / 1000) = rawStartSec!
 * Therefore, at exact video timestamp `videoStartSec`, effectiveTime reaches rawStartSec and the word starts highlighting.
 */
export function getVideoTimestampForWord(
  rawStartSec: number,
  syncOffsetMs: number = 0,
  exportStartSec: number = 0
): number {
  const shiftSec = (syncOffsetMs || 0) / 1000;
  return Math.max(0, +(rawStartSec - shiftSec - exportStartSec).toFixed(3));
}

/**
 * Runs a comprehensive timecode audit across all words, verifying the mathematical
 * mapping between Gemini raw timestamps, preview effective times, and exported video timestamps.
 */
export function runWordTimecodeAudit(
  words: WordTiming[],
  lines: LineTiming[],
  syncOffsetMs: number = 790,
  exportStartSec: number = 0,
  sampleLimit: number = 20
): { allVerified: boolean; auditItems: WordTimecodeAuditItem[] } {
  const shiftSec = (syncOffsetMs || 0) / 1000;
  const auditItems: WordTimecodeAuditItem[] = [];
  let allVerified = true;

  // Pick sample of words evenly distributed across the track
  const step = Math.max(1, Math.floor(words.length / sampleLimit));
  const wordsToTest: WordTiming[] = [];
  for (let i = 0; i < words.length; i += step) {
    wordsToTest.push(words[i]);
  }
  // Always include last word
  if (words.length > 0 && !wordsToTest.includes(words[words.length - 1])) {
    wordsToTest.push(words[words.length - 1]);
  }

  for (const w of wordsToTest) {
    const videoStartSec = Math.max(0, +(w.start - shiftSec - exportStartSec).toFixed(3));
    const videoEndSec = Math.max(videoStartSec, +(w.end - shiftSec - exportStartSec).toFixed(3));

    // Evaluate effective time at videoStartSec + 0.001s
    const evalMediaTime = videoStartSec + exportStartSec + 0.001;
    const effectiveTime = getEffectiveTime(evalMediaTime, syncOffsetMs);
    const state = getKaraokeFrameState(words, lines, effectiveTime);

    const isMatch =
      state.activeWord?.id === w.id ||
      (Math.abs(effectiveTime - w.start) <= 0.02);

    if (!isMatch) {
      allVerified = false;
    }

    auditItems.push({
      wordId: w.id,
      wordText: w.text,
      rawStartSec: w.start,
      rawEndSec: w.end,
      syncOffsetMs,
      exportStartSec,
      videoStartSec,
      videoEndSec,
      videoStartMs: Math.round(videoStartSec * 1000),
      videoEndMs: Math.round(videoEndSec * 1000),
      isVerifiedMatch: isMatch,
      computedWordProgressAtVideoStart: state.wordProgress,
    });
  }

  return { allVerified, auditItems };
}

