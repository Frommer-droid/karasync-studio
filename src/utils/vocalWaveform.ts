/**
 * Reduce a vocal stem to 5 ms min/max windows. Keep these small peaks after
 * decoding so the full stem AudioBuffer can be released from memory.
 */
export function extractVocalPeaks(buffer: AudioBuffer): Float32Array {
  const windowCount = Math.ceil(buffer.length / buffer.sampleRate * 200);
  const peaks = new Float32Array(windowCount * 2);
  if (!windowCount || !buffer.numberOfChannels) return peaks;

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  for (let window = 0; window < windowCount; window++) {
    const from = Math.floor(window * buffer.sampleRate / 200);
    const to = Math.min(buffer.length, Math.floor((window + 1) * buffer.sampleRate / 200));

    let max = 0;
    let min = 0;
    for (let frame = from; frame < to; frame++) {
      for (const channel of channels) {
        const sample = channel[frame];
        if (sample > max) max = sample;
        if (sample < min) min = sample;
      }
    }
    peaks[window * 2] = max;
    peaks[window * 2 + 1] = min;
  }
  return peaks;
}

/** Pad or clip the vocal peaks on the original song's clock, without stretching. */
export function vocalPeaksOnOriginalTimeline(vocalPeaks: Float32Array, originalDuration: number): Float32Array {
  const peaks = new Float32Array(Math.ceil(originalDuration * 200) * 2);
  peaks.set(vocalPeaks.subarray(0, peaks.length));
  return peaks;
}

/** Keep one vertical scale for the whole stem, including quiet canvas slices. */
export function maxAbsolutePeak(peaks: Float32Array): number {
  let max = 0;
  for (const peak of peaks) {
    if (Number.isFinite(peak)) max = Math.max(max, Math.abs(peak));
  }
  return max || 1;
}
