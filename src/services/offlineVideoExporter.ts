import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { LineTiming, WordTiming, VideoPreviewConfig } from '../../shared/types';
import { getKaraokeFrameState, getKaraokePresentationPair } from '../../shared/syncAlgorithm';
import { getCoverWindows, coverClipTime, isCoverActive } from '../../shared/coverVideo';
import { getCoverVideoBlob } from './coverVideoStorage';
import { getBackgroundVideoBlob } from './backgroundVideoStorage';
import { openCoverClipDecoder, type CoverClipDecoder } from './coverVideoDecoder';
import { computeAutoFitFontPx, measureTextWidth100px } from '../utils/fontFit';
import { getFontById, ensureFontLoaded } from '../utils/fonts';
import { renderKaraokeCanvasFrame } from '../../shared/canvasKaraokeRenderer';
import {
  VideoExportOptions,
  VideoExportProgress,
  inspectOutputVideoDuration,
  loadBrandingImages,
} from './videoExporter';

// ---------------------------------------------------------------------------
// Pure frame-clock math (single source of truth for offline rendering).
// mediaTime is derived from the frame index — never from a wall clock.
// ---------------------------------------------------------------------------

/** Media (song) time of the given frame: exportStart + frameIndex / fps. */
export function offlineMediaTimeForFrame(exportStart: number, frameIndex: number, fps: number): number {
  return exportStart + frameIndex / fps;
}

/** Total frames for a target duration. */
export function offlineTotalFramesForDuration(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(Math.max(0, duration) * fps));
}

/** WebCodecs timestamp of a video frame in microseconds. */
export function frameTimestampMicros(frameIndex: number, fps: number): number {
  return Math.round((frameIndex * 1e6) / fps);
}

/** WebCodecs duration of one video frame in microseconds. */
export function frameDurationMicros(fps: number): number {
  return Math.round(1e6 / fps);
}

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

const VIDEO_BITRATE = 8_000_000; // 8 Mbps, same as the realtime path
const AUDIO_CODEC = 'mp4a.40.2'; // AAC-LC
const AUDIO_BITRATE = 128_000;
const KEYFRAME_EVERY_FRAMES = 60; // keyframe ~every 2s at 30fps
const AUDIO_CHUNK_FRAMES = 1024;

// Кандидаты H.264 от предпочтительного к максимально совместимому.
// High L5.0 ест не каждый (особенно аппаратный) кодер — поэтому пробуем
// по очереди вплоть до Baseline, который умеет почти всё железо.
const AVC_CODEC_CANDIDATES = [
  'avc1.640032', // High L5.0
  'avc1.64001f', // High L3.1
  'avc1.4d0028', // Main L4.0
  'avc1.4d001f', // Main L3.1
  'avc1.420028', // Baseline L4.0
  'avc1.42001f', // Baseline L3.1
];

/** Первый поддерживаемый кодером H.264-профиль или null. */
export async function selectAvcCodec(width = 1920, height = 1080, fps = 30): Promise<string | null> {
  return (await getOfflineSupportInfo(width, height, fps)).videoCodec;
}

export interface OfflineSupportInfo {
  supported: boolean;
  videoCodec: string | null;
  audioSupported: boolean;
  checkedProfiles: { codec: string; supported: boolean }[];
  /** Человекочитаемый итог проверки (для UI и консоли). */
  reason: string;
}

