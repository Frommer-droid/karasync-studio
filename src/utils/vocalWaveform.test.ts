import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractVocalPeaks, maxAbsolutePeak, vocalPeaksOnOriginalTimeline } from './vocalWaveform';

describe('vocalPeaksOnOriginalTimeline', () => {
  it('keeps vocal onsets on the original clock and pads an early ending with silence', () => {
    const samples = new Float32Array(100);
    samples[50] = 0.8;
    samples[51] = -0.6;
    const buffer = {
      sampleRate: 1000,
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;

    const vocalPeaks = extractVocalPeaks(buffer);
    const peaks = vocalPeaksOnOriginalTimeline(vocalPeaks, 0.2);
    assert.equal(peaks.length, 80);
    assert.ok(Math.abs(peaks[20] - 0.8) < 0.00001); // 50 ms, 10th 5 ms window
    assert.ok(Math.abs(peaks[21] + 0.6) < 0.00001);
    assert.ok(peaks.slice(40).every((value) => value === 0)); // after vocal ends
    assert.ok(vocalPeaksOnOriginalTimeline(vocalPeaks, 0.05).every((value) => value === 0)); // clipped before onset
  });
});

describe('maxAbsolutePeak', () => {
  it('uses the loudest peak across the entire stem so quiet slices stay quiet', () => {
    const peaks = new Float32Array([0.005, -0.004, 0.75, -0.8]);
    assert.ok(Math.abs(maxAbsolutePeak(peaks) - 0.8) < 0.00001);
    assert.ok(Math.abs(peaks[0] / maxAbsolutePeak(peaks)) < 0.01);
  });

  it('keeps a valid scale for silence', () => {
    assert.equal(maxAbsolutePeak(new Float32Array(10)), 1);
  });
});
