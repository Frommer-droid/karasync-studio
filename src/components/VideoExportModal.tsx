import React, { useState, useEffect, useRef } from 'react';
import { LineTiming, WordTiming, VideoPreviewConfig } from '../../shared/types';
import {
  VideoExportProgress,
  ClientKaraokeVideoExporter,
  getBestSupportedVideoMimeType,
} from '../services/videoExporter';
import {
  OfflineKaraokeVideoExporter,
  isOfflineMp4ExportSupported,
  getOfflineSupportInfo,
  OfflineSupportInfo,
} from '../services/offlineVideoExporter';
import { getOriginalAudioBlob } from '../services/audioStorage';
import {
  Film,
  Download,
  X,
  RotateCcw,
  AlertTriangle,
  Clock,
  HardDrive,
  Loader2,
  CheckCircle2,
  Music,
  UploadCloud,
  FileAudio,
  Sparkles,
} from 'lucide-react';

interface VideoExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: LineTiming[];
  words: WordTiming[];
  audioFile: File | Blob | null;
  audioFileName: string;
  audioDuration: number;
  audioUrl?: string | null;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  config: VideoPreviewConfig;
  onReselectAudio?: (file: File) => Promise<void>;
}

type AudioSourceType = 'memory' | 'IndexedDB' | 'reselected' | 'not_found';
type ExportMode = 'full' | 'test_20s';