/** Детальная проверка быстрого пути: какие профили живы, что именно мешает. */
export async function getOfflineSupportInfo(
  width = 1920,
  height = 1080,
  fps = 30,
): Promise<OfflineSupportInfo> {
  const info: OfflineSupportInfo = {
    supported: false,
    videoCodec: null,
    audioSupported: false,
    checkedProfiles: [],
    reason: '',
  };
  try {
    if (
      typeof VideoEncoder === 'undefined' ||
      typeof VideoFrame === 'undefined' ||
      typeof AudioEncoder === 'undefined' ||
      typeof AudioData === 'undefined' ||
      typeof OfflineAudioContext === 'undefined'
    ) {
      info.reason = 'WebCodecs API недоступен в этом браузере';
      return info;
    }
    for (const codec of AVC_CODEC_CANDIDATES) {
      let ok = false;
      try {
        ok = (
          await VideoEncoder.isConfigSupported({
            codec,
            width,
            height,
            bitrate: VIDEO_BITRATE,
            framerate: fps,
          })
        ).supported;
      } catch {
        ok = false;
      }
      info.checkedProfiles.push({ codec, supported: ok });
      if (ok && !info.videoCodec) info.videoCodec = codec;
    }
    if (!info.videoCodec) {
      info.reason = 'H.264-кодирование не поддерживается (все профили отклонены кодером)';
      return info;
    }
    try {
      info.audioSupported = (
        await AudioEncoder.isConfigSupported({
          codec: AUDIO_CODEC,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitrate: AUDIO_BITRATE,
        })
      ).supported;
    } catch {
      info.audioSupported = false;
    }
    if (!info.audioSupported) {
      info.reason = 'AAC-кодирование не поддерживается';
      return info;
    }
    info.supported = true;
    info.reason = `OK (${info.videoCodec}, AAC)`;
    return info;
  } catch (e: any) {
    info.reason = `Ошибка проверки: ${e?.message || e}`;
    return info;
  }
}

/** True when the browser can do the fast offline MP4 path. */
export async function isOfflineMp4ExportSupported(
  width = 1920,
  height = 1080,
  fps = 30,
): Promise<boolean> {
  return (await getOfflineSupportInfo(width, height, fps)).supported;
}

// ---------------------------------------------------------------------------
// Offline (faster-than-realtime) exporter
// ---------------------------------------------------------------------------

export class OfflineKaraokeVideoExporter {
  private isCancelled = false;

  public cancel(): void {
    this.isCancelled = true;
  }

  /**
   * Renders the full video as fast as the machine allows (no realtime pacing).
   * Returns a blob object URL, or null when cancelled.
   */
  public async exportVideo(options: VideoExportOptions): Promise<string | null> {
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

    const fail = (msg: string): never => {
      throw new Error(msg);
    };

    onProgress({
      status: 'preparing',
      percent: 0,
      elapsedSeconds: 0,
      remainingSeconds: 0,
      fps,
      currentFrame: 0,
      totalFrames: 1,
      format: 'mp4',
      mimeType: 'video/mp4',
      blobUrl: null,
    });

    // 1. Decode audio (resampled to a fixed rate for deterministic AAC encoding)
    const arrayBuffer = await audioBlob.arrayBuffer();
    const decodeCtx = new OfflineAudioContext(2, 44100, 44100);
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    } catch {
      fail('Не удалось декодировать аудиофайл');
    }
    if (this.isCancelled) return null;

    const sampleRate = audioBuffer!.sampleRate;
    const channels = Math.min(2, Math.max(1, audioBuffer!.numberOfChannels));
    const exactDuration = audioBuffer!.duration > 0 ? audioBuffer!.duration : audioDuration > 0 ? audioDuration : 10;
    const exportStart = Math.max(0, startTime);
    const targetDuration = exportDuration && exportDuration > 0
      ? Math.min(exportDuration, exactDuration - exportStart)
      : exactDuration - exportStart;
    if (targetDuration <= 0) {
      fail('Не удалось определить длительность оригинального аудиофайла. Проверьте аудиофайл.');
    }
    const totalFrames = offlineTotalFramesForDuration(targetDuration, fps);
    const wallStartTime = performance.now();

