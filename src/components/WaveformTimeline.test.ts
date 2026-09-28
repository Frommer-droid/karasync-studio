import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WaveformTimeline } from './WaveformTimeline';

function renderWaveform(
  vocalPeaks: Float32Array | null,
  vocalFileName: string | null,
  canUndo = false,
  canRedo = false,
) {
  return renderToStaticMarkup(React.createElement(WaveformTimeline, {
    audioUrl: null,
    audioBuffer: null,
    vocalPeaks,
    vocalFileName,
    vocalWaveformLoading: false,
    vocalWaveformError: false,
    onAttachVocalTrack: () => {},
    audioRef: { current: null },
    duration: 1,
    currentTime: 0,
    isPlaying: false,
    words: [],
    activeWord: null,
    selectedWordId: null,
    playingWordId: null,
    onSeek: () => {},
    onTogglePlay: () => {},
    onToggleWordPlayback: () => {},
    canGoToPreviousWord: false,
    canGoToNextWord: false,
    onGoToWord: () => {},
    onSelectWord: () => {},
    onMoveWordStart: () => {},
    onDeleteWord: () => {},
    onShiftAllMarkers: () => {},
    canUndo,
    canRedo,
    onUndo: () => {},
    onRedo: () => {},
  }));
}

describe('Waveform source status', () => {
  it('shows the original source and a recovery action without vocal peaks or words', () => {
    const html = renderWaveform(null, null);
    assert.match(html, /Волна: оригинальная песня/);
    assert.match(html, /Загрузить чистый вокал/);
  });

  it('identifies the loaded vocal source', () => {
    const html = renderWaveform(new Float32Array([0.5, -0.5]), 'vocals.wav');
    assert.match(html, /Волна: чистый вокал — vocals.wav/);
    assert.match(html, /Заменить вокал/);
  });

  it('shows Undo and Redo only as available history actions', () => {
    const initial = renderWaveform(null, null);
    assert.match(initial, /id="btn-undo-word-edit"[^>]*disabled=""/);
    assert.match(initial, /id="btn-redo-word-edit"[^>]*disabled=""/);

    const afterEdit = renderWaveform(null, null, true, false);
    assert.doesNotMatch(afterEdit, /id="btn-undo-word-edit"[^>]*disabled=""/);
    assert.match(afterEdit, /id="btn-redo-word-edit"[^>]*disabled=""/);

    const afterUndo = renderWaveform(null, null, false, true);
    assert.match(afterUndo, /id="btn-undo-word-edit"[^>]*disabled=""/);
    assert.doesNotMatch(afterUndo, /id="btn-redo-word-edit"[^>]*disabled=""/);
  });
});
