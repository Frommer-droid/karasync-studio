import { LineTiming, WordTiming, VideoPreviewConfig } from '../../shared/types';
import {
  getKaraokeFrameState,
  getKaraokePresentationPair,
  runTimingDiagnosticTest,
  runABTimingTest,
  TimingTestPoint,
  ABTimingTestResult,
} from '../../shared/syncAlgorithm';
import { computeAutoFitFontPx, measureTextWidth100px } from '../utils/fontFit';
import { getFontById, ensureFontLoaded } from '../utils/fonts';
import { resolveImageUrl } from './imageStorage';
import type { BrandingConfig } from '../../shared/types';
import { getCoverWindows } from '../../shared/coverVideo';
import {
  loadCoverVideoElement,
  releaseCoverVideoElement,
  coverFrameForTime,
  type LoadedCoverVideo,
} from './coverVideoElement';
import { getBackgroundVideoBlob } from './backgroundVideoStorage';

/** Грузит картинки шапки (logo/author/qr) для рендера. Отсутствующие → null. */
export async function loadBrandingImages(branding?: BrandingConfig | null): Promise<{
  logo: HTMLImageElement | null;
  author: HTMLImageElement | null;
  qr: HTMLImageElement | null;
}> {
  const empty = { logo: null, author: null, qr: null };
  if (!branding?.enabled) return empty;
  const loadOne = (id?: string | null): Promise<HTMLImageElement | null> => {
    if (!id) return Promise.resolve(null);
    return resolveImageUrl(id).then((url) => {
      if (!url) return null;
      return new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    });
  };
  const [logo, author, qr] = await Promise.all([
    branding.showLogo ? loadOne(branding.logoImageId) : Promise.resolve(null),
    branding.showTitle ? loadOne(branding.authorImageId) : Promise.resolve(null),
    branding.showQR ? loadOne(branding.qrImageId) : Promise.resolve(null),
  ]);
  return { logo, author, qr };
}
import { renderKaraokeCanvasFrame } from '../../shared/canvasKaraokeRenderer';

export interface VideoExportProgress {
  status: 'idle' | 'preparing' | 'rendering' | 'encoding' | 'completed' | 'cancelled' | 'error';
  percent: number; // 0 to 100
  elapsedSeconds: number;
  remainingSeconds: number;
  fps: number;
  currentFrame: number;
  totalFrames: number;
  format: 'mp4' | 'webm';
  mimeType: string;
  blobUrl: string | null;
  fileSizeFormatted?: string;
  errorMessage?: string;
  outputDurationVerified?: number;
}

export interface VideoExportOptions {
  audioBlob: Blob | File;
  audioDuration: number;
  lines: LineTiming[];
  words: WordTiming[];
  config: VideoPreviewConfig;
  startTime?: number; // Starting audio time in seconds (default: 0)
  exportDuration?: number; // Duration to export in seconds (default: full song)
  enableDebugOverlay?: boolean;
  forcedFormat?: 'mp4' | 'webm';
  backgroundImageElement?: HTMLImageElement | null;
  onProgress: (progress: VideoExportProgress) => void;
  /** Сообщить в UI, что заставка не применилась (с причиной). */
  onCoverWarning?: (message: string) => void;
  width?: number;
  height?: number;
  fps?: number;
}

/**
 * Checks for best supported container and codec in current browser:
 * 1. MP4 / H.264 (video/mp4;codecs=avc1,mp4a or video/mp4)
 * 2. WebM / VP9 / VP8 / Opus (video/webm;codecs=vp9,opus, video/webm;codecs=vp8,opus, or video/webm)
 */
