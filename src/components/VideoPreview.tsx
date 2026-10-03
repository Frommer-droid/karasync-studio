import React, { useState, useRef, useEffect, useImperativeHandle } from 'react';
import { LineTiming, WordTiming, VideoPreviewConfig } from '../../shared/types';
import { renderKaraokeCanvasFrame } from '../../shared/canvasKaraokeRenderer';
import { getKaraokePresentationPair, formatTimeMs } from '../../shared/syncAlgorithm';
import { computeAutoFitFontPx, measureTextWidth100px } from '../utils/fontFit';
import { composeCenteredTitleBlock, computeBrandingLayout } from '../../shared/brandingLayout';
import { FONT_CATALOG, getFontById, ensureFontLoaded } from '../utils/fonts';
import {
  saveImage, deleteImage, resolveImageUrl,
  BRANDING_LOGO_KEY, BRANDING_AUTHOR_KEY, BRANDING_QR_KEY, BACKGROUND_IMAGE_KEY,
} from '../services/imageStorage';
import { DEFAULT_BRANDING } from '../../shared/types';
import {
  Image as ImageIcon,
  Minimize2,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  FastForward,
  Rewind,
  Gauge,
  X,
  Upload,
} from 'lucide-react';
import {
  buildPresetFile,
  downloadPreset,
  parsePresetFile,
  collectPresetImages,
  storePresetImages,
} from '../services/presets';
import { getCoverWindows, coverClipTime, isCoverActive } from '../../shared/coverVideo';
import { coverFrameForTime } from '../services/coverVideoElement';
import {
  saveCoverVideoBlob,
  getCoverVideoBlob,
  clearCoverVideoBlob,
  probeVideoDuration,
  COVER_VIDEO_KEY,
} from '../services/coverVideoStorage';
import {
  saveBackgroundVideoBlob,
  getBackgroundVideoBlob,
  clearBackgroundVideoBlob,
  BACKGROUND_VIDEO_KEY,
} from '../services/backgroundVideoStorage';

export interface VideoPreviewActions {
  openPresetSaveDialog: () => void;
  openPresetFilePicker: () => void;
  openFullscreen: () => void;
  captureSnapshot: () => void;
}

