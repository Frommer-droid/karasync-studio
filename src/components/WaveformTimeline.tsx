import React, { useEffect, useMemo, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { Pause, Play, Redo2, StepBack, StepForward, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import type { WordTiming } from '../../shared/types';
import { formatTimeMs } from '../../shared/syncAlgorithm';
import { maxAbsolutePeak, vocalPeaksOnOriginalTimeline } from '../utils/vocalWaveform';
import { canShiftAllWordTimings } from '../../shared/wordStartEdit';

interface WaveformTimelineProps {
  audioUrl: string | null;
  audioBuffer: AudioBuffer | null;
  vocalPeaks: Float32Array | null;
  vocalFileName: string | null;
  vocalWaveformLoading: boolean;
  vocalWaveformError: boolean;
  onAttachVocalTrack: (file: File) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  words: WordTiming[];
  activeWord: WordTiming | null;
  selectedWordId: string | null;
  playingWordId: string | null;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onToggleWordPlayback: (word: WordTiming) => void;
  canGoToPreviousWord: boolean;
  canGoToNextWord: boolean;
  onGoToWord: (direction: -1 | 1) => void;
  onSelectWord: (word: WordTiming) => void;
  onMoveWordStart: (wordId: string, start: number) => void;
  onDeleteWord: (wordId: string) => void;
  onShiftAllMarkers: (deltaSeconds: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const MIN_ZOOM = 60;
const MAX_ZOOM = 800;
const DEFAULT_ZOOM = 200;

/** One scrollable time axis for the audio, word labels, and draggable start markers. */
export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  audioUrl,
  audioBuffer,
  vocalPeaks,
  vocalFileName,
  vocalWaveformLoading,
  vocalWaveformError,
  onAttachVocalTrack,
  audioRef,
  duration,
  currentTime,
  isPlaying,
  words,
  activeWord,
  selectedWordId,
  playingWordId,
  onSeek,
  onTogglePlay,
  onToggleWordPlayback,
  canGoToPreviousWord,
  canGoToNextWord,
  onGoToWord,
  onSelectWord,
  onMoveWordStart,
  onDeleteWord,
  onShiftAllMarkers,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const vocalInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const wordsRef = useRef(words);
  const actionsRef = useRef({ onSeek, onSelectWord, onMoveWordStart });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [dragged, setDragged] = useState<{ id: string; start: number } | null>(null);
  const [viewStart, setViewStart] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ wordId: string; x: number; y: number } | null>(null);

  wordsRef.current = words;
  actionsRef.current = { onSeek, onSelectWord, onMoveWordStart };

  const waveformData = useMemo(() => {
    if (!duration) return { peaks: undefined, maxPeak: undefined };
    if (vocalPeaks) {
      const peaks = vocalPeaksOnOriginalTimeline(vocalPeaks, duration);
      return { peaks: [peaks], maxPeak: maxAbsolutePeak(peaks) };
    }
    return { peaks: audioBuffer ? [audioBuffer.getChannelData(0)] : undefined, maxPeak: undefined };
  }, [audioBuffer, duration, vocalPeaks]);

  useEffect(() => {
    setReady(false);
    setError(null);
    if (!hostRef.current || !audioRef.current || !audioUrl || vocalWaveformLoading) return;

    const regions = RegionsPlugin.create();
    const wave = WaveSurfer.create({
      container: hostRef.current,
      media: audioRef.current,
      url: audioUrl,
      peaks: waveformData.peaks,
      duration: waveformData.peaks ? duration : undefined,
      plugins: [
        TimelinePlugin.create({ height: 24, primaryLabelInterval: 5, secondaryLabelInterval: 1 }),
        regions,
      ],
      waveColor: '#4b5563',
      progressColor: '#22d3ee',
      cursorColor: '#fef08a',
      cursorWidth: 2,
      height: 160,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      maxPeak: waveformData.maxPeak,
      autoScroll: true,
      autoCenter: true,
      minPxPerSec: zoom,
    });
    waveRef.current = wave;
    regionsRef.current = regions;

    const subscriptions = [
      wave.on('ready', () => {
        setViewportWidth(wave.getWidth());
        setReady(true);
      }),
      wave.on('interaction', (time) => actionsRef.current.onSeek(time)),
      wave.on('scroll', (visibleStart) => setViewStart(visibleStart)),
      wave.on('resize', () => setViewportWidth(wave.getWidth())),
      wave.on('error', () => setError('Не удалось построить звуковую волну для этого файла.')),
      regions.on('region-clicked', (region, event) => {
        event.stopPropagation();
        const word = wordsRef.current.find((item) => item.id === region.id);
        if (!word) return;
        actionsRef.current.onSeek(word.start);
        actionsRef.current.onSelectWord(word);
      }),
      regions.on('region-update', (region) => setDragged({ id: region.id, start: region.start })),
      regions.on('region-updated', (region) => {
        setDragged(null);
        actionsRef.current.onMoveWordStart(region.id, region.start);
      }),
    ];

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      regionsRef.current = null;
      waveRef.current = null;
      wave.destroy();
    };
  }, [audioUrl, audioRef, duration, waveformData, vocalWaveformLoading]);

  useEffect(() => {
    if (ready) waveRef.current?.zoom(zoom);
  }, [ready, zoom]);

  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.querySelector('button')?.focus();
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', closeOnOutsideClick, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    const regions = regionsRef.current;
    const wave = waveRef.current;
    if (!ready || !regions || !wave) return;
    regions.clearRegions();
    const waveDuration = wave.getDuration();
    if (!waveDuration) return;
    const pixelsPerSecond = Math.max(zoom, (hostRef.current?.clientWidth ?? 0) / waveDuration);

    words.forEach((word, index) => {
      if (!Number.isFinite(word.start) || word.start < 0 || word.start > waveDuration) return;
      const nextStart = words[index + 1]?.start ?? Math.min(waveDuration, word.end);
      const availableWidth = Math.max(24, Math.min(220, (nextStart - word.start) * pixelsPerSecond - 7));
      const label = document.createElement('span');
      label.textContent = word.text;
      label.title = `${word.text} · начало ${formatTimeMs(word.start)} · перетащите маркер или нажмите правой кнопкой для удаления`;
      Object.assign(label.style, {
        display: 'block',
        position: 'absolute',
        top: '5px',
        left: '4px',
        width: `${availableWidth}px`,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        padding: '3px 5px',
        borderRadius: '4px',
        border: '1px solid #334155',
        background: '#111827ec',
        color: '#e5e7eb',
        font: '600 11px system-ui, sans-serif',
        cursor: 'ew-resize',
        boxSizing: 'border-box',
      });
      const region = regions.addRegion({
        id: word.id,
        start: word.start,
        color: word.timingSource === 'interpolated' ? '#fbbf24' : '#34d399',
        drag: true,
        resize: false,
        content: label,
      });
      if (region.element) {
        region.element.style.borderLeftWidth = '3px';
        region.element.style.cursor = 'ew-resize';
        region.element.tabIndex = 0;
        region.element.setAttribute('role', 'slider');
        region.element.setAttribute('aria-haspopup', 'menu');
        region.element.setAttribute('aria-label', `Начало слова ${word.text}`);
        region.element.setAttribute('aria-valuemin', '0');
        region.element.setAttribute('aria-valuemax', waveDuration.toFixed(3));
        region.element.setAttribute('aria-valuenow', word.start.toFixed(3));
        region.element.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          actionsRef.current.onSelectWord(word);
          const rect = region.element?.getBoundingClientRect();
          const x = event.clientX || rect?.left || 8;
          const y = event.clientY || rect?.bottom || 8;
          setContextMenu({
            wordId: word.id,
            x: Math.max(8, Math.min(x, window.innerWidth - 264)),
            y: Math.max(8, Math.min(y, window.innerHeight - 72)),
          });
        });
        region.element.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 0.1 : 0.01;
            actionsRef.current.onMoveWordStart(word.id, region.start + (event.key === 'ArrowRight' ? step : -step));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            actionsRef.current.onSeek(region.start);
            actionsRef.current.onSelectWord(word);
          }
        });
      }
    });
  }, [ready, words, zoom]);

  useEffect(() => {
    regionsRef.current?.getRegions().forEach((region) => {
      const selected = region.id === selectedWordId;
      if (!region.content) return;
      region.content.style.background = selected ? '#164e63' : '#111827ec';
      region.content.style.borderColor = selected ? '#67e8f9' : '#334155';
      region.content.style.color = selected ? '#ecfeff' : '#e5e7eb';
      if (region.element) region.element.style.zIndex = selected ? '10' : '1';
    });
  }, [ready, words, zoom, selectedWordId]);

  const selectedWord = words.find((word) => word.id === selectedWordId);
  const menuWord = contextMenu && words.find((word) => word.id === contextMenu.wordId);
  const playingWord = words.find((word) => word.id === playingWordId);
  const inspectedWord = (dragged && words.find((word) => word.id === dragged.id))
    || (isPlaying ? playingWord || activeWord || selectedWord : selectedWord || activeWord)
    || words[0]
    || null;
  const inspectedStart = dragged && inspectedWord && dragged.id === inspectedWord.id
    ? dragged.start
    : inspectedWord?.start;
  const visibleSeconds = viewportWidth > 0 ? viewportWidth / zoom : duration;
  const maxViewStart = Math.max(0, duration - visibleSeconds);

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/90 p-4 shadow-xl" aria-label="Звуковая волна и начало слов">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePlay}
              className="grid size-8 place-items-center rounded-full bg-cyan-400 text-neutral-950 hover:bg-cyan-300"
              aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
            >
              {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </button>
            <h2 className="text-sm font-semibold text-white">Звуковая волна и слова</h2>
            <span className="font-mono text-xs text-cyan-300">{formatTimeMs(currentTime)}</span>
            <span className="font-mono text-xs text-neutral-500">/ {formatTimeMs(duration)}</span>
          </div>
          <p className={`mt-1 text-xs ${vocalPeaks ? 'text-emerald-300' : 'text-amber-300'}`}>
            {vocalPeaks
              ? `Волна: чистый вокал${vocalFileName ? ` — ${vocalFileName}` : ''}`
              : vocalWaveformError
                ? 'Не удалось прочитать чистый вокал. Показана волна оригинальной песни.'
                : 'Волна: оригинальная песня. Загрузите чистый вокал для точной правки слов.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-950 p-1" role="group" aria-label="История правок слов">
            <button
              id="btn-undo-word-edit"
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-cyan-200 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              title="Отменить правку (Ctrl+Z)"
              aria-label="Отменить правку"
            >
              <Undo2 size={15} aria-hidden="true" />
              <span>Undo</span>
            </button>
            <button
              id="btn-redo-word-edit"
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-cyan-200 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              title="Повторить правку (Ctrl+Y)"
              aria-label="Повторить правку"
            >
              <Redo2 size={15} aria-hidden="true" />
              <span>Redo</span>
            </button>
          </div>
          <input
            ref={vocalInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm"
            className="hidden"
            aria-label="Файл чистого вокала для звуковой волны"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onAttachVocalTrack(file);
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => vocalInputRef.current?.click()}
            disabled={vocalWaveformLoading}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-cyan-200 hover:border-cyan-500 hover:text-white disabled:opacity-50"
          >
            {vocalPeaks ? 'Заменить вокал' : 'Загрузить чистый вокал'}
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1" aria-label="Общий сдвиг меток слов">
            <span className="mr-1 text-xs text-neutral-400">Все метки</span>
            {([-0.1, -0.05, 0.05, 0.1] as const).map((delta) => {
              const milliseconds = Math.round(Math.abs(delta) * 1000);
              const direction = delta < 0 ? 'назад' : 'вперёд';
              return (
                <button
                  key={delta}
                  type="button"
                  onClick={() => onShiftAllMarkers(delta)}
                  disabled={!ready || !canShiftAllWordTimings(words, delta, duration)}
                  className="rounded px-2 py-1 font-mono text-xs text-cyan-200 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Сдвинуть все метки на ${milliseconds} мс ${direction}`}
                  title={`Сдвинуть все метки на ${milliseconds} мс ${direction}`}
                >
                  {delta < 0 ? '−' : '+'}{milliseconds}
                </button>
              );
            })}
            <span className="text-[10px] text-neutral-500">мс</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1">
            <button type="button" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - 40))} disabled={zoom <= MIN_ZOOM} className="p-1 text-neutral-300 hover:text-white disabled:opacity-30" aria-label="Уменьшить масштаб"><ZoomOut size={16} /></button>
            <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={20} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="w-24 accent-cyan-400" aria-label="Масштаб звуковой волны" />
            <button type="button" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 40))} disabled={zoom >= MAX_ZOOM} className="p-1 text-neutral-300 hover:text-white disabled:opacity-30" aria-label="Увеличить масштаб"><ZoomIn size={16} /></button>
            <span className="min-w-14 text-right font-mono text-xs text-cyan-300">{zoom} px/с</span>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950">
        <div ref={hostRef} className="min-h-[184px]" />
        {(!ready || vocalWaveformLoading) && <div className="absolute inset-0 grid place-items-center bg-neutral-950/80 text-sm text-neutral-400">{error ?? (vocalWaveformLoading ? 'Строим волну чистого вокала…' : 'Строим звуковую волну…')}</div>}
      </div>

      {contextMenu && menuWord && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Действия со словом ${menuWord.text}`}
          className="fixed z-50 w-64 rounded-lg border border-neutral-600 bg-neutral-900 p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-200 hover:bg-red-950/60 focus:bg-red-950/60 focus:outline-none"
            onClick={() => {
              onDeleteWord(contextMenu.wordId);
              setContextMenu(null);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span className="min-w-0 truncate">Удалить слово «{menuWord.text}»</span>
          </button>
        </div>
      )}

      {ready && maxViewStart > 0.05 && (
        <div className="mt-3 flex items-center gap-3 text-xs text-neutral-400">
          <span className="shrink-0">Обзор трека</span>
          <input
            type="range"
            min={0}
            max={maxViewStart}
            step={0.01}
            value={Math.min(viewStart, maxViewStart)}
            onChange={(event) => {
              const start = Number(event.target.value);
              waveRef.current?.setScrollTime(start);
              setViewStart(start);
            }}
            className="min-w-0 flex-1 accent-cyan-400"
            aria-label="Прокрутка звуковой волны по треку"
          />
          <span className="shrink-0 font-mono text-cyan-300">{formatTimeMs(viewStart)}–{formatTimeMs(Math.min(duration, viewStart + visibleSeconds))}</span>
        </div>
      )}

      {inspectedWord && (
        <div className="mt-4 rounded-xl border border-cyan-500/30 bg-neutral-950/80 p-4 sm:p-5" aria-label="Синхронизация слова">
          <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
            <div className="flex h-12 w-48 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-neutral-950 px-3 text-center sm:w-60">
              <strong className="block w-full truncate text-base font-semibold text-cyan-200" title={inspectedWord.text}>«{inspectedWord.text}»</strong>
            </div>

            <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Передвижение и воспроизведение слова">
              <button
                id="btn-previous-word-timeline"
                type="button"
                onClick={() => onGoToWord(-1)}
                disabled={!canGoToPreviousWord}
                className="grid size-11 place-items-center rounded-full bg-neutral-800 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                title="Предыдущее слово"
                aria-label="Предыдущее слово"
              >
                <StepBack size={18} aria-hidden="true" />
              </button>
              <button
                id="btn-play-word"
                type="button"
                onClick={() => onToggleWordPlayback(inspectedWord)}
                className="grid size-12 place-items-center rounded-full bg-cyan-600 text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700"
                title={isPlaying ? 'Остановить и вернуться к началу слова' : 'Воспроизвести с начала слова'}
                aria-label={isPlaying ? 'Остановить слово' : 'Воспроизвести слово'}
              >
                {isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
              </button>
              <button
                id="btn-next-word-timeline"
                type="button"
                onClick={() => onGoToWord(1)}
                disabled={!canGoToNextWord}
                className="grid size-11 place-items-center rounded-full bg-neutral-800 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                title="Следующее слово"
                aria-label="Следующее слово"
              >
                <StepForward size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex w-full flex-wrap items-center justify-end gap-3 lg:ml-auto lg:w-auto lg:flex-nowrap">
              <time
                className="flex h-12 min-w-40 shrink-0 items-center justify-center rounded-xl border border-cyan-400/50 bg-cyan-950/40 px-4 font-mono text-xl font-bold tabular-nums text-cyan-100 shadow-inner shadow-cyan-500/10"
                aria-label="Время начала выбранного слова"
              >
                {formatTimeMs(inspectedStart ?? inspectedWord.start)}
              </time>

              <div className="grid w-full grid-cols-4 gap-2 sm:w-auto" role="group" aria-label="Сдвиг начала слова в миллисекундах">
                {[-0.1, -0.05, 0.05, 0.1].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => onMoveWordStart(inspectedWord.id, inspectedWord.start + delta)}
                    className="min-h-10 min-w-14 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-2 font-mono text-sm font-semibold text-neutral-200 transition-colors hover:border-cyan-500/60 hover:bg-neutral-700 hover:text-white"
                    aria-label={`Сдвинуть начало слова на ${delta > 0 ? '+' : ''}${Math.round(delta * 1000)} мс`}
                  >
                    {delta > 0 ? '+' : '−'}{Math.round(Math.abs(delta) * 1000)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