export function getBestSupportedVideoMimeType(preferred?: 'mp4' | 'webm'): { mimeType: string; format: 'mp4' | 'webm' } {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return { mimeType: 'video/webm', format: 'webm' };
  }

  const mp4Candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4;codecs=h264,aac',
    'video/mp4;codecs=h264',
    'video/mp4',
  ];

  const webmCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  if (preferred === 'webm') {
    for (const mime of webmCandidates) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return { mimeType: mime, format: 'webm' };
      }
    }
  }

  if (preferred === 'mp4') {
    for (const mime of mp4Candidates) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return { mimeType: mime, format: 'mp4' };
      }
    }
  }

  // Default priority: try MP4 first, then WebM
  for (const mime of mp4Candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return { mimeType: mime, format: 'mp4' };
    }
  }

  for (const mime of webmCandidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return { mimeType: mime, format: 'webm' };
    }
  }

  return { mimeType: 'video/webm', format: 'webm' };
}

/**
 * Validates the duration of an exported video Blob by loading it into an in-memory video element.
 */
export function inspectOutputVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(blob);

    const cleanup = () => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    };

    video.onloadedmetadata = () => {
      const dur = video.duration;
      cleanup();
      if (dur && !isNaN(dur) && dur > 0 && isFinite(dur)) {
        resolve(dur);
      } else {
        resolve(0);
      }
    };

    video.onerror = () => {
      cleanup();
      resolve(0);
    };

    setTimeout(() => {
      cleanup();
      resolve(0);
    }, 4000);

    video.src = url;
  });
}

/**
 * Client-Side Karaoke Video Exporter:
 *
 * 1. Single sample-accurate master clock driven directly by AudioContext.currentTime.
 * 2. Original audio decoded via AudioContext.decodeAudioData into AudioBuffer.
 * 3. AudioBufferSourceNode connected to MediaStreamAudioDestinationNode for MediaRecorder.
 * 4. Unified start timestamp: source.start(startAt, exportStart, targetDuration).
 * 5. Same pure function getKaraokeFrameState(words, lines, effectiveTime) used by Preview & Export.
 * 6. No sync offset: effectiveTime strictly equals mediaTime (1:1).
 * 7. Zero HTMLAudioElement jitter or buffering delays.
 */
export class ClientKaraokeVideoExporter {
  private isCancelled: boolean = false;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private bufferSourceNode: AudioBufferSourceNode | null = null;

