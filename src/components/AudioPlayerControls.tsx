import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
  FastForward,
  Rewind,
  Gauge,
  Repeat,
  PanelBottomOpen,
  PanelBottomClose,
  ZoomIn,
  Maximize2,
  X,
} from 'lucide-react';
import { formatTimeMs } from '../../shared/syncAlgorithm';

interface AudioPlayerControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  loopRange?: { start: number; end: number; label?: string } | null;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onSetVolume: (volume: number) => void;
  onToggleMute: () => void;
  onSetPlaybackRate: (rate: number) => void;
  onClearLoop?: () => void;
  canGoToPreviousWord: boolean;
  canGoToNextWord: boolean;
  onGoToWord: (direction: -1 | 1) => void;
  previewWidth: number;
  onPreviewWidthChange: (width: number) => void;
  onOpenFullscreen: () => void;
  showPanels: boolean;
  onTogglePanels: () => void;
}

export const AudioPlayerControls: React.FC<AudioPlayerControlsProps> = ({
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  playbackRate,
  loopRange,
  onTogglePlay,
  onSeek,
  onSetVolume,
  onToggleMute,
  onSetPlaybackRate,
  onClearLoop,
  canGoToPreviousWord,
  canGoToNextWord,
  onGoToWord,
  previewWidth,
  onPreviewWidthChange,
  onOpenFullscreen,
  showPanels,
  onTogglePanels,
}) => {
  const safeDuration = duration > 0 ? duration : 1;
  const progressPercent = Math.min(100, (currentTime / safeDuration) * 100);

  const speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5];

  return (
    <div className="bg-neutral-900/90 border border-neutral-800/90 rounded-2xl p-4 shadow-xl backdrop-blur-md">
      {/* Progress Bar */}
      <div className="mb-3">
        <div className="relative flex items-center group cursor-pointer py-1">
          <input
            id="audio-scrubber-slider"
            type="range"
            min={0}
            max={safeDuration}
            step={0.01}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full h-2 rounded-lg bg-neutral-800 appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between text-xs font-mono text-neutral-400 mt-1">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400 font-bold">{formatTimeMs(currentTime)}</span>
            {loopRange && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/40 flex items-center gap-1">
                <Repeat className="w-2.5 h-2.5 animate-spin" />
                <span>Петля ({formatTimeMs(loopRange.start)} - {formatTimeMs(loopRange.end)})</span>
                {onClearLoop && (
                  <button
                    type="button"
                    onClick={onClearLoop}
                    className="icon-control icon-control--tiny ml-1 hover:text-white text-indigo-400 cursor-pointer"
                    title="Отключить петлю"
                    aria-label="Отключить петлю"
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </span>
            )}
          </div>
          <span>{formatTimeMs(duration)}</span>
        </div>
      </div>

      {/* Main Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left: playback rate and preview size */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Rate Selector */}
          <div className="flex items-center gap-1 bg-neutral-950 px-2 py-1 rounded-xl border border-neutral-800">
            <Gauge className="w-3.5 h-3.5 text-neutral-400" />
            <select
              id="playback-speed-select"
              value={playbackRate}
              onChange={(e) => onSetPlaybackRate(parseFloat(e.target.value))}
              className="bg-transparent text-xs font-mono text-cyan-400 focus:outline-none cursor-pointer pr-1"
            >
              {speedOptions.map((rate) => (
                <option key={rate} value={rate} className="bg-neutral-900 text-neutral-200">
                  {rate}x
                </option>
              ))}
            </select>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-800 px-2.5 py-1.5"
            title={`Размер предпросмотра: ${previewWidth}% (на экспорт не влияет)`}
          >
            <ZoomIn className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
            <input
              id="preview-width-slider"
              type="range"
              min={40}
              max={100}
              step={5}
              value={previewWidth}
              onChange={(event) => onPreviewWidthChange(Number(event.target.value))}
              className="w-24 cursor-pointer accent-cyan-400"
              aria-label="Размер окна предпросмотра"
            />
          </div>
          <button
            id="btn-open-preview-fullscreen"
            type="button"
            onClick={onOpenFullscreen}
            className="grid h-9 w-9 place-items-center rounded-xl border border-neutral-700 bg-neutral-800 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
            title="Открыть предпросмотр на весь экран"
            aria-label="Открыть предпросмотр на весь экран"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Center: Main Transport Buttons */}
        <div className="flex items-center gap-3">
          <button
            id="btn-restart-audio"
            type="button"
            onClick={() => onSeek(0)}
            className="icon-control mr-2 p-2.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer"
            title="В начало трека"
            aria-label="В начало трека"
          >
            <SkipBack className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            id="btn-previous-word"
            type="button"
            onClick={() => onGoToWord(-1)}
            disabled={!canGoToPreviousWord}
            className="icon-control p-2.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-neutral-800 disabled:hover:text-neutral-300"
            title="Предыдущее слово"
            aria-label="Предыдущее слово"
          >
            <StepBack className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            id="btn-next-word"
            type="button"
            onClick={() => onGoToWord(1)}
            disabled={!canGoToNextWord}
            className="icon-control p-2.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-neutral-800 disabled:hover:text-neutral-300"
            title="Следующее слово"
            aria-label="Следующее слово"
          >
            <StepForward className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            id="btn-play-pause-audio"
            type="button"
            onClick={onTogglePlay}
            className="w-12 h-12 rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-cyan-500/25 ring-2 ring-white/20 active:scale-95 transition-all cursor-pointer"
            title={isPlaying ? 'Пауза (Space)' : 'Воспроизведение (Space)'}
            aria-label={isPlaying ? 'Пауза' : 'Воспроизведение'}
            aria-pressed={isPlaying}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          <button
            id="btn-rewind-5s"
            type="button"
            onClick={() => onSeek(Math.max(0, currentTime - 5))}
            className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer"
            title="Назад на 5 секунд"
            aria-label="Назад на 5 секунд"
          >
            <Rewind className="w-4 h-4" />
          </button>

          <button
            id="btn-forward-5s"
            type="button"
            onClick={() => onSeek(Math.min(safeDuration, currentTime + 5))}
            className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer"
            title="Вперёд на 5 секунд"
            aria-label="Вперёд на 5 секунд"
          >
            <FastForward className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Volume Controls */}
        <div className="flex items-center gap-2">
          <button
            id="btn-toggle-mute"
            type="button"
            onClick={onToggleMute}
            className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer"
            title={isMuted ? 'Включить звук' : 'Выключить звук'}
            aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
            aria-pressed={isMuted}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-red-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-cyan-400" />
            )}
          </button>
          <input
            id="audio-volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={isMuted ? 0 : volume}
            onChange={(e) => onSetVolume(parseFloat(e.target.value))}
            className="w-20 sm:w-24 h-1.5 rounded-lg bg-neutral-800 appearance-none cursor-pointer accent-cyan-400"
            title={`Громкость: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
          />
          <button
            id="btn-toggle-panels"
            type="button"
            onClick={onTogglePanels}
            className={`p-2 rounded-xl border transition-colors cursor-pointer ${
              showPanels
                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                : 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700 text-neutral-300 hover:text-white'
            }`}
            title={showPanels ? 'Скрыть панели под плеером' : 'Показать панели под плеером'}
            aria-label={showPanels ? 'Скрыть панели редактора' : 'Показать панели редактора'}
            aria-pressed={showPanels}
          >
            {showPanels ? (
              <PanelBottomClose className="w-4 h-4" aria-hidden="true" />
            ) : (
              <PanelBottomOpen className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
