import { LineTiming, WordTiming } from './types';
import { formatTime, formatTimeSRT, formatTimeVTT } from './syncAlgorithm';

/**
 * Helper to adjust time by syncOffsetMs without mutating source data.
 * When syncOffsetMs > 0 (lyrics advanced), timestamps in exported subtitle
 * files are shifted earlier (t - syncOffsetMs / 1000) so they match audio playback.
 */
function getAdjustedTime(t: number, syncOffsetMs: number = 0): number {
  const shiftSec = (syncOffsetMs || 0) / 1000;
  return Math.max(0, +(t - shiftSec).toFixed(3));
}

/**
 * Generate standard line-based .LRC file
 * [mm:ss.xx] Line text
 */
export function generateStandardLRC(
  lines: LineTiming[],
  title: string = 'Track',
  syncOffsetMs: number = 0
): string {
  const header = `[ti:${title}]\n[by:Karaoke Sync Studio]\n[re:Google Gemini AI]${syncOffsetMs !== 0 ? `\n[offset:${syncOffsetMs}]` : ''}\n\n`;
  const body = lines
    .map(line => {
      const adjustedStart = getAdjustedTime(line.start, syncOffsetMs);
      const timeTag = `[${formatTime(adjustedStart, true)}]`;
      return `${timeTag} ${line.text}`;
    })
    .join('\n');

  return header + body;
}

/**
 * Generate Enhanced .LRC file with word-by-word timestamps
 * [mm:ss.xx] <mm:ss.xx>Word1 <mm:ss.xx>Word2 ...
 */
export function generateEnhancedLRC(
  lines: LineTiming[],
  title: string = 'Track',
  syncOffsetMs: number = 0
): string {
  const header = `[ti:${title}]\n[by:Karaoke Sync Studio (Enhanced)]${syncOffsetMs !== 0 ? `\n[offset:${syncOffsetMs}]` : ''}\n\n`;
  const body = lines
    .map(line => {
      const lineStart = getAdjustedTime(line.start, syncOffsetMs);
      const lineTime = `[${formatTime(lineStart, true)}]`;
      const wordsTagged = line.words
        .map(w => {
          const wStart = getAdjustedTime(w.start, syncOffsetMs);
          const wEnd = Math.max(wStart, getAdjustedTime(w.end, syncOffsetMs));
          return `<${formatTime(wStart, true)}>${w.text}<${formatTime(wEnd, true)}>`;
        })
        .join(' ');
      return `${lineTime} ${wordsTagged}`;
    })
    .join('\n');

  return header + body;
}

/**
 * Generate .SRT subtitle file
 */
export function generateSRT(
  lines: LineTiming[],
  syncOffsetMs: number = 0
): string {
  return lines
    .map((line, idx) => {
      const num = idx + 1;
      const start = getAdjustedTime(line.start, syncOffsetMs);
      const end = Math.max(start, getAdjustedTime(line.end, syncOffsetMs));
      const timeRange = `${formatTimeSRT(start)} --> ${formatTimeSRT(end)}`;
      return `${num}\n${timeRange}\n${line.text}\n`;
    })
    .join('\n');
}

/**
 * Generate WebVTT (.vtt) subtitle file
 */
export function generateWebVTT(
  lines: LineTiming[],
  syncOffsetMs: number = 0
): string {
  const header = `WEBVTT - Karaoke Sync Studio Subtitles\n\n`;
  const body = lines
    .map((line, idx) => {
      const num = idx + 1;
      const start = getAdjustedTime(line.start, syncOffsetMs);
      const end = Math.max(start, getAdjustedTime(line.end, syncOffsetMs));
      const timeRange = `${formatTimeVTT(start)} --> ${formatTimeVTT(end)}`;
      return `${num}\n${timeRange}\n${line.text}\n`;
    })
    .join('\n');

  return header + body;
}

/**
 * Generate JSON export
 */
export function generateJSONExport(data: {
  title: string;
  duration?: number;
  syncOffsetMs?: number;
  words: WordTiming[];
  lines: LineTiming[];
}): string {
  const syncOffset = data.syncOffsetMs || 0;

  // Compute effective timings without mutating original arrays
  const effectiveWords = data.words.map(w => {
    const start = getAdjustedTime(w.start, syncOffset);
    const end = Math.max(start, getAdjustedTime(w.end, syncOffset));
    return { ...w, start, end };
  });

  const effectiveLines = data.lines.map(l => {
    const start = getAdjustedTime(l.start, syncOffset);
    const end = Math.max(start, getAdjustedTime(l.end, syncOffset));
    return {
      ...l,
      start,
      end,
      words: l.words.map(w => {
        const wStart = getAdjustedTime(w.start, syncOffset);
        const wEnd = Math.max(wStart, getAdjustedTime(w.end, syncOffset));
        return { ...w, start: wStart, end: wEnd };
      }),
    };
  });

  return JSON.stringify({
    title: data.title,
    duration: data.duration,
    syncOffsetMs: syncOffset,
    words: data.words, // Original unmodified Gemini timestamps
    lines: data.lines, // Original unmodified Gemini lines
    effectiveWords,   // Exported timings with syncOffset applied
    effectiveLines,   // Exported lines with syncOffset applied
  }, null, 2);
}

/**
 * Helper to download text as file in browser
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