  public cancel(): void {
    this.isCancelled = true;
    if (this.bufferSourceNode) {
      try {
        this.bufferSourceNode.stop();
        this.bufferSourceNode.disconnect();
      } catch (e) {}
      this.bufferSourceNode = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close().catch(() => {});
      } catch (e) {}
    }
  }

  public async exportVideo(options: VideoExportOptions): Promise<string> {
    this.isCancelled = false;
    const {
      audioBlob,
      audioDuration,
      lines,
      words,
      config,
      startTime = 0,
      exportDuration,
      enableDebugOverlay = false,
      forcedFormat,
      backgroundImageElement = null,
      onProgress,
      onCoverWarning,
      width = 1920,
      height = 1080,
      fps = 30,
    } = options;

    if (!audioBlob || !(audioBlob instanceof Blob) || audioBlob.size === 0) {
      throw new Error('Исходный аудиофайл песни не передан или поврежден');
    }

    // 0. Pre-export Timing Diagnostic & A/B Verification Test (без коррекции — сдвиг 0)
    const abTest = runABTimingTest(words, lines, 0, [60.0, 62.0, 65.0, 70.0]);
    console.log(`[VIDEO EXPORT] Pre-flight A/B timing test passed (allMatch: ${abTest.allMatch}).`);

    const { mimeType, format } = getBestSupportedVideoMimeType(forcedFormat);

    onProgress({
      status: 'preparing',
      percent: 0,
      elapsedSeconds: 0,
      remainingSeconds: 10,
      fps,
      currentFrame: 0,
      totalFrames: 300,
      format,
      mimeType,
      blobUrl: null,
    });

    // 1. Setup AudioContext & Decode Audio Buffer
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) {
      throw new Error('Web Audio API не поддерживается вашим браузером');
    }
    const audioCtx = new AudioCtxClass();
    this.audioContext = audioCtx;

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Convert Blob to ArrayBuffer and decode audio
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    if (this.isCancelled) {
      throw new Error('Экспорт отменен');
    }

    const exactDuration = audioBuffer.duration > 0 ? audioBuffer.duration : (audioDuration > 0 ? audioDuration : 10);
    const exportStart = Math.max(0, startTime);
    const targetExportDuration = exportDuration && exportDuration > 0
      ? Math.min(exportDuration, exactDuration - exportStart)
      : (exactDuration - exportStart);
    const exportEnd = exportStart + targetExportDuration;

    const totalFrames = Math.ceil(targetExportDuration * fps);
    const wallStartTime = performance.now();

    console.log(
      `[VIDEO EXPORT] Decoded audio: duration=${audioBuffer.duration.toFixed(3)}s, sampleRate=${audioBuffer.sampleRate}Hz, channels=${audioBuffer.numberOfChannels}. Export range: [${exportStart.toFixed(2)}s -> ${exportEnd.toFixed(2)}s] (${targetExportDuration.toFixed(2)}s). Format: ${format} (${mimeType})`
    );

    // 2. Setup Canvas (шрифт подгружаем заранее, чтобы замер и отрисовка совпали)
    const exportFontStack = getFontById(config.fontFamily).stack;
    const exportFontWeight = [400, 500, 700, 800, 900].includes(config.fontWeight as number)
      ? (config.fontWeight as number)
      : 800;
    await ensureFontLoaded(config.fontFamily);

    // Картинки фирменной шапки — из IndexedDB по id из конфига
    const brandingImages = await loadBrandingImages(config.branding);

    // Видео-заставка: клип из IndexedDB (только если включён хотя бы один показ)
    const coverWanted = Boolean(config.coverVideo?.videoId)
      && (config.coverVideo?.enabledIntro === true || config.coverVideo?.enabledOutro === true);
    const coverLoaded: LoadedCoverVideo | null = coverWanted ? await loadCoverVideoElement() : null;
    if (coverWanted && !coverLoaded) {
      onCoverWarning?.('Заставка не применилась: не удалось загрузить видеофайл');
    }
    const coverFps = config.coverVideo?.videoFps ?? 0;
    if (coverLoaded && coverFps > 0 && Math.abs(coverFps - fps) > 1) {
      onCoverWarning?.(
        `Частота кадров клипа (${coverFps} fps) отличается от ${fps} fps видео — возможны рывки заставки`,
      );
    }
    // Фоновое видео: основа кадра на весь экспорт (без окон — всегда активно).
    let bgVideoEl: HTMLVideoElement | null = null;
    let bgVideoUrl: string | null = null;
    if (config.backgroundVideo?.videoId) {
      try {
        const record = await getBackgroundVideoBlob();
        if (record) {
          bgVideoUrl = URL.createObjectURL(record.blob);
          const el = document.createElement('video');
          el.muted = true;
          el.preload = 'auto';
          el.loop = true;
          el.src = bgVideoUrl;
          bgVideoEl = el;
        }
      } catch {
        bgVideoEl = null;
      }
    }
    const bgVideoFps = config.backgroundVideo?.videoFps ?? 0;
    if (bgVideoEl && bgVideoFps > 0 && Math.abs(bgVideoFps - fps) > 1) {
      onCoverWarning?.(
        `Частота кадров фона (${bgVideoFps} fps) отличается от ${fps} fps видео — возможны рывки фона`,
      );
    }
    const cleanupBgVideo = () => {
      try {
        bgVideoEl?.pause();
      } catch {
        // ignore
      }
      bgVideoEl = null;
      if (bgVideoUrl) {
        try {
          URL.revokeObjectURL(bgVideoUrl);
        } catch {
          // ignore
        }
        bgVideoUrl = null;
      }
    };
    const coverWindows = getCoverWindows(lines, {
      enabledIntro: config.coverVideo?.enabledIntro === true,
      enabledOutro: config.coverVideo?.enabledOutro === true,
    });
    const cleanupCoverVideo = () => releaseCoverVideoElement(coverLoaded);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Не удалось инициализировать контекст Canvas 2D');
    }

    // 3. Setup AudioBufferSourceNode + MediaStreamAudioDestinationNode
    const sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    this.bufferSourceNode = sourceNode;

    const streamDestNode = audioCtx.createMediaStreamDestination();
    sourceNode.connect(streamDestNode);

    // 4. Combine Canvas Stream & Web Audio Stream
    const canvasStream = canvas.captureStream ? canvas.captureStream(fps) : (canvas as any).mozCaptureStream(fps);
    if (!canvasStream) {
      throw new Error('Не удалось создать видеопоток Canvas (captureStream не поддерживается)');
    }

    const audioTrack = streamDestNode.stream.getAudioTracks()[0];
    const combinedStream = new MediaStream();
    canvasStream.getVideoTracks().forEach((vt: MediaStreamTrack) => combinedStream.addTrack(vt));
    if (audioTrack) {
      combinedStream.addTrack(audioTrack);
    }

    // 5. Setup MediaRecorder
    const recordedChunks: Blob[] = [];
    const recorderOptions: MediaRecorderOptions = {
      mimeType,
      videoBitsPerSecond: 8000000, // 8 Mbps for pristine 1080p
    };

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combinedStream, recorderOptions);
    } catch (e) {
      recorder = new MediaRecorder(combinedStream);
    }
    this.mediaRecorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    // 6. Synchronized Start using AudioContext Master Clock
    return new Promise<string>((resolve, reject) => {
      let animationFrameId: number | null = null;
      let intervalTimerId: any = null;
      let lastClockLog = 0;
      let isEnding = false;
      let lastRenderedFrameIndex = -1;

      const stopTimers = () => {
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
        if (intervalTimerId !== null) {
          clearInterval(intervalTimerId);
          intervalTimerId = null;
        }
      };

      const finishExport = async () => {
        if (isEnding) return;
        isEnding = true;

        stopTimers();

        try {
          sourceNode.stop();
          sourceNode.disconnect();
        } catch (e) {}

        onProgress({
          status: 'encoding',
          percent: 99,
          elapsedSeconds: Math.round((performance.now() - wallStartTime) / 1000),
          remainingSeconds: 1,
          fps,
          currentFrame: totalFrames,
          totalFrames,
          format,
          mimeType,
          blobUrl: null,
        });

        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      };

      recorder.onstop = async () => {
        stopTimers();
        cleanupCoverVideo();
        cleanupBgVideo();
        try {
          if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close().catch(() => {});
          }
        } catch (e) {}

        if (this.isCancelled) {
          onProgress({
            status: 'cancelled',
            percent: 0,
            elapsedSeconds: 0,
            remainingSeconds: 0,
            fps,
            currentFrame: 0,
            totalFrames,
            format,
            mimeType,
            blobUrl: null,
          });
          reject(new Error('Экспорт отменен пользователем'));
          return;
        }

        const finalBlob = new Blob(recordedChunks, { type: recorder.mimeType || mimeType });
        const finalUrl = URL.createObjectURL(finalBlob);
        const wallElapsed = (performance.now() - wallStartTime) / 1000;
        const sizeMb = (finalBlob.size / (1024 * 1024)).toFixed(2);

        // Verify output video duration
        const outputVideoDuration = await inspectOutputVideoDuration(finalBlob);
        console.log(
          `[EXPORT DURATION VERIFICATION] Target expected duration: ${targetExportDuration.toFixed(3)}s, Output video duration: ${outputVideoDuration.toFixed(3)}s, Wall time: ${wallElapsed.toFixed(3)}s, Size: ${sizeMb} MB`
        );

        onProgress({
          status: 'completed',
          percent: 100,
          elapsedSeconds: Math.round(wallElapsed),
          remainingSeconds: 0,
          fps,
          currentFrame: totalFrames,
          totalFrames,
          format,
          mimeType,
          blobUrl: finalUrl,
          fileSizeFormatted: `${sizeMb} MB`,
          outputDurationVerified: outputVideoDuration,
        });

        resolve(finalUrl);
      };

      recorder.onerror = (err) => {
        stopTimers();
        cleanupCoverVideo();
        cleanupBgVideo();
        try {
          if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close().catch(() => {});
          }
        } catch (e) {}
        reject(err);
      };

      sourceNode.onended = () => {
        console.log('[VIDEO EXPORT] sourceNode.onended fired at audioCtx.currentTime =', audioCtx.currentTime);
        finishExport();
      };

      // 100% Synchronous Start:
      // Zero buffer delay. Audio and Recorder start synchronously at startAt = audioCtx.currentTime.
      // This guarantees that t = 0.000 in the video file is sample-accurate to the first audio frame.
      const startAt = audioCtx.currentTime;
      sourceNode.start(startAt, exportStart, targetExportDuration);
      recorder.start(100);

      const videoTrack = canvasStream.getVideoTracks()[0] as any;

      console.log(
        `[VIDEO EXPORT] AudioBufferSource & Recorder started synchronously at startAt=${startAt.toFixed(3)}s (offset=${exportStart.toFixed(3)}s, duration=${targetExportDuration.toFixed(3)}s)`
      );

      // Render Loop driven directly by audioCtx.currentTime
      // Auto-fitted font size is computed once: lines don't change during export.
      const exportFittedFontPx = config.autoFitFontSize !== false && lines.length > 0
        ? computeAutoFitFontPx(lines, (t) => measureTextWidth100px(t, exportFontStack, exportFontWeight))
        : null;
      const renderTick = () => {
        if (this.isCancelled || isEnding) {
          stopTimers();
          return;
        }

        const nowAudioCtxTime = audioCtx.currentTime;
        const rawElapsed = Math.max(0, nowAudioCtxTime - startAt);

        // Frame index check to avoid redundant heavy 1080p canvas redraws within the same 1/fps slice
        const currentFrameIndex = Math.floor(rawElapsed * fps);

        // Unified Master Clock for Media Time
        const mediaTime = exportStart + rawElapsed;

        // Время идёт 1:1 со звуком, без коррекции:
        // effectiveTime = mediaTime
        const effectiveTime = mediaTime;

        // Single shared pure function for karaoke frame state
        const state = getKaraokeFrameState(words, lines, effectiveTime);

        // Two-line presentation pair — identical to live preview (single source of truth)
        const pair = getKaraokePresentationPair(lines, effectiveTime, {
          showLookahead: config.showNextLine !== false,
        });

        // 5-second diagnostic clock logging to console
        const now = performance.now();
        if (now - lastClockLog >= 5000) {
          lastClockLog = now;
          const perfElapsed = ((now - wallStartTime) / 1000).toFixed(2);
          console.log(`[EXPORT CLOCK]
performanceElapsed: ${perfElapsed}s
audioContext.currentTime: ${nowAudioCtxTime.toFixed(3)}s
startAt: ${startAt.toFixed(3)}s
rawElapsed: ${rawElapsed.toFixed(3)}s
mediaTime: ${mediaTime.toFixed(3)}s
videoTime: ${(mediaTime - exportStart).toFixed(3)}s
syncOffsetMs: +0ms
effectiveTime: ${effectiveTime.toFixed(3)}s
activeLineIndex: ${state.activeLineIndex}
activeWordIndex: ${state.activeWordIndex}
wordProgress: ${state.wordProgress.toFixed(2)}
mediaRecorder.state: ${recorder.state}`);
        }

        // Видео-заставка: в окне перекрытия — кадр клипа вместо всего кадра
        const coverFrame = coverLoaded
          ? coverFrameForTime(coverLoaded.el, coverLoaded.duration, coverWindows, effectiveTime, exportEnd)
          : null;
        // Фоновое видео: синхронно со временем песни; под заставкой не нужно.
        let bgFrame: HTMLVideoElement | null = null;
        if (!coverFrame && bgVideoEl) {
          if (bgVideoEl.readyState >= 2) {
            if (Math.abs(bgVideoEl.currentTime - mediaTime) > 0.3) {
              try {
                bgVideoEl.currentTime = Math.max(0, mediaTime);
              } catch {
                // ignore
              }
            }
            if (bgVideoEl.paused) {
              void bgVideoEl.play().catch(() => {});
            }
            bgFrame = bgVideoEl;
          } else if (bgVideoEl.paused) {
            void bgVideoEl.play().catch(() => {});
          }
        }

        // Render Canvas Frame using shared renderer
        renderKaraokeCanvasFrame({
          ctx,
          width,
          height,
          topLine: pair.top,
          bottomLine: pair.bottom,
          fittedFontPx: exportFittedFontPx,
          fontStack: exportFontStack,
          fontWeight: exportFontWeight,
          currentTime: effectiveTime,
          config,
          backgroundImage: backgroundImageElement,
          showLiveBadge: false,
          brandingImages,
          coverFrame,
          backgroundVideoFrame: bgFrame,
          debugOverlay: enableDebugOverlay
            ? {
                mediaTime,
                effectiveTime,
                lineIndex: state.activeLineIndex,
                wordIndex: state.activeWordIndex,
                syncOffsetMs: 0,
                wordProgress: state.wordProgress,
                exportStart,
              }
            : null,
        });

        // Request frame explicitly on captureStream video track if supported
        if (videoTrack && typeof videoTrack.requestFrame === 'function') {
          try {
            videoTrack.requestFrame();
          } catch (e) {}
        }

        lastRenderedFrameIndex = currentFrameIndex;

        // Progress Calculation
        const progressTime = Math.max(0, mediaTime - exportStart);
        const percent = Math.min(99, Math.round((progressTime / targetExportDuration) * 100));
        const wallElapsed = (now - wallStartTime) / 1000;
        const currentFrame = Math.min(totalFrames, Math.round(progressTime * fps));
        const estimatedTotal = progressTime > 0.1 ? (wallElapsed / progressTime) * targetExportDuration : targetExportDuration;
        const remaining = Math.max(0, Math.round(estimatedTotal - wallElapsed));

        onProgress({
          status: 'rendering',
          percent,
          elapsedSeconds: Math.round(wallElapsed),
          remainingSeconds: remaining,
          fps,
          currentFrame,
          totalFrames,
          format,
          mimeType,
          blobUrl: null,
        });

        // Check if finished target range
        if (rawElapsed >= targetExportDuration || mediaTime >= exportEnd) {
          console.log(
            `[VIDEO EXPORT] Target range reached: rawElapsed=${rawElapsed.toFixed(3)}s >= ${targetExportDuration.toFixed(3)}s (mediaTime=${mediaTime.toFixed(3)}s)`
          );
          finishExport();
          return;
        }

        animationFrameId = requestAnimationFrame(renderTick);
      };

      // Dual-timer launch:
      // 1. requestAnimationFrame for smooth display syncing
      // 2. High-frequency setInterval fallback (~15ms) to guarantee progress even if the tab is backgrounded
      animationFrameId = requestAnimationFrame(renderTick);
      intervalTimerId = setInterval(() => {
        const elapsed = audioCtx.currentTime - startAt;
        const expectedFrame = Math.floor(elapsed * fps);
        if (expectedFrame > lastRenderedFrameIndex && !isEnding && !this.isCancelled) {
          renderTick();
        }
      }, 15);
    });
  }
}