export const VideoExportModal: React.FC<VideoExportModalProps> = ({
  isOpen,
  onClose,
  lines,
  words,
  audioFile,
  audioFileName,
  audioDuration,
  audioUrl,
  audioRef,
  config,
  onReselectAudio,
}) => {
  const [exportMode, setExportMode] = useState<ExportMode>('full');
  const [testStartSec, setTestStartSec] = useState<number>(0);
  const [enableDebugOverlay, setEnableDebugOverlay] = useState<boolean>(false);
  const [forcedFormat, setForcedFormat] = useState<'auto' | 'mp4' | 'webm'>('auto');
  const [exportFps, setExportFps] = useState<number>(30);

  const [exportProgress, setExportProgress] = useState<VideoExportProgress | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio resolution states
  const [resolvedAudioFile, setResolvedAudioFile] = useState<Blob | File | null>(audioFile);
  const [resolvedFileName, setResolvedFileName] = useState<string>(audioFileName);
  const [resolvedFileSize, setResolvedFileSize] = useState<number>(0);
  const [resolvedMimeType, setResolvedMimeType] = useState<string>('audio/mpeg');
  const [resolvedDuration, setResolvedDuration] = useState<number>(audioDuration);
  const [audioSourceType, setAudioSourceType] = useState<AudioSourceType>('not_found');
  const [isResolvingAudio, setIsResolvingAudio] = useState<boolean>(false);

  const [detectedFormatInfo, setDetectedFormatInfo] = useState<{ format: 'mp4' | 'webm'; mimeType: string }>({
    format: 'webm',
    mimeType: 'video/webm',
  });

  // Быстрый путь: детальная поддержка + какой путь реально используется
  const [offlineInfo, setOfflineInfo] = useState<OfflineSupportInfo | null>(null);
  const [exportPath, setExportPath] = useState<'offline' | 'realtime' | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [coverNote, setCoverNote] = useState<string | null>(null);

  const exporterRef = useRef<{ cancel: () => void } | null>(null);
  const bgImageElementRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // fps по умолчанию подгоняем под клип заставки (только в момент открытия),
  // чтобы его кадры ложились 1:1 без рывков; дальше пользователь правит вручную.
  useEffect(() => {
    if (isOpen) {
      const coverFps = config.coverVideo?.videoFps ?? 0;
      const coverOn = config.coverVideo?.enabledIntro === true || config.coverVideo?.enabledOutro === true;
      if (coverOn && [24, 25, 30, 60].includes(Math.round(coverFps))) {
        setExportFps(Math.round(coverFps));
      } else {
        setExportFps(30);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Check supported format on open
  useEffect(() => {
    if (isOpen) {
      setDetectedFormatInfo(getBestSupportedVideoMimeType(forcedFormat === 'auto' ? undefined : forcedFormat));
      setOfflineInfo(null);
      getOfflineSupportInfo(1920, 1080, exportFps).then((info) => {
        setOfflineInfo(info);
        console.log('[VIDEO] Offline fast-path support:', info.reason, info.checkedProfiles);
      });
    } else {
      setExportPath(null);
      setExportNote(null);
      setCoverNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, forcedFormat, exportFps]);

  // Set default test start position from current audio player time if available
  useEffect(() => {
    if (isOpen && audioRef?.current?.currentTime) {
      const cur = Math.floor(audioRef.current.currentTime);
      if (cur > 0 && cur < resolvedDuration - 20) {
        setTestStartSec(cur);
      }
    }
  }, [isOpen, audioRef, resolvedDuration]);

  // Measure audio duration directly from audio File/Blob using HTMLAudioElement
  const measureExactDurationFromBlob = (blob: Blob): Promise<number> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio();
      audio.preload = 'metadata';

      const cleanup = () => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      };

      audio.onloadedmetadata = () => {
        const dur = audio.duration;
        cleanup();
        if (dur && !isNaN(dur) && dur > 0) {
          resolve(dur);
        } else {
          resolve(0);
        }
      };

      audio.onerror = () => {
        cleanup();
        resolve(0);
      };

      setTimeout(() => {
        cleanup();
        resolve(0);
      }, 3500);

      audio.src = url;
    });
  };

  // Resolve audio source on open or props change
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setErrorMessage(null);
    setIsResolvingAudio(true);

    async function resolveAudio() {
      try {
        // Priority 1: Audio file passed in memory
        if (audioFile && audioFile.size > 0) {
          if (!isMounted) return;
          setResolvedAudioFile(audioFile);
          const name = (audioFile as File).name || audioFileName || 'original_song.mp3';
          setResolvedFileName(name);
          setResolvedFileSize(audioFile.size);
          setResolvedMimeType(audioFile.type || 'audio/mpeg');
          setAudioSourceType('memory');

          const exactDuration = await measureExactDurationFromBlob(audioFile);
          if (isMounted) {
            const finalDur = exactDuration > 0 ? exactDuration : audioDuration;
            setResolvedDuration(finalDur);
            console.log(`[VIDEO DIAGNOSTIC] Source: memory, Name: ${name}, Size: ${audioFile.size}B, Exact duration: ${finalDur}`);
          }
          return;
        }

        // Priority 2: Restore from IndexedDB
        const stored = await getOriginalAudioBlob();
        if (stored && stored.blob && stored.blob.size > 0) {
          if (!isMounted) return;
          setResolvedAudioFile(stored.file);
          setResolvedFileName(stored.name || audioFileName || 'original_song.mp3');
          setResolvedFileSize(stored.size || stored.blob.size);
          setResolvedMimeType(stored.type || 'audio/mpeg');
          setAudioSourceType('IndexedDB');

          const exactDuration = await measureExactDurationFromBlob(stored.blob);
          if (isMounted) {
            const finalDur = exactDuration > 0 ? exactDuration : audioDuration;
            setResolvedDuration(finalDur);
            console.log(`[VIDEO DIAGNOSTIC] Source: IndexedDB, Name: ${stored.name}, Size: ${stored.size}B, Exact duration: ${finalDur}`);
          }
          return;
        }

        // Priority 3: AudioRef or audioUrl candidate in memory
        const candidateUrl = audioUrl || audioRef?.current?.src;
        if (candidateUrl && (candidateUrl.startsWith('blob:') || candidateUrl.startsWith('data:') || candidateUrl.startsWith('http'))) {
          try {
            const res = await fetch(candidateUrl);
            const blob = await res.blob();
            if (blob && blob.size > 0 && isMounted) {
              setResolvedAudioFile(blob);
              setResolvedFileName(audioFileName || 'original_song.mp3');
              setResolvedFileSize(blob.size);
              setResolvedMimeType(blob.type || 'audio/mpeg');
              setAudioSourceType('memory');

              const exactDuration = await measureExactDurationFromBlob(blob);
              if (isMounted) {
                const finalDur = exactDuration > 0 ? exactDuration : audioDuration;
                setResolvedDuration(finalDur);
                console.log(`[VIDEO DIAGNOSTIC] Source: memory (fetched URL), Exact duration: ${finalDur}`);
              }
              return;
            }
          } catch (e) {
            console.warn('[VIDEO] Could not fetch candidate audio URL:', e);
          }
        }

        // Fallback: Not found
        if (isMounted) {
          setAudioSourceType('not_found');
          setResolvedAudioFile(null);
          setResolvedDuration(audioDuration);
          console.warn('[VIDEO DIAGNOSTIC] Audio source: not_found');
        }
      } catch (err) {
        console.error('[VIDEO] Error resolving audio:', err);
        if (isMounted) {
          setAudioSourceType('not_found');
        }
      } finally {
        if (isMounted) {
          setIsResolvingAudio(false);
        }
      }
    }

    resolveAudio();

    return () => {
      isMounted = false;
    };
  }, [isOpen, audioFile, audioFileName, audioDuration, audioUrl, audioRef]);

  // Load custom background image element if specified in config
  useEffect(() => {
    if (!config.backgroundImageUrl) {
      bgImageElementRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = config.backgroundImageUrl;
    img.onload = () => {
      bgImageElementRef.current = img;
    };
  }, [config.backgroundImageUrl]);

  if (!isOpen) return null;

  const trackTitle = resolvedFileName.replace(/\.[^/.]+$/, '') || 'karaoke_video';

  // Handle reselecting the original audio file
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setResolvedAudioFile(file);
    setResolvedFileName(file.name);
    setResolvedFileSize(file.size);
    setResolvedMimeType(file.type || 'audio/mpeg');
    setAudioSourceType('reselected');

    const exactDuration = await measureExactDurationFromBlob(file);
    const effectiveDur = exactDuration > 0 ? exactDuration : audioDuration;
    setResolvedDuration(effectiveDur);

    console.log(`[VIDEO DIAGNOSTIC] Audio reselected: Name=${file.name}, Size=${file.size}B, Duration=${effectiveDur}`);

    if (onReselectAudio) {
      try {
        await onReselectAudio(file);
      } catch (err) {
        console.warn('[VIDEO] onReselectAudio handler error:', err);
      }
    }
  };

  const handleStartExport = async () => {
    setErrorMessage(null);

    // 1. Validate original audio file
    if (!resolvedAudioFile) {
      const err = 'Не найден исходный аудиофайл песни. Пожалуйста, выберите файл песни повторно.';
      console.error('[VIDEO] Error:', err);
      setErrorMessage(err);
      return;
    }

    // 2. Validate duration
    let effectiveDuration = resolvedDuration;
    if (effectiveDuration <= 0) {
      effectiveDuration = await measureExactDurationFromBlob(resolvedAudioFile);
    }
    if (effectiveDuration <= 0 && audioRef?.current?.duration && !isNaN(audioRef.current.duration)) {
      effectiveDuration = audioRef.current.duration;
    }

    if (effectiveDuration <= 0) {
      const err = 'Не удалось определить длительность оригинального аудиофайла. Проверьте аудиофайл.';
      console.error('[VIDEO] Error:', err);
      setErrorMessage(err);
      return;
    }

    // Setup start time & export duration depending on mode
    const isTest = exportMode === 'test_20s';
    const startTime = isTest ? Math.min(testStartSec, Math.max(0, effectiveDuration - 5)) : 0;
    const targetDuration = isTest ? Math.min(20, effectiveDuration - startTime) : effectiveDuration;

    console.log(
      `[VIDEO] Starting export: mode=${exportMode}, start=${startTime.toFixed(2)}s, targetDuration=${targetDuration.toFixed(2)}s, format=${detectedFormatInfo.format}`
    );

    setIsExporting(true);
    setResultVideoUrl(null);
    setExportPath(null);
    setExportNote(null);
    setCoverNote(null);
    setExportProgress({
      status: 'preparing',
      percent: 0,
      elapsedSeconds: 0,
        remainingSeconds: Math.ceil(targetDuration),
        fps: exportFps,
        currentFrame: 0,
        totalFrames: Math.ceil(targetDuration * exportFps),
      format: detectedFormatInfo.format,
      mimeType: detectedFormatInfo.mimeType,
      blobUrl: null,
    });

    const exporter = new ClientKaraokeVideoExporter();
    exporterRef.current = exporter;

    try {
      // Fast path: offline WebCodecs render (faster than realtime, MP4 only).
      // Falls back to the realtime MediaRecorder path when unsupported or WebM forced.
      const canGoOffline = detectedFormatInfo.format === 'mp4'
        && await isOfflineMp4ExportSupported(1920, 1080, exportFps);
      console.log(`[VIDEO] Export path: ${canGoOffline ? 'OFFLINE WebCodecs (fast)' : 'REALTIME MediaRecorder'}`);

      const exportOptions = {
        audioBlob: resolvedAudioFile,
        audioDuration: effectiveDuration,
        lines,
        words,
        config,
        startTime,
        exportDuration: targetDuration,
        enableDebugOverlay: isTest || enableDebugOverlay,
        forcedFormat: forcedFormat === 'auto' ? undefined : forcedFormat,
        backgroundImageElement: bgImageElementRef.current,
        width: 1920,
        height: 1080,
        fps: exportFps,
        onProgress: (p: VideoExportProgress) => {
          setExportProgress(p);
        },
        onCoverWarning: (message: string) => {
          setCoverNote(message);
        },
      };

      let videoUrl: string | null;
      if (canGoOffline) {
        const offlineExporter = new OfflineKaraokeVideoExporter();
        exporterRef.current = offlineExporter;
        setExportPath('offline');
        try {
          videoUrl = await offlineExporter.exportVideo(exportOptions);
        } catch (offlineErr: any) {
          // Офлайн-путь не завёлся (например, кодер отверг конфиг) —
          // автоматически откатываемся на проверенный realtime-путь.
          const reason = offlineErr?.message || String(offlineErr);
          console.error('[VIDEO] Offline export failed, falling back to realtime:', offlineErr);
          setExportNote(`Быстрый путь не удался (${reason}) — пишу в реальном времени`);
          const realtimeExporter = new ClientKaraokeVideoExporter();
          exporterRef.current = realtimeExporter;
          setExportPath('realtime');
          videoUrl = await realtimeExporter.exportVideo(exportOptions);
        }
      } else {
        setExportPath('realtime');
        videoUrl = await exporter.exportVideo(exportOptions);
      }

      if (!videoUrl) return; // cancelled
      setResultVideoUrl(videoUrl);
    } catch (err: any) {
      console.error('[VIDEO] Video export error:', err);
      const msg = err?.message || 'Не удалось создать видео. Проверьте поддержку браузера.';
      setErrorMessage(msg);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCancelExport = () => {
    if (exporterRef.current) {
      exporterRef.current.cancel();
      exporterRef.current = null;
    }
    setIsExporting(false);
    setExportProgress(null);
  };

  const handleDownloadVideo = () => {
    if (!resultVideoUrl) return;
    const format = exportProgress?.format || detectedFormatInfo.format;
    const isTest = exportMode === 'test_20s';
    const suffix = isTest ? `_test_${testStartSec}s-20s` : '';
    const a = document.createElement('a');
    a.href = resultVideoUrl;
    a.download = `${trackTitle}${suffix}_karaoke_1080p.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatSec = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatDurationDisplay = (seconds: number): string => {
    if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00.000';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Hidden File Input for Reselecting Audio */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Создание караоке-видео
              </h3>
              <p className="text-xs text-neutral-400 font-mono">
                1920×1080 Full HD • {exportFps} FPS • Тайминг 1:1 без коррекции
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={isExporting ? handleCancelExport : onClose}
            className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Diagnostic Section: Audio File Verification */}
          <div className="p-4 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-neutral-200 flex items-center gap-2">
                <Music className="w-4 h-4 text-cyan-400" />
                Диагностика оригинального аудио
              </span>

              <div className="flex items-center gap-2">
                {audioSourceType === 'memory' && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Источник: Память приложения (RAM)
                  </span>
                )}
                {audioSourceType === 'IndexedDB' && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    Источник: База IndexedDB
                  </span>
                )}
                {audioSourceType === 'reselected' && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                    Источник: Выбран повторно
                  </span>
                )}
                {audioSourceType === 'not_found' && !isResolvingAudio && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
                    Файл не найден
                  </span>
                )}
                {isResolvingAudio && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Поиск в IndexedDB...
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs">
              <div className="p-2.5 rounded-xl bg-neutral-900/80 border border-neutral-800/80">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 block mb-0.5">Original audio file</span>
                <span className="font-mono text-neutral-200 text-[11px] font-semibold truncate block" title={resolvedFileName}>
                  {resolvedFileName || '—'}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-neutral-900/80 border border-neutral-800/80">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 block mb-0.5">File size</span>
                <span className="font-mono text-neutral-200 text-[11px] font-semibold">
                  {formatBytes(resolvedFileSize)}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-neutral-900/80 border border-neutral-800/80">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 block mb-0.5">MIME type</span>
                <span className="font-mono text-neutral-200 text-[11px]">
                  {resolvedMimeType || 'audio/mpeg'}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-neutral-900/80 border border-neutral-800/80">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 block mb-0.5">Audio duration</span>
                <span className="font-mono text-cyan-400 font-bold text-[11px]">
                  {formatDurationDisplay(resolvedDuration)}
                </span>
              </div>
            </div>

            {/* Re-select Audio Button */}
            {(!resolvedAudioFile || audioSourceType === 'not_found') && !isResolvingAudio && (
              <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-xs text-amber-200">
                  <FileAudio className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Исходный файл не найден в памяти. Выберите файл песни повторно (все таймкоды и слова сохранятся).</span>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Выбрать исходную песню повторно</span>
                </button>
              </div>
            )}
          </div>

          {/* Export Mode Selection: Quick 20s Test vs Full Song (Requirement 10) */}
          <div className="p-4 rounded-2xl bg-neutral-950/90 border border-cyan-500/20 space-y-3">
            <label className="text-xs font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Режим создания видео
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setExportMode('full')}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  exportMode === 'full'
                    ? 'bg-cyan-500/15 border-cyan-500 text-white shadow-lg shadow-cyan-500/10'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs">Полный экспорт песни</span>
                  <span className="text-[11px] font-mono text-cyan-400">{formatDurationDisplay(resolvedDuration)}</span>
                </div>
                <span className="text-[11px] text-neutral-400 mt-1">
                  Рендеринг всей композиции от начала до конца в 1080p
                </span>
              </button>

              <button
                type="button"
                onClick={() => setExportMode('test_20s')}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  exportMode === 'test_20s'
                    ? 'bg-purple-500/20 border-purple-500 text-white shadow-lg shadow-purple-500/10'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs flex items-center gap-1.5">
                    <span>Быстрый тест (20 секунд)</span>
                    <span className="px-1.5 py-0.5 text-[9px] rounded bg-purple-500/30 text-purple-300 font-bold uppercase">Рекомендуется</span>
                  </span>
                  <span className="text-[11px] font-mono text-purple-300">20 сек</span>
                </div>
                <span className="text-[11px] text-neutral-400 mt-1">
                  Быстрая проверка переключения строк и заливки слов без ожидания 4 минут
                </span>
              </button>
            </div>

            {/* If test mode: select starting position */}
            {exportMode === 'test_20s' && (
              <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-500/30 space-y-2 mt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-purple-200">
                    Начальная позиция теста (будет экспортировано {testStartSec}s → {testStartSec + 20}s):
                  </span>
                  <span className="font-mono font-bold text-purple-300">{testStartSec} сек</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {[
                    { label: '0 сек (Вступление)', val: 0 },
                    { label: '60 сек (Куплет)', val: 60 },
                    { label: '100 сек (Припев/середина)', val: 100 },
                    { label: '120 сек (2:00)', val: 120 },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setTestStartSec(preset.val)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                        testStartSec === preset.val
                          ? 'bg-purple-500 text-white font-bold'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                  {audioRef?.current && (
                    <button
                      type="button"
                      onClick={() => setTestStartSec(Math.floor(audioRef.current!.currentTime))}
                      className="px-3 py-1 rounded-lg text-xs font-mono bg-cyan-950 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-900 transition-all cursor-pointer"
                    >
                      Текущая позиция плеера ({Math.floor(audioRef.current.currentTime)}s)
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-red-950/70 border border-red-500/50 flex items-start gap-3 shadow-lg">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h5 className="text-xs font-bold text-red-300">Ошибка при создании видео</h5>
                <p className="text-xs text-red-200/90 mt-0.5 leading-relaxed">{errorMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Active Status / Progress Overlay if exporting */}
          {isExporting && exportProgress && (
            <div className="p-6 rounded-2xl bg-neutral-950 border border-cyan-500/30 space-y-5 shadow-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {exportProgress.status === 'preparing' && 'Подготовка аудиопотока и холста...'}
                      {exportProgress.status === 'rendering' && 'Рендеринг видеокадров и синхронизация слов...'}
                      {exportProgress.status === 'encoding' && 'Финальная сборка видеофайла...'}
                    </h4>
                    <span className="text-xs text-neutral-400 font-mono">
                      Формат: <strong className="uppercase text-cyan-400">{exportProgress.format}</strong> ({exportProgress.mimeType})
                    </span>
                  </div>
                </div>
                <span className="text-2xl font-black font-mono text-cyan-400">
                  {exportProgress.percent}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-neutral-800 rounded-full h-3 overflow-hidden p-0.5 border border-neutral-700">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500 rounded-full transition-all duration-200"
                  style={{ width: `${exportProgress.percent}%` }}
                />
              </div>

              {exportNote && (
                <div className="px-3.5 py-2 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200">
                  {exportNote}
                </div>
              )}

              {coverNote && (
                <div className="px-3.5 py-2 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200">
                  {coverNote}
                </div>
              )}

              {/* Statistics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-col">
                  <span className="text-neutral-500 mb-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-neutral-400" /> Прошло времени
                  </span>
                  <span className="font-mono font-bold text-neutral-200">
                    {formatSec(exportProgress.elapsedSeconds)}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-col">
                  <span className="text-neutral-500 mb-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" /> Осталось (приблиз.)
                  </span>
                  <span className="font-mono font-bold text-cyan-300">
                    {formatSec(exportProgress.remainingSeconds)}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-col">
                  <span className="text-neutral-500 mb-1">Кадр / Всего</span>
                  <span className="font-mono font-bold text-neutral-200">
                    {exportProgress.currentFrame} / {exportProgress.totalFrames}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-col">
                  <span className="text-neutral-500 mb-1">FPS / Скорость</span>
                  <span className={`font-mono font-bold ${exportPath === 'offline' ? 'text-emerald-400' : 'text-neutral-200'}`}>
                    {exportProgress.elapsedSeconds > 0
                      ? `${Math.round(exportProgress.currentFrame / Math.max(1, exportProgress.elapsedSeconds))} FPS • ${exportPath === 'offline' ? 'Офлайн' : 'Real-time'}`
                      : `… FPS • ${exportPath === 'offline' ? 'Офлайн' : 'Real-time'}`}
                  </span>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCancelExport}
                  className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-red-950/60 text-red-300 text-xs font-semibold border border-red-500/30 transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Completed State: Video Player Result & Download */}
          {!isExporting && resultVideoUrl && (
            <div className="p-6 rounded-2xl bg-gradient-to-b from-neutral-950 to-neutral-900 border border-emerald-500/40 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <h4 className="text-sm font-bold text-white">Видео успешно создано!</h4>
                </div>
                <div className="flex items-center gap-2">
                  {exportProgress?.outputDurationVerified !== undefined && exportProgress.outputDurationVerified > 0 && (
                    <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                      Длительность видео: {exportProgress.outputDurationVerified.toFixed(2)}s
                    </span>
                  )}
                  {exportProgress?.fileSizeFormatted && (
                    <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-neutral-800 text-neutral-300 border border-neutral-700">
                      Размер: {exportProgress.fileSizeFormatted}
                    </span>
                  )}
                </div>
              </div>

              {/* Video Player */}
              <div className="relative rounded-2xl overflow-hidden bg-black border border-neutral-800 shadow-xl" style={{ aspectRatio: '16/9' }}>
                <video
                  src={resultVideoUrl}
                  controls
                  preload="metadata"
                  className="w-full h-full object-contain"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setResultVideoUrl(null)}
                  className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold flex items-center gap-2 border border-neutral-700 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Пересоздать видео</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadVideo}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-500/30 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Сохранить видео ({exportProgress?.format?.toUpperCase() || 'VIDEO'})</span>
                </button>
              </div>
            </div>
          )}

          {/* Configuration Form before Export */}
          {!isExporting && !resultVideoUrl && (
            <div className="space-y-6">
              {/* Группа: Параметры экспорта */}
              <div className="p-4 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-4">
                <div className="text-xs font-bold uppercase tracking-widest text-neutral-500">Параметры экспорта</div>

                {/* Формат и кодек */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <HardDrive className="w-5 h-5 text-cyan-400" />
                    <div>
                      <span className="text-xs font-semibold text-white">
                        Формат и кодек записи:
                      </span>
                      <p className="text-[11px] text-neutral-400">
                        {detectedFormatInfo.format === 'mp4'
                          ? 'Браузер поддерживает прямое кодирование в MP4 (H.264 / AAC)'
                          : 'Используется контейнер WebM (VP9/VP8) с высокой совместимостью.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={forcedFormat}
                      onChange={(e) => setForcedFormat(e.target.value as any)}
                      className="px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-700 text-xs font-semibold text-neutral-200 cursor-pointer"
                    >
                      <option value="auto">Авто (Рекомендуется: {detectedFormatInfo.format.toUpperCase()})</option>
                      <option value="mp4">MP4 (H.264)</option>
                      <option value="webm">WebM (VP9/VP8)</option>
                    </select>
                  </div>
                </div>

                {/* Частота кадров: под клип заставки — без рывков */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-white">
                    Частота кадров:
                    <p className="text-[11px] text-neutral-400 font-normal">
                      {config.coverVideo?.videoFps
                        ? `Клип заставки: ${config.coverVideo.videoFps} fps — совпадение даёт плавность`
                        : 'Кадры текста рисуются с этой частотой'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={exportFps}
                      onChange={(e) => setExportFps(parseInt(e.target.value))}
                      className="px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-700 text-xs font-semibold text-neutral-200 cursor-pointer"
                    >
                      {[24, 25, 30, 60].map((f) => (
                        <option key={f} value={f}>{f} fps</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Статус быстрого пути */}
                <div className="flex items-center gap-2 text-[11px] font-mono pt-3 border-t border-neutral-800">
                  {!offlineInfo ? (
                    <span className="text-neutral-500">Проверка ускорения…</span>
                  ) : offlineInfo.supported ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                      ⚡ Быстрый экспорт доступен ({offlineInfo.videoCodec})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30" title={offlineInfo.checkedProfiles.map((p) => `${p.codec}: ${p.supported ? 'ok' : 'нет'}`).join(', ')}>
                      Быстрый экспорт недоступен: {offlineInfo.reason} — будет realtime
                    </span>
                  )}
                </div>

                {/* Диагностический оверлей */}
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-neutral-800">
                  <label className="flex items-center gap-3 cursor-pointer text-xs font-semibold text-neutral-300">
                    <input
                      type="checkbox"
                      checked={exportMode === 'test_20s' || enableDebugOverlay}
                      onChange={(e) => setEnableDebugOverlay(e.target.checked)}
                      disabled={exportMode === 'test_20s'}
                      className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
                    />
                    <span>Впечатать диагностический оверлей тайминга в левый верхний угол (MEDIA, EFFECTIVE, LINE, WORD, OFFSET)</span>
                  </label>
                  <span className="text-[11px] font-mono text-neutral-500 whitespace-nowrap">
                    {exportMode === 'test_20s' ? 'Включен для теста' : (enableDebugOverlay ? 'Включен' : 'Выключен')}
                  </span>
                </div>
              </div>

              {/* Оформление (шрифт, цвета, позиция, подсказка) берётся из предпросмотра */}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-between">
          <div className="text-xs text-neutral-400 font-mono">
            Длительность аудио: <strong className="text-cyan-400 font-semibold">{formatDurationDisplay(resolvedDuration)}</strong> • Строк: {lines.length} • Слов: {words.length}
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Re-select Audio Button in footer */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 text-xs font-semibold border border-neutral-800 transition-colors cursor-pointer flex items-center gap-1.5"
              title="Заменить или восстановить аудиофайл"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Выбрать файл</span>
            </button>

            <button
              type="button"
              onClick={isExporting ? handleCancelExport : onClose}
              className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold border border-neutral-700 transition-colors cursor-pointer"
            >
              Закрыть
            </button>

            {!resultVideoUrl && (
              <button
                type="button"
                disabled={isExporting || lines.length === 0 || !resolvedAudioFile}
                onClick={handleStartExport}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Создание видео...</span>
                  </>
                ) : (
                  <>
                    <Film className="w-4 h-4" />
                    <span>{exportMode === 'test_20s' ? 'Создать тест (20 сек)' : 'Создать полное видео'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
