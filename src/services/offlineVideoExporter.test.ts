import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  offlineMediaTimeForFrame,
  offlineTotalFramesForDuration,
  frameTimestampMicros,
  frameDurationMicros,
  selectAvcCodec,
  isOfflineMp4ExportSupported,
  getOfflineSupportInfo,
} from './offlineVideoExporter';

describe('Offline frame clock', () => {
  it('should derive media time from frame index, not a wall clock', () => {
    assert.strictEqual(offlineMediaTimeForFrame(0, 0, 30), 0);
    assert.strictEqual(offlineMediaTimeForFrame(10, 30, 30), 11);
    assert.strictEqual(offlineMediaTimeForFrame(5, 45, 30), 6.5);
    assert.strictEqual(offlineMediaTimeForFrame(179, 0, 30), 179);
  });

  it('should count total frames by ceiling duration', () => {
    assert.strictEqual(offlineTotalFramesForDuration(20, 30), 600);
    assert.strictEqual(offlineTotalFramesForDuration(0.05, 30), 2);
    assert.strictEqual(offlineTotalFramesForDuration(233.77, 30), Math.ceil(233.77 * 30));
  });

  it('should produce microsecond timestamps matching media time', () => {
    assert.strictEqual(frameTimestampMicros(0, 30), 0);
    assert.strictEqual(frameTimestampMicros(30, 30), 1_000_000);
    assert.strictEqual(frameTimestampMicros(15, 30), 500_000);
    // timestamp / 1e6 == media time offset for the frame
    assert.strictEqual(frameTimestampMicros(90, 30) / 1e6, offlineMediaTimeForFrame(0, 90, 30));
  });

  it('should use a constant frame duration', () => {
    assert.strictEqual(frameDurationMicros(30), Math.round(1e6 / 30));
    assert.strictEqual(frameDurationMicros(24), Math.round(1e6 / 24));
  });

  it('should report offline export as unsupported without WebCodecs (node env)', async () => {
    assert.strictEqual(await selectAvcCodec(), null);
    assert.strictEqual(await isOfflineMp4ExportSupported(), false);
    const info = await getOfflineSupportInfo();
    assert.strictEqual(info.supported, false);
    assert.strictEqual(info.videoCodec, null);
    assert.strictEqual(info.audioSupported, false);
    assert.ok(info.reason.length > 0);
  });
});