interface VideoPreviewProps {
  ref?: React.Ref<VideoPreviewActions>;
  activeLine: LineTiming | null;
  activeWord: WordTiming | null;
  nextLine: LineTiming | null;
  selectedWordId?: string | null;
  currentTime: number;
  rawMediaTime?: number;
  words?: WordTiming[];
  lines?: LineTiming[];
  config: VideoPreviewConfig;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  previewWidth: number;
  activeSettingsPanel: 'text' | 'layout' | 'position' | null;
  onChangeConfig: (newConfig: Partial<VideoPreviewConfig>) => void;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  ref,
  activeLine,
  activeWord,
  nextLine,
  selectedWordId = null,
  currentTime,
  rawMediaTime,
  words,
  lines,
  config,
  audioRef,
  previewWidth,
  activeSettingsPanel,
  onChangeConfig,
}) => {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const showSettings = activeSettingsPanel === 'text';
  const showLayoutSettings = activeSettingsPanel === 'layout';
  const showPositionSettings = activeSettingsPanel === 'position';
  const [isSnapshotting, setIsSnapshotting] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const brandingInputRef = useRef<HTMLInputElement>(null);
  const brandingUploadKindRef = useRef<'logo' | 'author' | 'qr' | null>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);
  // HTML-оверлей шапки гасим напрямую через style в том же кадре, где canvas
  // переключается на заставку, — без React-стейта, чтобы не было вспышки на кадр.
  const brandingOverlayWrapRef = useRef<HTMLDivElement | null>(null);
  const coverVideoElRef = useRef<HTMLVideoElement | null>(null);
  const coverVideoUrlRef = useRef<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const bgVideoElRef = useRef<HTMLVideoElement | null>(null);
  const bgVideoUrlRef = useRef<string | null>(null);
  const bgVideoInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageElementRef = useRef<HTMLImageElement | null>(null);

  // Фирменная шапка: конфиг + картинки сессии
  const branding = config.branding || DEFAULT_BRANDING;
  const [brandingUrls, setBrandingUrls] = useState<Record<string, string>>({});
  const [brandingTick, setBrandingTick] = useState(0);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const authorImgRef = useRef<HTMLImageElement | null>(null);
  const qrImgRef = useRef<HTMLImageElement | null>(null);
  // Пропорции QR-файла (w/h), чтобы не сжимать прямоугольник в квадрат.
  const [qrAspect, setQrAspect] = useState(1);

  const updateBranding = (patch: Partial<typeof branding>) => {
    onChangeConfig({ branding: { ...branding, ...patch } });
  };

  // Загрузка картинок шапки: IndexedDB (переживёт перезапуск) + URL сессии
  useEffect(() => {
    let cancelled = false;
    async function loadBranding() {
      const entries: [string | null | undefined, React.MutableRefObject<HTMLImageElement | null>][] = [
        [branding.logoImageId, logoImgRef],
        [branding.authorImageId, authorImgRef],
        [branding.qrImageId, qrImgRef],
      ];
      const urls: Record<string, string> = {};
      for (const [id, ref] of entries) {
        if (!id) {
          ref.current = null;
          continue;
        }
        const url = await resolveImageUrl(id);
        if (cancelled) return;
        if (url) {
          urls[id] = url;
          const img = new Image();
          img.src = url;
          img.onload = () => {
            if (!cancelled) {
              ref.current = img;
              if (id === branding.qrImageId && img.naturalWidth > 0 && img.naturalHeight > 0) {
                setQrAspect(img.naturalWidth / img.naturalHeight);
              }
              setBrandingTick((t) => t + 1);
            }
          };
          img.onerror = () => {
            if (!cancelled && ref.current?.src === url) ref.current = null;
          };
          // Если картинка уже в кэше браузера — onload может не прийти синхронно:
          // выставляем сразу, onload подтвердит.
          ref.current = img;
        } else {
          ref.current = null;
        }
      }
      if (!cancelled) {
        setBrandingUrls(urls);
        setBrandingTick((t) => t + 1);
      }
    }
    loadBranding();
    return () => {
      cancelled = true;
    };
  }, [branding.logoImageId, branding.authorImageId, branding.qrImageId]);

  const handleBrandingUpload = async (kind: 'logo' | 'author' | 'qr', file: File) => {
    const key = kind === 'logo' ? BRANDING_LOGO_KEY : kind === 'author' ? BRANDING_AUTHOR_KEY : BRANDING_QR_KEY;
    await saveImage(key, file);
    const url = await resolveImageUrl(key);
    if (url) {
      setBrandingUrls((prev) => ({ ...prev, [key]: url }));
      const img = new Image();
      img.src = url;
      img.onload = () => {
        if (kind === 'logo') logoImgRef.current = img;
        else if (kind === 'author') authorImgRef.current = img;
        else {
          qrImgRef.current = img;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setQrAspect(img.naturalWidth / img.naturalHeight);
          }
        }
        setBrandingTick((t) => t + 1);
      };
    }
    updateBranding({ [`${kind}ImageId`]: key } as Partial<typeof branding>);
  };

  const handleBrandingRemove = async (kind: 'logo' | 'author' | 'qr') => {
    const key = kind === 'logo' ? BRANDING_LOGO_KEY : kind === 'author' ? BRANDING_AUTHOR_KEY : BRANDING_QR_KEY;
    await deleteImage(key);
    setBrandingUrls((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (kind === 'logo') logoImgRef.current = null;
    else if (kind === 'author') authorImgRef.current = null;
    else {
      qrImgRef.current = null;
      setQrAspect(1);
    }
    updateBranding({ [`${kind}ImageId`]: null } as Partial<typeof branding>);
  };

  // Пресеты оформления: выгрузка всех настроек кнопок + картинки одним файлом.
  // NOTE: window.prompt не поддерживается в Electron (бросает исключение /
  // молча возвращает null без UI), поэтому имя пресета спрашиваем
  // встроенным модальным диалогом — он работает и в браузере, и в сборке.
  const [isPresetNameOpen, setIsPresetNameOpen] = useState<boolean>(false);
  const [presetNameDraft, setPresetNameDraft] = useState<string>('');
  const [isPresetSaving, setIsPresetSaving] = useState<boolean>(false);

  const defaultPresetName = (): string => {
    const cleanTitle = (branding.title || '')
      .replace(/[«»""„"''`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const date = new Date().toLocaleDateString('ru-RU');
    return cleanTitle ? `${cleanTitle} ${date}` : `Пресет ${date}`;
  };

  const openPresetNameDialog = () => {
    setPresetNameDraft(defaultPresetName());
    setIsPresetNameOpen(true);
  };

  const handleConfirmPresetSave = async () => {
    const name = presetNameDraft.trim() || defaultPresetName();
    setIsPresetSaving(true);
    try {
      const images = await collectPresetImages();
      await downloadPreset(await buildPresetFile(config, name, images));
      setIsPresetNameOpen(false);
    } catch (e) {
      window.alert(`Не удалось сохранить пресет: ${e instanceof Error ? e.message : e}`);
    } finally {
      setIsPresetSaving(false);
    }
  };

  const handleImportPresetFile = async (file: File) => {
    try {
      const parsed = parsePresetFile(JSON.parse(await file.text()));
      const ids = await storePresetImages(parsed.images);
      const branding = {
        ...(parsed.videoConfig.branding ?? { ...DEFAULT_BRANDING }),
        logoImageId: ids.logo ?? null,
        authorImageId: ids.author ?? null,
        qrImageId: ids.qr ?? null,
      };
      const backgroundImageId = ids.background ?? null;
      onChangeConfig({
        ...parsed.videoConfig,
        branding,
        backgroundImageId,
        backgroundImageUrl: backgroundImageId ? await resolveImageUrl(backgroundImageId) : null,
      });
    } catch (e) {
      window.alert(`Не удалось загрузить пресет: ${e instanceof Error ? e.message : e}`);
    }
  };

  // Effective styling values (explicit overrides win over presets; old saved projects stay valid)
  const manualFontPx = Number.isFinite(config.fontSizePx) && (config.fontSizePx as number) > 0
    ? (config.fontSizePx as number)
    : config.fontSize === 'small' ? 39 : config.fontSize === 'large' ? 63 : 50;
  const effFontPx = manualFontPx;
  const fontStack = getFontById(config.fontFamily).stack;
  const effWeight = [400, 500, 700, 800, 900].includes(config.fontWeight as number)
    ? (config.fontWeight as number)
    : 800;

  // Подгрузка веб-шрифта при смене; по готовности пересчитываем автоподбор.
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    ensureFontLoaded(config.fontFamily).then(() => {
      if (!cancelled) setFontTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [config.fontFamily]);

  // Auto-fit: longest line defines one font size for all lines (px at 1080p reference).
  const autoFitPx = React.useMemo(() => {
    if (config.autoFitFontSize === false || !lines || lines.length === 0) return null;
    return computeAutoFitFontPx(lines, (t) => measureTextWidth100px(t, fontStack, effWeight));
  }, [config.autoFitFontSize, lines, fontStack, effWeight, fontTick]);
  const renderFontPx = autoFitPx ?? effFontPx;
  const effBg = config.backgroundColor || '#231825';
  const effLyricsY = Number.isFinite(config.lyricsPositionY)
    ? Math.min(95, Math.max(5, config.lyricsPositionY as number))
    : 78;  const effLineHeight = Number.isFinite(config.lineHeight)
    ? Math.min(2.5, Math.max(0.8, config.lineHeight as number))
    : 1.15;

  // Load custom background image element for Canvas renderer when URL changes
  // (наследие старых проектов; новых загрузок фотофона больше нет).
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
    img.onerror = () => {
      bgImageElementRef.current = null;
    };
  }, [config.backgroundImageUrl]);

  // Фоновое видео: основа кадра, играет синхронно с песней (без зацикливаний —
  // файл всегда длиннее песни), на паузе замирает на текущем кадре.
  const bgVideoId = config.backgroundVideo?.videoId ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!bgVideoId) {
      bgVideoElRef.current?.pause();
      bgVideoElRef.current = null;
      if (bgVideoUrlRef.current) {
        URL.revokeObjectURL(bgVideoUrlRef.current);
        bgVideoUrlRef.current = null;
      }
      return;
    }
    getBackgroundVideoBlob().then(async (record) => {
      if (cancelled || !record) return;
      if (bgVideoUrlRef.current) URL.revokeObjectURL(bgVideoUrlRef.current);
      const url = URL.createObjectURL(record.blob);
      bgVideoUrlRef.current = url;
      const el = document.createElement('video');
      el.muted = true;
      el.preload = 'auto';
      el.loop = true;
      el.src = url;
      try {
        await new Promise<void>((resolve) => {
          el.onloadedmetadata = () => resolve();
          el.onerror = () => resolve();
        });
        try {
          el.currentTime = 0;
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
      if (cancelled) return;
      bgVideoElRef.current = el;
      const dur = Number.isFinite(el.duration) ? el.duration : 0;
      if (dur > 0 && Math.abs((config.backgroundVideo?.videoDuration ?? 0) - dur) > 0.05) {
        onChangeConfig({
          backgroundVideo: { ...(config.backgroundVideo ?? {}), videoId: bgVideoId, videoDuration: dur },
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgVideoId]);

  // Видео-заставка: грузим блоб из IndexedDB в скрытый <video> (muted, кадры отдаём в canvas).
  const coverVideoId = config.coverVideo?.videoId ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!coverVideoId) {
      coverVideoElRef.current?.pause();
      coverVideoElRef.current = null;
      if (coverVideoUrlRef.current) {
        URL.revokeObjectURL(coverVideoUrlRef.current);
        coverVideoUrlRef.current = null;
      }
      return;
    }
    getCoverVideoBlob().then(async (record) => {
      if (cancelled || !record) return;
      if (coverVideoUrlRef.current) URL.revokeObjectURL(coverVideoUrlRef.current);
      const url = URL.createObjectURL(record.blob);
      coverVideoUrlRef.current = url;
      const el = document.createElement('video');
      el.muted = true;
      (el as HTMLVideoElement & { disablePictureInPicture?: boolean }).disablePictureInPicture = true;
      el.preload = 'auto';
      el.loop = true;
      el.src = url;
      try {
        await new Promise<void>((resolve) => {
          el.onloadedmetadata = () => resolve();
          el.onerror = () => resolve();
        });
        // Сразу буферизуем первый кадр — интро часто стартует с 0:00.
        try {
          el.currentTime = 0;
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
      if (cancelled) return;
      coverVideoElRef.current = el;
      const dur = Number.isFinite(el.duration) ? el.duration : 0;
      if (dur > 0 && config.coverVideo && Math.abs((config.coverVideo.videoDuration ?? 0) - dur) > 0.05) {
        onChangeConfig({ coverVideo: { ...config.coverVideo, videoDuration: dur } });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverVideoId]);

  // Окна заставки по строкам песни (интро до первой строки, аутро после последней).
  const coverWindows = React.useMemo(
    () => getCoverWindows(lines ?? [], {
      enabledIntro: config.coverVideo?.enabledIntro === true,
      enabledOutro: config.coverVideo?.enabledOutro === true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, config.coverVideo?.enabledIntro, config.coverVideo?.enabledOutro],
  );

  // Synchronous requestAnimationFrame rendering loop (Canvas renderer, 60fps)
  useEffect(() => {
    let animId: number;

    const renderLoop = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Время идёт 1:1 со звуком, без коррекции
          const rawTime = audioRef?.current ? audioRef.current.currentTime : (rawMediaTime !== undefined ? rawMediaTime : 0);
          const time = rawTime;

          // Видео-заставка: в окне перекрытия отдаём кадр клипа (зациклен),
          // вне окон видео на паузе. Нет клипа/кадра — обычный рендер.
          const coverEl = coverVideoElRef.current;
          const coverDur = config.coverVideo?.videoDuration ?? 0;
          const mediaEnd = audioRef?.current && Number.isFinite(audioRef.current.duration)
            ? (audioRef.current as HTMLAudioElement).duration
            : Number.POSITIVE_INFINITY;
          const mediaPaused = !audioRef?.current || audioRef.current.paused;
          const coverFrame = coverEl
            ? coverFrameForTime(coverEl, coverDur, coverWindows, time, mediaEnd, 0.5, mediaPaused)
            : null;
          // Фоновое видео — основа кадра. Под заставкой не нужно, но пусть
          // играет дальше, чтобы выход был бесшовным.
          let bgFrame: HTMLVideoElement | null = null;
          const bgEl = bgVideoElRef.current;
          if (bgEl && bgEl.readyState >= 2) {
            if (mediaPaused) {
              if (!bgEl.paused) {
                try {
                  bgEl.pause();
                } catch {
                  // ignore
                }
              }
              if (Math.abs(bgEl.currentTime - time) > 0.04) {
                try {
                  bgEl.currentTime = Math.max(0, time);
                } catch {
                  // ignore
                }
              }
            } else {
              if (Math.abs(bgEl.currentTime - time) > 0.3) {
                try {
                  bgEl.currentTime = Math.max(0, time);
                } catch {
                  // ignore
                }
              }
              if (bgEl.paused) {
                void bgEl.play().catch(() => {});
              }
            }
            bgFrame = bgEl;
          }
          // HTML-оверлей шапки гасим синхронно с canvas-кадром.
          const wrap = brandingOverlayWrapRef.current;
          if (wrap) {
            const hidden = coverFrame !== null;
            if ((wrap.style.visibility === 'hidden') !== hidden) {
              wrap.style.visibility = hidden ? 'hidden' : '';
            }
          }

          // Compute frame state dynamically using shared algorithm, identical to export
          const framePair = selectedWordId
            ? {
              top: activeLine,
              bottom: config.showNextLine !== false ? nextLine : null,
            }
            : words && lines && words.length > 0
            ? getKaraokePresentationPair(lines, time, {
              showLookahead: config.showNextLine !== false,
            })
            : {
              top: activeLine,
              bottom: config.showNextLine !== false ? nextLine : null,
            };

          renderKaraokeCanvasFrame({
            ctx,
            width: canvas.width,
            height: canvas.height,
            topLine: framePair.top,
            bottomLine: framePair.bottom,
            fittedFontPx: autoFitPx,
            fontStack,
            fontWeight: effWeight,
            currentTime: time,
            highlightedWordId: selectedWordId,
            config,
            backgroundImage: bgImageElementRef.current,
            showLiveBadge: true,
            brandingImages: {
              logo: logoImgRef.current,
              author: authorImgRef.current,
              qr: qrImgRef.current,
            },
            hideBrandingTexts: true,
            coverFrame,
            backgroundVideoFrame: bgFrame,
          });
        }
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [activeLine, activeWord, nextLine, selectedWordId, rawMediaTime, words, lines, config, audioRef, autoFitPx, fontStack, effWeight, brandingTick, coverWindows]);

  // Видео-заставка: один клип на начало и конец (IndexedDB — переживёт перезапуск).
  // Сразу проверяем разбор MP4 (H.264) и частоту кадров — экспорт другого не съест.
  const handleCoverUpload = async (file: File) => {
    try {
      const record = await saveCoverVideoBlob(file, file.name);
      let dur = 0;
      let fps: number | null = null;
      try {
        const { parseCoverClip } = await import('../services/coverVideoDecoder');
        const parsed = await parseCoverClip(record.blob);
        dur = (parsed.samples[parsed.samples.length - 1]?.ctsUs ?? 0) / 1e6 + 1;
        fps = parsed.trackFps > 0 ? Math.round(parsed.trackFps * 10) / 10 : null;
      } catch (e) {
        await clearCoverVideoBlob();
        window.alert(`Видеофайл не подойдёт для заставки: ${e instanceof Error ? e.message : e}`);
        return;
      }
      if (!(dur > 0)) {
        dur = await probeVideoDuration(record.blob);
      }
      if (!(dur > 0)) {
        window.alert('Не удалось прочитать видеофайл. Нужен MP4 (H.264).');
        await clearCoverVideoBlob();
        return;
      }
      onChangeConfig({
        coverVideo: {
          enabledIntro: true,
          enabledOutro: true,
          videoId: COVER_VIDEO_KEY,
          videoName: record.name,
          videoDuration: dur,
          videoFps: fps,
        },
      });
    } catch (e) {
      window.alert(`Не удалось загрузить видео: ${e instanceof Error ? e.message : e}`);
    }
  };

  const handleCoverRemove = async () => {
    try {
      await clearCoverVideoBlob();
    } catch {
      // ignore
    }
    onChangeConfig({
      coverVideo: { enabledIntro: false, enabledOutro: false, videoId: null, videoName: null, videoDuration: null, videoFps: null },
    });
  };

  // Фоновое видео: основа кадра. Проверяем разбором (H.264), как заставку.
  const handleBackgroundVideoUpload = async (file: File) => {
    try {
      const record = await saveBackgroundVideoBlob(file, file.name);
      let dur = 0;
      let fps: number | null = null;
      try {
        const { parseCoverClip } = await import('../services/coverVideoDecoder');
        const parsed = await parseCoverClip(record.blob);
        const last = parsed.samples[parsed.samples.length - 1];
        dur = (last?.ctsUs ?? 0) / 1e6 + 1;
        fps = parsed.trackFps > 0 ? Math.round(parsed.trackFps * 10) / 10 : null;
      } catch (e) {
        await clearBackgroundVideoBlob();
        window.alert(`Видеофайл не подойдёт для фона: ${e instanceof Error ? e.message : e}`);
        return;
      }
      if (!(dur > 0)) {
        dur = await probeVideoDuration(record.blob);
      }
      if (!(dur > 0)) {
        window.alert('Не удалось прочитать видеофайл. Нужен MP4 (H.264).');
        await clearBackgroundVideoBlob();
        return;
      }
      onChangeConfig({
        backgroundVideo: {
          videoId: BACKGROUND_VIDEO_KEY,
          videoName: record.name,
          videoDuration: dur,
          videoFps: fps,
        },
      });
    } catch (e) {
      window.alert(`Не удалось загрузить видео: ${e instanceof Error ? e.message : e}`);
    }
  };

  const handleBackgroundVideoRemove = async () => {
    try {
      await clearBackgroundVideoBlob();
    } catch {
      // ignore
    }
    onChangeConfig({ backgroundVideo: null });
  };

  // Сброс оформления: тексты и картинки шапки, фон и оба видео — в пустое состояние.
  // Шрифты/позиции строк песни не трогаем. Спрашиваем подтверждение.
  const handleResetDesign = async () => {
    if (!window.confirm('Сбросить оформление? Тексты шапки, картинки, фон и видео будут убраны.')) {
      return;
    }
    try {
      await Promise.all([
        deleteImage(BRANDING_LOGO_KEY),
        deleteImage(BRANDING_AUTHOR_KEY),
        deleteImage(BRANDING_QR_KEY),
        deleteImage(BACKGROUND_IMAGE_KEY),
        clearCoverVideoBlob(),
        clearBackgroundVideoBlob(),
      ]);
    } catch {
      // ignore — дальше всё равно сбрасываем конфиг
    }
    onChangeConfig({
      branding: { ...DEFAULT_BRANDING },
      backgroundImageUrl: null,
      backgroundImageId: null,
      backgroundVideo: null,
      coverVideo: { enabledIntro: false, enabledOutro: false, videoId: null, videoName: null, videoDuration: null, videoFps: null },
    });
  };

  const updateCoverVideo = (patch: Partial<NonNullable<typeof config.coverVideo>>) => {
    onChangeConfig({
      coverVideo: {
        enabledIntro: false,
        enabledOutro: false,
        videoId: null,
        ...(config.coverVideo ?? {}),
        ...patch,
      },
    });
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch((err) => {
        console.warn('Fullscreen error:', err);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch((err) => {
        console.warn('Exit fullscreen error:', err);
      });
      setIsFullscreen(false);
    }
  };

  // Выход по Esc делает сам браузер — синхронизируем состояние,
  // иначе ширина превью останется 100% вместо сохранённой.
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  // Автопрятание панели в полноэкранном режиме: движение мыши — показать,
  // 3 секунды покоя — скрыть вместе с курсором.
  const [fsControlsVisible, setFsControlsVisible] = useState(true);
  const fsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokeFsControls = () => {
    if (!isFullscreen) return;
    setFsControlsVisible(true);
    if (fsHideTimer.current !== null) clearTimeout(fsHideTimer.current);
    fsHideTimer.current = setTimeout(() => setFsControlsVisible(false), 3000);
  };
  useEffect(() => {
    if (isFullscreen) {
      pokeFsControls();
    } else {
      if (fsHideTimer.current !== null) clearTimeout(fsHideTimer.current);
      fsHideTimer.current = null;
      setFsControlsVisible(true);
    }
    return () => {
      if (fsHideTimer.current !== null) clearTimeout(fsHideTimer.current);
      fsHideTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen]);

  // Транспорт для полноэкранного режима (в обычном виде кнопки внизу страницы).
  const [fsPlaying, setFsPlaying] = useState(false);
  const [fsTime, setFsTime] = useState(0);
  const [fsDuration, setFsDuration] = useState(0);
  const [fsRate, setFsRate] = useState(1);
  const [fsVolume, setFsVolume] = useState(1);
  const [fsMuted, setFsMuted] = useState(false);
  useEffect(() => {
    if (!isFullscreen) return;
    const audio = audioRef?.current;
    if (!audio) return;
    const syncAudioState = () => {
      setFsPlaying(!audio.paused);
      if (Number.isFinite(audio.currentTime)) setFsTime(audio.currentTime);
      if (Number.isFinite(audio.duration) && audio.duration > 0) setFsDuration(audio.duration);
      if (Number.isFinite(audio.playbackRate) && audio.playbackRate > 0) setFsRate(audio.playbackRate);
      setFsVolume(audio.volume);
      setFsMuted(audio.muted);
    };
    syncAudioState();
    audio.addEventListener('play', syncAudioState);
    audio.addEventListener('pause', syncAudioState);
    audio.addEventListener('timeupdate', syncAudioState);
    audio.addEventListener('loadedmetadata', syncAudioState);
    audio.addEventListener('ratechange', syncAudioState);
    audio.addEventListener('volumechange', syncAudioState);
    return () => {
      audio.removeEventListener('play', syncAudioState);
      audio.removeEventListener('pause', syncAudioState);
      audio.removeEventListener('timeupdate', syncAudioState);
      audio.removeEventListener('loadedmetadata', syncAudioState);
      audio.removeEventListener('ratechange', syncAudioState);
      audio.removeEventListener('volumechange', syncAudioState);
    };
  }, [isFullscreen, audioRef]);

  const toggleFsPlay = () => {
    const audio = audioRef?.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  };

  const seekFs = (t: number) => {
    const audio = audioRef?.current;
    if (!audio) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fsDuration;
    audio.currentTime = Math.min(Math.max(0, t), dur || 0);
  };

  const changeFsRate = (rate: number) => {
    const audio = audioRef?.current;
    if (!audio) return;
    audio.playbackRate = rate;
    setFsRate(rate);
  };

  const toggleFsMute = () => {
    const audio = audioRef?.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setFsMuted(audio.muted);
  };

  const setFsVolumeLevel = (v: number) => {
    const audio = audioRef?.current;
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, v));
    if (v > 0 && audio.muted) audio.muted = false;
    setFsVolume(audio.volume);
    setFsMuted(audio.muted);
  };

  // Capture instant Full HD Snapshot frame from the canvas renderer
  const handleCaptureSnapshot = () => {
    if (isSnapshotting) return;
    setIsSnapshotting(true);
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = 1920;
      offscreen.height = 1080;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        const rawTime = audioRef?.current ? audioRef.current.currentTime : currentTime;
        const time = rawTime;
        const snapshotPair = words && lines && words.length > 0
          ? getKaraokePresentationPair(lines, time, {
            showLookahead: config.showNextLine !== false,
          })
          : {
            top: activeLine,
            bottom: config.showNextLine !== false ? nextLine : null,
          };
        // Заставка в снимке: только если элемент уже стоит на нужном месте.
        let snapshotCover: HTMLVideoElement | null = null;
        {
          const el = coverVideoElRef.current;
          const dur = config.coverVideo?.videoDuration ?? 0;
          const mediaEnd = audioRef?.current && Number.isFinite(audioRef.current.duration)
            ? (audioRef.current as HTMLAudioElement).duration
            : Number.POSITIVE_INFINITY;
          if (el && dur > 0 && el.readyState >= 2 && isCoverActive(coverWindows, time, mediaEnd)) {
            const winStart = coverWindows.intro && time >= coverWindows.intro.start && time < coverWindows.intro.end
              ? coverWindows.intro.start
              : (coverWindows.outroStart ?? 0);
            if (Math.abs(el.currentTime - coverClipTime(time, winStart, dur)) <= 0.5) {
              snapshotCover = el;
            }
          }
        }
        const snapshotBg = bgVideoElRef.current && bgVideoElRef.current.readyState >= 2
          ? bgVideoElRef.current
          : null;
        renderKaraokeCanvasFrame({
          ctx: offCtx,
          width: 1920,
          height: 1080,
          topLine: snapshotPair.top,
          bottomLine: snapshotPair.bottom,
          fittedFontPx: autoFitPx,
          fontStack,
          fontWeight: effWeight,
          currentTime: time,
          config,
          backgroundImage: bgImageElementRef.current,
          showLiveBadge: true,
          brandingImages: {
            logo: logoImgRef.current,
            author: authorImgRef.current,
            qr: qrImgRef.current,
          },
          coverFrame: snapshotCover,
          backgroundVideoFrame: snapshotBg,
        });

        const link = document.createElement('a');
        link.download = `karaoke_frame_${time.toFixed(2)}s.png`;
        link.href = offscreen.toDataURL('image/png');
        link.click();
      }
    } catch (e) {
      console.warn('Snapshot capture failed:', e);
    } finally {
      setTimeout(() => setIsSnapshotting(false), 300);
    }
  };

  useImperativeHandle(ref, () => ({
    openPresetSaveDialog: openPresetNameDialog,
    openPresetFilePicker: () => presetInputRef.current?.click(),
    openFullscreen: toggleFullscreen,
    captureSnapshot: handleCaptureSnapshot,
  }));

  return (
    <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl p-5 shadow-xl flex flex-col">
      <input
        ref={presetInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Файл пресета оформления"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImportPresetFile(file);
          event.target.value = '';
        }}
      />
      {/* Keep the image picker mounted so clicking branding in the preview still works. */}
      <input
        ref={brandingInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const kind = brandingUploadKindRef.current;
          if (file && kind) handleBrandingUpload(kind, file);
          e.target.value = '';
        }}
      />

      {/* Settings Drawer if open */}
      {activeSettingsPanel && (
        <div className="mb-4 p-4 rounded-xl bg-neutral-950/90 border border-neutral-800 text-xs space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {showSettings && (
              <>
            {/* Группа: Шрифт */}
            <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 p-4 space-y-4">
              <div className="text-xs font-bold uppercase tracking-widest text-neutral-500">Шрифт</div>

              {/* Font Family */}
              <div className="flex flex-col gap-1.5">
                <span className="text-neutral-400 font-semibold">Шрифт:</span>
                <select
                  value={getFontById(config.fontFamily).id}
                  onChange={(e) => onChangeConfig({ fontFamily: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1.5 text-sm text-neutral-200 cursor-pointer focus:outline-none focus:border-cyan-500"
                >
                  {FONT_CATALOG.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Font Weight */}
              <div className="flex flex-col gap-1.5">
                <span className="text-neutral-400 font-semibold">Жирность:</span>
                <select
                  value={effWeight}
                  onChange={(e) => onChangeConfig({ fontWeight: parseInt(e.target.value) })}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1.5 text-sm text-neutral-200 cursor-pointer focus:outline-none focus:border-cyan-500"
                >
                  {[
                    { id: 400, label: 'Обычный' },
                    { id: 500, label: 'Средний' },
                    { id: 700, label: 'Полужирный' },
                    { id: 800, label: 'Жирный' },
                    { id: 900, label: 'Очень жирный' },
                  ].map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Font Size */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-300">
                  <input
                    type="checkbox"
                    checked={config.autoFitFontSize !== false}
                    onChange={(e) => onChangeConfig({ autoFitFontSize: e.target.checked })}
                    className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
                  />
                  <span>Автоподбор под длинную строку</span>
                </label>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400 font-semibold">Точный размер:</span>
                  <span className="font-mono text-cyan-400">
                    {renderFontPx}px{autoFitPx !== null ? ' (авто)' : ''}
                  </span>
                </div>
                <input
                  type="range"
                  min={16}
                  max={80}
                  value={effFontPx}
                  disabled={autoFitPx !== null}
                  onChange={(e) => onChangeConfig({ fontSizePx: parseInt(e.target.value) })}
                  className="accent-cyan-400 cursor-pointer disabled:opacity-40"
                />
              </div>
            </div>

            {/* Группа: Строки */}
            <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 p-4 space-y-4">
              <div className="text-xs font-bold uppercase tracking-widest text-neutral-500">Строки</div>

              {/* Text Position */}
              <div className="flex flex-col gap-1.5">
                <span className="text-neutral-400 font-semibold">Положение текста:</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'lower_third', label: 'Нижняя 1/3', y: 78 },
                    { id: 'bottom', label: 'Внизу', y: 90 },
                    { id: 'middle', label: 'По центру', y: 50 },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onChangeConfig({ textPosition: p.id as any, lyricsPositionY: p.y })}
                      className={`py-1 px-2 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                        (config.textPosition || 'lower_third') === p.id
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-neutral-400 font-semibold">Высота строк (верх–низ):</span>
                  <span className="font-mono text-cyan-400">{effLyricsY}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={95}
                  value={effLyricsY}
                  onChange={(e) => onChangeConfig({ lyricsPositionY: parseInt(e.target.value) })}
                  className="accent-cyan-400 cursor-pointer"
                />
              </div>

              {/* Line Height */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400 font-semibold">Межстрочный интервал:</span>
                  <span className="font-mono text-cyan-400">{effLineHeight.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.05}
                  value={effLineHeight}
                  onChange={(e) => onChangeConfig({ lineHeight: parseFloat(e.target.value) })}
                  className="accent-cyan-400 cursor-pointer"
                />
              </div>

              {/* Show/Hide Next Line */}
              <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-300 pt-1 border-t border-neutral-800">
                <input
                  type="checkbox"
                  checked={config.showNextLine !== false}
                  onChange={(e) => onChangeConfig({ showNextLine: e.target.checked })}
                  className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
                />
              <span>Показывать следующую строку</span>
            </label>
            </div>
              </>
            )}
            {showLayoutSettings && (
              <>
            {/* Группа: Титульная шапка */}
            <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 p-4 space-y-3 md:col-span-2">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="min-w-[13rem] flex-1">
                  <div className="text-xs font-bold uppercase tracking-widest text-neutral-500">Титульная шапка</div>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Тексты шапки правятся прямо в предпросмотре — кликни по тексту.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-neutral-300">
                    <input
                      type="checkbox"
                      checked={branding.enabled}
                      onChange={(e) => updateBranding({ enabled: e.target.checked })}
                      className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
                    />
                    <span>Шапка</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-neutral-300">
                    <input
                      type="checkbox"
                      checked={branding.blockCentered === true}
                      onChange={(e) => updateBranding({ blockCentered: e.target.checked })}
                      className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
                    />
                    <span>Блок по центру экрана</span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void handleResetDesign()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-red-900/40 text-[11px] text-neutral-400 hover:text-red-300 border border-neutral-700 transition-colors cursor-pointer"
                  title="Убрать тексты шапки, картинки, фон и видео (вернуться к пустому оформлению)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Сбросить оформление</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {([
                  { kind: 'logo', label: 'Логотип', id: branding.logoImageId, field: 'showLogo' as const },
                  { kind: 'author', label: 'Фото автора', id: branding.authorImageId, field: 'showTitle' as const },
                  { kind: 'qr', label: 'QR-код', id: branding.qrImageId, field: 'showQR' as const },
                ] as const).map((row) => (
                  <div key={row.kind} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-neutral-900 border border-neutral-800 px-2.5 py-1.5">
                    <label className="flex min-w-0 items-center gap-2 cursor-pointer text-xs text-neutral-300 font-medium">
                      <input
                        type="checkbox"
                        checked={branding[row.field] === true}
                        onChange={(e) => updateBranding({ [row.field]: e.target.checked } as Partial<typeof branding>)}
                        className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
                      />
                      <span>
                        {row.label}{' '}
                        {row.id && <span className="text-emerald-400">✓</span>}
                      </span>
                    </label>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          brandingUploadKindRef.current = row.kind;
                          brandingInputRef.current?.click();
                        }}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-200 border border-neutral-700 transition-colors cursor-pointer"
                      >
                        <Upload className="w-3 h-3 text-cyan-400" aria-hidden="true" />
                        Загрузить
                      </button>
                      {row.id && (
                        <button
                          type="button"
                          onClick={() => handleBrandingRemove(row.kind)}
                          className="icon-control icon-control--tiny px-2 py-1 rounded-lg bg-neutral-800 hover:bg-red-900/40 text-neutral-400 hover:text-red-300 border border-neutral-700 transition-colors cursor-pointer"
                          title="Удалить"
                          aria-label={`Удалить: ${row.label}`}
                        >
                          <X className="w-3 h-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

            </div>
            {/* Видеослои: фон кадра и заставка на границах песни. */}
            <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 p-4 md:col-span-2">
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-6 gap-y-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-neutral-500">Фон</span>
                  <ClipFileRow
                    inputRef={bgVideoInputRef}
                    buttonId="btn-upload-bg-video"
                    fileName={config.backgroundVideo?.videoName ?? 'Фоновое видео'}
                    hasFile={Boolean(config.backgroundVideo?.videoId)}
                    uploadTitle="Загрузить фоновое видео (основа кадра, MP4)"
                    removeTitle="Удалить фоновое видео"
                    onPickFile={(file) => void handleBackgroundVideoUpload(file)}
                    onRemove={() => void handleBackgroundVideoRemove()}
                  />
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-neutral-500">Заставка</span>
                  <ClipFileRow
                    inputRef={coverInputRef}
                    buttonId="btn-upload-cover-video"
                    fileName={config.coverVideo?.videoName ?? 'Видеофайл'}
                    hasFile={Boolean(config.coverVideo?.videoId)}
                    uploadTitle="Загрузить видеофайл заставки (MP4, зацикливается)"
                    removeTitle="Удалить видео-заставку"
                    onPickFile={(file) => void handleCoverUpload(file)}
                    onRemove={() => void handleCoverRemove()}
                  />
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-neutral-300">
                      <input
                        type="checkbox"
                        checked={config.coverVideo?.enabledIntro === true}
                        onChange={(e) => updateCoverVideo({ enabledIntro: e.target.checked })}
                        className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
                      />
                      <span>В начале</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-neutral-300">
                      <input
                        type="checkbox"
                        checked={config.coverVideo?.enabledOutro === true}
                        onChange={(e) => updateCoverVideo({ enabledOutro: e.target.checked })}
                        className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
                      />
                      <span>В конце</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
              </>
            )}
            {showPositionSettings && (
              <>
            {/* Группа: Позиции элементов шапки */}
            <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 p-4 space-y-4 md:col-span-2">
              <div className="text-xs font-bold uppercase tracking-widest text-neutral-500">Позиции</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                {([
                  { key: 'logo', label: 'Логотип' },
                  { key: 'author', label: 'Фото автора' },
                  { key: 'qr', label: 'QR-код' },
                  { key: 'title', label: 'Текст' },
                  { key: 'songTitle', label: 'Название песни' },
                ] as const).map((group) => {
                  const pos = branding.placement?.[group.key] ?? { scale: 100, dx: 0, dy: 0 };
                  const setPos = (patch: Partial<typeof pos>) => updateBranding({
                    placement: {
                      logo: { ...(branding.placement?.logo ?? { scale: 100, dx: 0, dy: 0 }) },
                      author: { ...(branding.placement?.author ?? { scale: 100, dx: 0, dy: 0 }) },
                      qr: { ...(branding.placement?.qr ?? { scale: 100, dx: 0, dy: 0 }) },
                      title: { ...(branding.placement?.title ?? { scale: 100, dx: 0, dy: 0 }) },
                      songTitle: { ...(branding.placement?.songTitle ?? { scale: 100, dx: 0, dy: 0 }) },
                      [group.key]: { ...pos, ...patch },
                    },
                  });
                  return (
                    <div key={group.key} className="rounded-lg bg-neutral-900 border border-neutral-800 p-3 space-y-3">
                      <div className="text-xs font-bold text-neutral-300">{group.label}</div>
                      <div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-neutral-400 font-semibold">Размер контейнера:</span>
                          <span className="font-mono text-cyan-400">{Math.round(pos.scale)}%</span>
                        </div>
                        <input
                          type="range" min={50} max={200} step={5} value={pos.scale}
                          onChange={(e) => setPos({ scale: parseInt(e.target.value) })}
                          className="w-full accent-cyan-400 cursor-pointer"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-neutral-400 font-semibold">По горизонтали:</span>
                          <span className="font-mono text-cyan-400">{pos.dx > 0 ? `+${pos.dx}` : pos.dx}%</span>
                        </div>
                        <input
                          type="range" min={-20} max={20} step={1} value={pos.dx}
                          onChange={(e) => setPos({ dx: parseInt(e.target.value) })}
                          className="w-full accent-cyan-400 cursor-pointer"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-neutral-400 font-semibold">По вертикали:</span>
                          <span className="font-mono text-cyan-400">{pos.dy > 0 ? `+${pos.dy}` : pos.dy}%</span>
                        </div>
                        <input
                          type="range" min={-20} max={20} step={1} value={pos.dy}
                          onChange={(e) => setPos({ dy: parseInt(e.target.value) })}
                          className="w-full accent-cyan-400 cursor-pointer"
                        />
                      </div>
                      {group.key === 'title' && (
                        <div>
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-neutral-400 font-semibold">Межстрочный интервал:</span>
                            <span className="font-mono text-cyan-400">{Math.round(branding.lineSpacing ?? 100)}%</span>
                          </div>
                          <input
                            type="range" min={50} max={200} step={5} value={branding.lineSpacing ?? 100}
                            onChange={(e) => updateBranding({ lineSpacing: parseInt(e.target.value) })}
                            className="w-full accent-cyan-400 cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 16:9 Video Frame (Aspect 16:9, Canvas renderer — same engine as export) */}
      <div className="w-full flex justify-center">
        <div
          ref={containerRef}
          id="karaoke-video-screen"
          className="relative rounded-2xl overflow-hidden shadow-2xl border border-neutral-800 flex flex-col"
          style={{
            aspectRatio: '16 / 9',
            backgroundColor: effBg,
            width: isFullscreen ? '100%' : `${previewWidth}%`,
            containerType: 'inline-size',
            cursor: isFullscreen && !fsControlsVisible ? 'none' : '',
          }}
          onMouseMove={pokeFsControls}
        >
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="w-full h-full object-contain"
          />
          {branding.enabled && (
            <div ref={brandingOverlayWrapRef} className="absolute inset-0 pointer-events-none">
            <BrandingOverlay
              branding={branding}
              urls={brandingUrls}
              fontStack={fontStack}
              qrAspect={qrAspect}
              onPatch={updateBranding}
              onPickImage={(kind) => {
                brandingUploadKindRef.current = kind;
                brandingInputRef.current?.click();
              }}
            />
            </div>
          )}
          {isFullscreen && (
            <div
              className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-[2%] pt-[3.5%] pb-[1.2%] transition-opacity duration-300 ${
                fsControlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`}
              style={{ fontSize: 'clamp(10px, 1.05cqw, 22px)' }}
            >
              {/* Прогресс */}
              <input
                type="range"
                min={0}
                max={Math.max(0, fsDuration)}
                step={0.01}
                value={Math.min(fsTime, Math.max(0, fsDuration))}
                onChange={(e) => seekFs(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer"
                title="Перемотка"
              />
              <div className="flex items-center justify-between font-mono mt-[0.3em]">
                <span className="text-cyan-400 font-bold" style={{ fontSize: '1em' }}>{formatTimeMs(fsTime)}</span>
                <span className="text-white/60" style={{ fontSize: '1em' }}>{formatTimeMs(fsDuration)}</span>
              </div>
              {/* Кнопки — как нижний плеер */}
              <div className="flex flex-wrap items-center justify-between gap-[1em] mt-[0.4em]">
                <div className="flex items-center gap-[0.6em]">
                  <div className="flex items-center gap-[0.4em] bg-black/50 px-[0.7em] py-[0.35em] rounded-xl border border-white/10">
                    <Gauge className="w-[1.1em] h-[1.1em] text-neutral-400" />
                    <select
                      value={fsRate}
                      onChange={(e) => changeFsRate(parseFloat(e.target.value))}
                      className="bg-transparent font-mono text-cyan-400 focus:outline-none cursor-pointer pr-[0.3em]"
                      style={{ fontSize: '0.95em' }}
                    >
                      {[0.5, 0.75, 1.0, 1.25, 1.5].map((rate) => (
                        <option key={rate} value={rate} className="bg-neutral-900 text-neutral-200">
                          {rate}x
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-[0.8em]">
                  <button
                    type="button"
                    onClick={() => seekFs(0)}
                    className="p-[0.65em] rounded-full bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                    title="В начало трека"
                  >
                    <RotateCcw className="w-[1.1em] h-[1.1em]" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleFsPlay}
                    className="w-[3em] h-[3em] rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-cyan-500/25 ring-2 ring-white/20 active:scale-95 transition-all cursor-pointer"
                    title={fsPlaying ? 'Пауза (Space)' : 'Воспроизведение (Space)'}
                  >
                    {fsPlaying ? (
                      <Pause className="w-[1.3em] h-[1.3em] fill-current" />
                    ) : (
                      <Play className="w-[1.3em] h-[1.3em] fill-current ml-[0.15em]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => seekFs(fsTime - 5)}
                    className="p-[0.55em] rounded-xl bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                    title="Назад на 5 секунд"
                  >
                    <Rewind className="w-[1.1em] h-[1.1em]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => seekFs(fsTime + 5)}
                    className="p-[0.55em] rounded-xl bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                    title="Вперёд на 5 секунд"
                  >
                    <FastForward className="w-[1.1em] h-[1.1em]" />
                  </button>
                </div>

                <div className="flex items-center gap-[0.6em]">
                  <button
                    type="button"
                    onClick={toggleFsMute}
                    className="p-[0.55em] rounded-xl bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                    title={fsMuted ? 'Включить звук' : 'Выключить звук'}
                  >
                    {fsMuted || fsVolume === 0 ? (
                      <VolumeX className="w-[1.1em] h-[1.1em] text-red-400" />
                    ) : (
                      <Volume2 className="w-[1.1em] h-[1.1em] text-cyan-400" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={fsMuted ? 0 : fsVolume}
                    onChange={(e) => setFsVolumeLevel(parseFloat(e.target.value))}
                    className="w-[6em] accent-cyan-400 cursor-pointer"
                    title={`Громкость: ${Math.round((fsMuted ? 0 : fsVolume) * 100)}%`}
                  />
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="p-[0.55em] rounded-xl bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                    title="Выйти из полноэкранного режима (Esc)"
                  >
                    <Minimize2 className="w-[1.1em] h-[1.1em]" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Диалог имени пресета: замена window.prompt (не работает в Electron) */}
      {isPresetNameOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {
            if (!isPresetSaving) setIsPresetNameOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isPresetSaving) setIsPresetNameOpen(false);
              if (e.key === 'Enter') void handleConfirmPresetSave();
            }}
          >
            <h4 className="text-sm font-bold text-white">Название пресета</h4>
            <input
              autoFocus
              type="text"
              value={presetNameDraft}
              onChange={(e) => setPresetNameDraft(e.target.value)}
              placeholder="Например: Мой стиль"
              maxLength={80}
              disabled={isPresetSaving}
              className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm text-neutral-100 placeholder-neutral-500 outline-none disabled:opacity-50"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isPresetSaving}
                onClick={() => setIsPresetNameOpen(false)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold border border-neutral-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isPresetSaving}
                onClick={() => void handleConfirmPresetSave()}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {isPresetSaving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Общая строка выбора видеофайла: кнопка с именем + корзина. Одна на все блоки. */
function ClipFileRow({
  inputRef,
  buttonId,
  fileName,
  hasFile,
  uploadTitle,
  removeTitle,
  onPickFile,
  onRemove,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  buttonId: string;
  fileName: string;
  hasFile: boolean;
  uploadTitle: string;
  removeTitle: string;
  onPickFile: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPickFile(file);
          e.target.value = '';
        }}
      />
      <button
        id={buttonId}
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 hover:text-white border border-neutral-700 transition-colors cursor-pointer"
        title={hasFile ? `${uploadTitle}: ${fileName}` : uploadTitle}
      >
        <ImageIcon className="w-3.5 h-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
        <span className="min-w-0 truncate">{fileName}</span>
      </button>
      {hasFile && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 p-1.5 rounded-xl bg-neutral-800 hover:bg-red-900/40 text-neutral-400 hover:text-red-300 border border-neutral-700 transition-colors cursor-pointer"
          title={removeTitle}
          aria-label={removeTitle}
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Прозрачный HTML-слой поверх canvas: картинки + тексты правятся прямо в превью. */
function BrandingOverlay({
  branding,
  urls,
  fontStack,
  qrAspect,
  onPatch,
  onPickImage,
}: {
  branding: typeof DEFAULT_BRANDING;
  urls: Record<string, string>;
  fontStack: string;
  qrAspect: number;
  onPatch: (patch: Partial<typeof DEFAULT_BRANDING>) => void;
  onPickImage: (kind: 'logo' | 'author' | 'qr') => void;
}) {
  // Невидимые управляющие символы (RLO и т.п. из вставок) — вычищаем, они зеркалят текст.
  const cleanText = (s: string) => s.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
  const field = (
    fieldName: 'title' | 'line1' | 'line2' | 'line3',
    value: string,
    placeholder: string,
    style: React.CSSProperties,
  ) => (
    <input
      type="text"
      value={value}
      dir="ltr"
      spellCheck={false}
      autoComplete="off"
      placeholder={placeholder}
      onChange={(e) => onPatch({ [fieldName]: cleanText(e.target.value) } as Partial<typeof DEFAULT_BRANDING>)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLElement).blur();
        e.stopPropagation();
      }}
      className="branding-field"
      style={{ ...style, background: 'transparent', border: 'none', width: '100%', padding: 0 }}
    />
  );
  const place = (key: 'logo' | 'author' | 'qr' | 'title' | 'songTitle') =>
    branding.placement?.[key] ?? { scale: 100, dx: 0, dy: 0 };
  const logoPlace = place('logo');
  const authorPlace = place('author');
  const qrPlace = place('qr');
  const titlePlace = place('title');
  const songPlace = place('songTitle');

  // Канавас-сетка текстов (в % высоты контейнера): те же базлайны и кегли,
  // что рисует экспортный canvas. По ней оверлей ставит поля 1:1 с кадром.
  const lineSpacingPct = Number.isFinite(branding.lineSpacing) ? Math.min(200, Math.max(50, branding.lineSpacing as number)) : 100;
  const textOverlay = React.useMemo(() => {
    const s = titlePlace.scale / 100;
    const songS = songPlace.scale / 100;
    const titleBaseline = 17.5 + songPlace.dy;
    const line1Baseline = 25 + titlePlace.dy;
    const stepY = 7.3 * s * (lineSpacingPct / 100);
    const titleFontPct = (62 / 1080) * 100 * songS;
    const lineFontPct = (47 / 1080) * 100 * s;
    const baselineTop = (baseline: number, fontPct: number) => baseline - 0.78 * fontPct;
    return {
      titleTopPct: baselineTop(titleBaseline, titleFontPct),
      lineTopPct: (i: number) => baselineTop(line1Baseline + i * stepY, lineFontPct),
    };
  }, [songPlace.scale, songPlace.dy, titlePlace.scale, titlePlace.dy, lineSpacingPct]);

  // Чекбокс «блок по центру»: та же функция, что в canvas,
  // единицы — проценты контейнера (W=100). null, если галка выключена.
  const centeredComp = React.useMemo(() => {
    if (!branding.blockCentered) return null;
    const L = computeBrandingLayout(100, 56.25, branding.placement, branding.lineSpacing);
    return composeCenteredTitleBlock(
      L,
      100,
      { text: branding.title || '', fontPx: L.title.fontPx },
      [branding.line1, branding.line2, branding.line3].map((sub) => ({
        text: sub || '',
        fontPx: L.sublines.fontPx,
      })),
      (t, px, w) => (measureTextWidth100px(t, fontStack, w) / 100) * px,
    );
  }, [branding.blockCentered, branding.title, branding.line1, branding.line2, branding.line3, branding.placement, branding.lineSpacing, fontStack]);

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ fontFamily: fontStack }}>
      <style>{`.branding-field{pointer-events:auto;outline:none;border-radius:0.4cqw;cursor:text}.branding-field::placeholder{opacity:0.35}.branding-field:hover{background:rgba(255,255,255,0.07)}.branding-field:focus{background:rgba(6,182,212,0.15);box-shadow:0 0 0 1px rgba(6,182,212,0.6)}`}</style>

      {branding.showLogo && (
        <div
          className="absolute"
          style={{
            left: `calc(9.5% + ${logoPlace.dx}%)`,
            top: `calc(16% + ${logoPlace.dy}%)`,
            width: `${15 * logoPlace.scale / 100}%`,
            aspectRatio: '1',
            transform: 'translate(-50%,-50%)',
          }}
        >
          {urls[BRANDING_LOGO_KEY] ? (
            <img
              src={urls[BRANDING_LOGO_KEY]}
              alt="Логотип"
              onClick={() => onPickImage('logo')}
              title="Заменить логотип"
              className="w-full h-full object-cover rounded-full pointer-events-auto cursor-pointer"
              draggable={false}
            />
          ) : (
            <button
              type="button"
              onClick={() => onPickImage('logo')}
              className="w-full h-full rounded-full pointer-events-auto cursor-pointer border border-dashed border-neutral-500 text-neutral-400 text-[1.4cqw]"
            >
              Лого
            </button>
          )}
        </div>
      )}

      {branding.showTitle && (
        <div
          className="absolute"
          style={{
            left: centeredComp
              ? `${centeredComp.authorCx}%`
              : `calc(33.5% + ${authorPlace.dx}%)`,
            top: centeredComp
              ? `${(centeredComp.authorCy / 56.25) * 100}%`
              : `calc(26% + ${authorPlace.dy}%)`,
            width: `${12.4 * authorPlace.scale / 100}%`,
            aspectRatio: '1',
            transform: 'translate(-50%,-50%)',
          }}
        >
          {urls[BRANDING_AUTHOR_KEY] ? (
            <img
              src={urls[BRANDING_AUTHOR_KEY]}
              alt="Автор"
              onClick={() => onPickImage('author')}
              title="Заменить фото"
              className="w-full h-full object-cover rounded-full pointer-events-auto cursor-pointer"
              draggable={false}
            />
          ) : (
            <button
              type="button"
              onClick={() => onPickImage('author')}
              className="w-full h-full rounded-full pointer-events-auto cursor-pointer border border-dashed border-neutral-500 text-neutral-400 text-[1.4cqw]"
            >
              Фото
            </button>
          )}
        </div>
      )}
      <div
        className="absolute"
        style={{
          left: centeredComp
            ? `${centeredComp.titleX}%`
            : `calc(40.5% + ${songPlace.dx}%)`,
          top: `${textOverlay.titleTopPct}%`,
          width: '39%',
          lineHeight: 1,
        }}
      >
        {field('title', branding.title, 'Название', {
          fontSize: `${3.2 * songPlace.scale / 100}cqw`, fontWeight: 700, color: branding.titleColor || '#FFF6E0', lineHeight: 1,
        })}
      </div>
      {(['line1', 'line2', 'line3'] as const).map((key, i) => (
        <div
          key={key}
          className="absolute"
          style={{
            left: centeredComp
              ? `${centeredComp.sublinesX}%`
              : `calc(40.5% + ${titlePlace.dx}%)`,
            top: `${textOverlay.lineTopPct(i)}%`,
            width: '39%',
            lineHeight: 1,
          }}
        >
          {field(key, branding[key], `Строка ${i + 1}`, {
            fontSize: `${2.45 * titlePlace.scale / 100}cqw`, fontWeight: 500, color: branding.linesColor || '#56FFFC', lineHeight: 1,
          })}
        </div>
      ))}

      {branding.showQR && (
        <div
          className="absolute"
          style={{
            left: `calc(81.5% + ${qrPlace.dx}%)`,
            top: `calc(6% + ${qrPlace.dy}%)`,
            width: `${16 * qrPlace.scale / 100}%`,
          }}
        >
          {urls[BRANDING_QR_KEY] ? (
            <img
              src={urls[BRANDING_QR_KEY]}
              alt="QR"
              onClick={() => onPickImage('qr')}
              title="Заменить QR"
              className="w-full pointer-events-auto cursor-pointer"
              style={{ aspectRatio: `${qrAspect}` }}
              draggable={false}
            />
          ) : (
            <button
              type="button"
              onClick={() => onPickImage('qr')}
              className="w-full pointer-events-auto cursor-pointer border border-dashed border-neutral-500 text-neutral-400 text-[1.4cqw] bg-white/5"
              style={{ aspectRatio: '1' }}
            >
              QR
            </button>
          )}
        </div>
      )}
    </div>
  );
}