    // 2. Render the audio range offline (seconds, not minutes)
    const renderLength = Math.ceil(targetDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(channels, renderLength, sampleRate);
    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = audioBuffer!;
    sourceNode.connect(offlineCtx.destination);
    sourceNode.start(0, exportStart, targetDuration);
    const renderedAudio = await offlineCtx.startRendering();
    if (this.isCancelled) return null;

    // 3. Canvas + shared renderer state (identical picture to preview)
    const exportFontStack = getFontById(config.fontFamily).stack;
    const exportFontWeight = [400, 500, 700, 800, 900].includes(config.fontWeight as number)
      ? (config.fontWeight as number)
      : 800;
    await ensureFontLoaded(config.fontFamily);
    if (this.isCancelled) return null;

    // Картинки фирменной шапки — из IndexedDB по id из конфига
    const brandingImages = await loadBrandingImages(config.branding);
    if (this.isCancelled) return null;

    // Видео-заставка: декодер клипа (только если включён хотя бы один показ).
    // Не завёлся — экспорт идёт дальше на обычном фоне, с предупреждением.
    const coverWanted = Boolean(config.coverVideo?.videoId)
      && (config.coverVideo?.enabledIntro === true || config.coverVideo?.enabledOutro === true);
    let coverDecoder: CoverClipDecoder | null = null;
    let coverBroken = false;
    if (coverWanted) {
      try {
        const record = await getCoverVideoBlob();
        if (record) {
          const hint = config.coverVideo?.videoDuration ?? 0;
          coverDecoder = await openCoverClipDecoder(record.blob, hint > 0 ? hint : undefined);
        } else {
          throw new Error('видеофайл заставки не найден в хранилище');
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[VIDEO] Cover clip unavailable, continuing without it:', reason);
        onCoverWarning?.(`Заставка не применилась: ${reason}`);
        coverDecoder = null;
      }
    }
    if (this.isCancelled) {
      coverDecoder?.close();
      return null;
    }
    const coverWindows = getCoverWindows(lines, {
      enabledIntro: config.coverVideo?.enabledIntro === true,
      enabledOutro: config.coverVideo?.enabledOutro === true,
    });
    const coverEndOfMedia = exportStart + targetDuration;
    const coverFps = config.coverVideo?.videoFps ?? 0;
    if (coverDecoder && coverFps > 0 && Math.abs(coverFps - fps) > 1) {
      onCoverWarning?.(
        `Частота кадров клипа (${coverFps} fps) отличается от ${fps} fps видео — возможны рывки заставки`,
      );
    }

    // Фоновое видео: второй декодер на весь экспорт. Под заставкой не декодируем.
    let bgDecoder: CoverClipDecoder | null = null;
    let bgBroken = false;
    if (config.backgroundVideo?.videoId) {
      try {
        const record = await getBackgroundVideoBlob();
        if (record) {
          const hint = config.backgroundVideo?.videoDuration ?? 0;
          bgDecoder = await openCoverClipDecoder(record.blob, hint > 0 ? hint : undefined);
        } else {
          throw new Error('файл фонового видео не найден в хранилище');
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[VIDEO] Background video unavailable, continuing without it:', reason);
        onCoverWarning?.(`Фоновое видео не применилось: ${reason}`);
        bgDecoder = null;
      }
    }
    if (this.isCancelled) {
      bgDecoder?.close();
      coverDecoder?.close();
      return null;
    }
    const bgFps = config.backgroundVideo?.videoFps ?? 0;
    if (bgDecoder && bgFps > 0 && Math.abs(bgFps - fps) > 1) {
      onCoverWarning?.(
        `Частота кадров фона (${bgFps} fps) отличается от ${fps} fps видео — возможны рывки фона`,
      );
    }
    let lastGoodBg: VideoFrame | null = null;

    /** Кадр фона для момента effectiveTime или null. */
    const resolveBgFrame = async (effectiveTime: number): Promise<VideoFrame | null> => {
      if (!bgDecoder || bgBroken || !bgDecoder.duration) return null;
      const clipT = effectiveTime % bgDecoder.duration;
      try {
        const frame = await bgDecoder.frameAt(clipT < 0 ? 0 : clipT);
        if (frame) {
          try {
            lastGoodBg?.close();
          } catch {
            // ignore
          }
          lastGoodBg = frame.clone();
          return frame;
        }
        return lastGoodBg ? lastGoodBg.clone() : null;
      } catch (e) {
        bgBroken = true;
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[VIDEO] Background decode failed, continuing without it:', reason);
        onCoverWarning?.(`Фоновое видео пропало при декодировании: ${reason}`);
        return null;
      }
    };

    /** Кадр клипа для момента effectiveTime или null. Чинит декодер один раз. */
    // Последний хороший кадр держим для бесшовности: единичные дырки насоса
    // (хвост клипа) перекрываем его клоном вместо вспышки обычного фона.
    let lastGoodCover: VideoFrame | null = null;
    const resolveCoverFrame = async (effectiveTime: number): Promise<VideoFrame | null> => {
      if (!coverDecoder || coverBroken) return null;
      if (!isCoverActive(coverWindows, effectiveTime, coverEndOfMedia)) return null;
      const winStart = coverWindows.intro && effectiveTime >= coverWindows.intro.start && effectiveTime < coverWindows.intro.end
        ? coverWindows.intro.start
        : (coverWindows.outroStart ?? 0);
      const clipT = coverClipTime(effectiveTime, winStart, coverDecoder.duration);
      try {
        const frame = await coverDecoder.frameAt(clipT);
        if (frame) {
          try {
            lastGoodCover?.close();
          } catch {
            // ignore
          }
          lastGoodCover = frame.clone();
          return frame;
        }
        return lastGoodCover ? lastGoodCover.clone() : null;
      } catch (e) {
        coverBroken = true;
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[VIDEO] Cover decode failed, continuing without it:', reason);
        onCoverWarning?.(
          `Заставка пропала при декодировании (кадр ${effectiveTime.toFixed(2)}с, клип ${clipT.toFixed(2)}с): ${reason}`,
        );
        return null;
      }
    };

    const exportFittedFontPx = config.autoFitFontSize !== false && lines.length > 0
      ? computeAutoFitFontPx(lines, (t) => measureTextWidth100px(t, exportFontStack, exportFontWeight))
      : null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      fail('Не удалось инициализировать контекст Canvas 2D');
    }

    // 4. Muxer + encoders
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height },
      audio: { codec: 'aac', sampleRate, numberOfChannels: channels },
      fastStart: 'in-memory',
    });

    const frameDurMicros = frameDurationMicros(fps);

    // Рисует кадр N на canvas (чистая функция от номера кадра — без часов).
    const renderFrameAt = async (frameIndex: number) => {
      const mediaTime = offlineMediaTimeForFrame(exportStart, frameIndex, fps);
      const effectiveTime = mediaTime; // 1:1, без коррекции
      const state = getKaraokeFrameState(words, lines, effectiveTime);
      const pair = getKaraokePresentationPair(lines, effectiveTime, {
        showLookahead: config.showNextLine !== false,
      });
      const coverFrame = await resolveCoverFrame(effectiveTime);
      const bgFrame = coverFrame ? null : await resolveBgFrame(effectiveTime);
      try {
        renderKaraokeCanvasFrame({
          ctx: ctx!,
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
      } finally {
        try {
          coverFrame?.close();
        } catch {
          // ignore
        }
        try {
          bgFrame?.close();
        } catch {
          // ignore
        }
      }
    };

    const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    let encoderError: Error | null = null;
    const onVideoChunk = (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (e: any) {
        encoderError = e instanceof Error ? e : new Error(String(e));
      }
    };
    const onEncoderError = (e: any) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    };

    // Каскад с ПРОБОЙ: кодер мало создать — он должен пережить первый кадр.
    // isConfigSupported иногда пропускает конфиг, который дохнет асинхронно
    // ("Encoder creation error" в колбэке error). Поэтому каждый конфиг
    // проверяем реальным encode кадра 0 + flush; выживший забираем в работу
    // (кадр 0 уже в мультиплексоре, цикл начнётся с 1).
    const PROBE_TIMEOUT_MS = 8000;
    const videoCodec = await selectAvcCodec(width, height, fps);
    const baseAttempt = (codec: string, hardwareAcceleration?: 'prefer-hardware' | 'prefer-software'): VideoEncoderConfig => ({
      codec,
      width,
      height,
      bitrate: VIDEO_BITRATE,
      framerate: fps,
      ...(hardwareAcceleration ? { hardwareAcceleration } : {}),
      avc: { format: 'avc' as const },
    });
    const seenConfigs = new Set<string>();
    const videoAttempts: VideoEncoderConfig[] = [];
    const pushAttempt = (codec: string | null, hw?: 'prefer-hardware' | 'prefer-software') => {
      if (!codec) return;
      const key = `${codec}|${hw || 'allow'}`;
      if (seenConfigs.has(key)) return;
      seenConfigs.add(key);
      videoAttempts.push(baseAttempt(codec, hw));
    };
    pushAttempt(videoCodec, 'prefer-hardware');
    pushAttempt(videoCodec);
    pushAttempt(videoCodec, 'prefer-software');
    pushAttempt('avc1.42E01F');
    pushAttempt('avc1.42001F');

    let videoEncoder: VideoEncoder | null = null;
    let lastVideoError: any = null;
    for (const cfg of videoAttempts) {
      encoderError = null;
      let enc: VideoEncoder | null = null;
      try {
        enc = new VideoEncoder({ output: onVideoChunk, error: onEncoderError });
        enc.configure(cfg);
      } catch (e: any) {
        lastVideoError = e;
        console.warn(`[VIDEO] VideoEncoder config rejected (${cfg.codec}):`, e?.message || e);
        continue;
      }
      // Проба: реальный кадр через кодер
      try {
        await renderFrameAt(0);
        const probeFrame = new VideoFrame(canvas, { timestamp: 0, duration: frameDurMicros });
        try {
          enc.encode(probeFrame, { keyFrame: true });
        } finally {
          probeFrame.close();
        }
        await withTimeout(enc.flush(), PROBE_TIMEOUT_MS, 'probe flush');
        if (encoderError) throw encoderError;
        videoEncoder = enc;
        console.log(`[VIDEO] VideoEncoder probe OK: ${cfg.codec}${(cfg as any).hardwareAcceleration ? ` (${(cfg as any).hardwareAcceleration})` : ''}`);
        break;
      } catch (e: any) {
        lastVideoError = e;
        encoderError = null;
        console.warn(`[VIDEO] VideoEncoder probe failed (${cfg.codec}):`, e?.message || e);
        try {
          enc.close();
        } catch { /* ignore */ }
      }
    }
    if (!videoEncoder) {
      console.error('[VIDEO] All VideoEncoder configs failed (creation or probe):', lastVideoError);
      fail(`Видеокодер не заработал ни на одном конфиге (последняя ошибка: ${lastVideoError?.message || lastVideoError})`);
    }

    let audioEncoder: AudioEncoder;
    try {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          try {
            muxer.addAudioChunk(chunk, meta);
          } catch (e: any) {
            encoderError = e instanceof Error ? e : new Error(String(e));
          }
        },
        error: (e) => {
          encoderError = e instanceof Error ? e : new Error(String(e));
        },
      });
      audioEncoder.configure({
        codec: AUDIO_CODEC,
        sampleRate,
        numberOfChannels: channels,
        bitrate: AUDIO_BITRATE,
      });
    } catch (e: any) {
      try {
        videoEncoder!.close();
      } catch { /* ignore */ }
      fail(`Не удалось создать аудиокодер (WebCodecs AAC): ${e?.message || e}`);
    }

    const throwIfEncoderFailed = () => {
      if (encoderError) {
        const err = encoderError;
        encoderError = null;
        throw err;
      }
    };

    try {
      // 5. Video: draw every frame as fast as possible (no pacing).
      // Кадр 0 уже закодирован пробой и лежит в мультиплексоре — начинаем с 1.
      const progressEveryFrames = Math.max(1, Math.floor(fps / 2));
      for (let frameIndex = 1; frameIndex < totalFrames; frameIndex += 1) {
        if (this.isCancelled) return null;
        throwIfEncoderFailed();

        await renderFrameAt(frameIndex);

        const timestamp = frameTimestampMicros(frameIndex, fps);
        const frame = new VideoFrame(canvas, { timestamp, duration: frameDurMicros });
        videoEncoder.encode(frame, { keyFrame: frameIndex % KEYFRAME_EVERY_FRAMES === 0 });
        frame.close();

        // Backpressure: don't let the encode queue grow unbounded
        while (videoEncoder.encodeQueueSize > 4) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (this.isCancelled) return null;
        }

        if (frameIndex % progressEveryFrames === 0 || frameIndex === totalFrames - 1) {
          const wallElapsed = (performance.now() - wallStartTime) / 1000;
          const done = frameIndex + 1;
          const estimatedTotal = done > 0 ? (wallElapsed / done) * totalFrames : 0;
          onProgress({
            status: 'rendering',
            percent: Math.min(99, Math.round((done / totalFrames) * 100)),
            elapsedSeconds: Math.round(wallElapsed),
            remainingSeconds: Math.max(0, Math.round(estimatedTotal - wallElapsed)),
            fps,
            currentFrame: done,
            totalFrames,
            format: 'mp4',
            mimeType: 'video/mp4',
            blobUrl: null,
          });
        }
      }

      await videoEncoder.flush();
      videoEncoder.close();
      throwIfEncoderFailed();

      // 6. Audio: slice the rendered PCM into AAC chunks
      const channelData: Float32Array[] = [];
      for (let ch = 0; ch < channels; ch += 1) {
        channelData.push(renderedAudio.getChannelData(ch));
      }
      const totalSamples = Math.min(renderLength, channelData[0].length);
      let sampleOffset = 0;
      while (sampleOffset < totalSamples) {
        if (this.isCancelled) return null;
        const blockSize = Math.min(AUDIO_CHUNK_FRAMES, totalSamples - sampleOffset);
        const planar = new Float32Array(blockSize * channels);
        for (let ch = 0; ch < channels; ch += 1) {
          planar.set(channelData[ch].subarray(sampleOffset, sampleOffset + blockSize), ch * blockSize);
        }
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: blockSize,
          numberOfChannels: channels,
          timestamp: Math.round((sampleOffset * 1e6) / sampleRate),
          data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();
        sampleOffset += blockSize;
      }

      await audioEncoder.flush();
      audioEncoder.close();
      throwIfEncoderFailed();

      // 7. Finalize MP4
      muxer.finalize();
      const { buffer } = muxer.target;
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const sizeMb = blob.size / (1024 * 1024);
      const finalUrl = URL.createObjectURL(blob);
      const outputDurationVerified = await inspectOutputVideoDuration(blob);

      onProgress({
        status: 'completed',
        percent: 100,
        elapsedSeconds: Math.round((performance.now() - wallStartTime) / 1000),
        remainingSeconds: 0,
        fps,
        currentFrame: totalFrames,
        totalFrames,
        format: 'mp4',
        mimeType: 'video/mp4',
        blobUrl: finalUrl,
        fileSizeFormatted: `${sizeMb.toFixed(2)} MB`,
        outputDurationVerified,
      });

      return finalUrl;
    } finally {
      try {
        lastGoodCover?.close();
      } catch { /* ignore */ }
      try {
        lastGoodBg?.close();
      } catch { /* ignore */ }
      try {
        coverDecoder?.close();
      } catch { /* ignore */ }
      try {
        bgDecoder?.close();
      } catch { /* ignore */ }
      try {
        if (videoEncoder.state !== 'closed') videoEncoder.close();
      } catch { /* already closed */ }
      try {
        if (audioEncoder.state !== 'closed') audioEncoder.close();
      } catch { /* already closed */ }
    }
  }
}
