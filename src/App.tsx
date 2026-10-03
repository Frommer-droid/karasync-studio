import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  WordTiming,
  LineTiming,
  SupportedLanguage,
  ProcessingProgress,
  VideoPreviewConfig,
  AlignmentStats,
  KaraokeProject,
  DEFAULT_BRANDING,
} from '../shared/types';
import { getKaraokeFrameState, groupWordsIntoLines, mergeStandaloneDashTokens } from '../shared/syncAlgorithm';
import { deleteWord, moveWordStart, shiftAllWordTimings } from '../shared/wordStartEdit';
import { fileToBase64, requestTranscription } from './services/api';
import { prepareAudioForTranscription } from './utils/audioOptimizer';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import {
  saveOriginalAudioBlob,
  getOriginalAudioBlob,
  saveVocalAudioBlob,
  getVocalAudioBlob,
  clearVocalAudioBlob,
} from './services/audioStorage';
import { getApiKey } from './services/settings';
import { resolveImageUrl } from './services/imageStorage';
import { normalizeRestoredVideoConfig } from './utils/configRestore';
import { extractVocalPeaks } from './utils/vocalWaveform';
import { Header } from './components/Header';
import { AudioUploadSection } from './components/AudioUploadSection';
import { ProcessingOverlay } from './components/ProcessingOverlay';
import { AudioPlayerControls } from './components/AudioPlayerControls';
import { WaveformTimeline } from './components/WaveformTimeline';
import { SyncEditor } from './components/SyncEditor';
import { VideoPreview, type VideoPreviewActions } from './components/VideoPreview';
import { ExportModal } from './components/ExportModal';
import { VideoExportModal } from './components/VideoExportModal';

const LOCAL_STORAGE_PROJECT_KEY = 'karaoke_sync_studio_active_project_v1';

async function decodeVocalWaveform(file: File): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    return extractVocalPeaks(await context.decodeAudioData(await file.arrayBuffer()));
  } finally {
    await context.close();
  }
}

export default function App() {
  // Audio Player hook
  const audioPlayer = useAudioPlayer();
  const videoPreviewRef = useRef<VideoPreviewActions | null>(null);

  // Project state
  const [audioFileName, setAudioFileName] = useState<string>('');
  const [audioFileBlob, setAudioFileBlob] = useState<File | null>(null);
  const [vocalWaveform, setVocalWaveform] = useState<{ peaks: Float32Array; name: string } | null>(null);
  const [vocalWaveformLoading, setVocalWaveformLoading] = useState(false);
  const [vocalWaveformError, setVocalWaveformError] = useState(false);
  const vocalLoadId = useRef(0);
  const vocalTrackFileRef = useRef<File | null>(null);
  const [providedLyrics, setProvidedLyrics] = useState<string>('');
  const [useReferenceLyrics, setUseReferenceLyrics] = useState<boolean>(true);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('auto');

  // Transcription and alignment data
  const [words, setWords] = useState<WordTiming[]>([]);
  const [lines, setLines] = useState<LineTiming[]>([]);
  const [originalWords, setOriginalWords] = useState<WordTiming[]>([]);
  const [originalLines, setOriginalLines] = useState<LineTiming[]>([]);
  const [fullText, setFullText] = useState<string>('');
  const [detectedLanguage, setDetectedLanguage] = useState<string | undefined>(undefined);
  const [alignmentStats, setAlignmentStats] = useState<AlignmentStats | undefined>(undefined);
  const [isAlignedWithReference, setIsAlignedWithReference] = useState<boolean>(false);

  // Selected word for inspector
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  const [playingWordId, setPlayingWordId] = useState<string | null>(null);
  // Navigation explicitly arms playback from a word start. A word selected by
  // Pause is for editing only, so ordinary Play resumes from the cursor.
  const [shouldPlayFromSelectedWord, setShouldPlayFromSelectedWord] = useState(false);

  // Undo / Redo History Stack
  const [history, setHistory] = useState<{ words: WordTiming[]; lines: LineTiming[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Processing state
  const [progress, setProgress] = useState<ProcessingProgress>({
    status: 'idle',
    message: '',
    percent: 0,
  });

  // UI state
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isVideoExportOpen, setIsVideoExportOpen] = useState<boolean>(false);
  // Показ панелей под плеером (waveform + редактор). Глаз в плеере прячет их для чистого просмотра.
  // Хранится отдельно от проекта — переживает перезагрузки. По умолчанию скрыты.
  const [showStudioPanels, setShowStudioPanels] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('karasync_ui_show_panels');
      return saved === null ? false : saved === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('karasync_ui_show_panels', showStudioPanels ? '1' : '0');
    } catch {
      // ignore (private mode etc.)
    }
  }, [showStudioPanels]);

  const [activePreviewSettingsPanel, setActivePreviewSettingsPanel] = useState<'text' | 'layout' | 'position' | null>(null);

  // Размер окна предпросмотра влияет только на интерфейс, а не на экспорт.
  const [previewWidth, setPreviewWidth] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem('karasync_ui_preview_width') || '', 10);
      return Number.isFinite(saved) ? Math.min(100, Math.max(40, saved)) : 100;
    } catch {
      return 100;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('karasync_ui_preview_width', String(previewWidth));
    } catch {
      // ignore (private mode etc.)
    }
  }, [previewWidth]);

  // Video preview styling config
  const [videoConfig, setVideoConfig] = useState<VideoPreviewConfig>({
    backgroundImageUrl: null,
    backgroundDim: 40,
    backgroundBlur: 0,
    fontSize: 'medium',
    fontSizePx: 50,
    autoFitFontSize: true,
    fontFamily: 'inter',
    textPosition: 'lower_third',
    lyricsPositionY: 78,
    strokeWidth: 3,
    backdropOpacity: 85,
    karaokeColor: '#56FFFC',
    textColor: '#ffffff',
    backgroundColor: '#231825',
    fontWeight: 800,
    lineHeight: 1.15,
    showNextLine: true,
    branding: { ...DEFAULT_BRANDING },
    coverVideo: { enabledIntro: false, enabledOutro: false, videoId: null },
  });

  // NOTE: глобальной коррекции синхронизации больше нет — тайминги идут 1:1 со звуком.

  // Флаг: восстановление завершено — только после этого разрешён автосейв,
  // иначе стартовые дефолты затрут сохранённый проект.
  const restoredRef = useRef<boolean>(false);

  // Auto-load project from localStorage and restore original audio blob from IndexedDB on initial render
  useEffect(() => {
    let isMounted = true;
    const restoreVocalId = vocalLoadId.current;

    async function restoreProjectAndAudio() {
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_PROJECT_KEY);
        if (saved) {
          const parsed: KaraokeProject = JSON.parse(saved);
          // Конфиг оформления — всегда (даже если слов нет: настройки должны пережить перезапуск сами по себе)
          if (parsed.videoConfig) {
            const restoredConfig = normalizeRestoredVideoConfig(parsed.videoConfig);
            // Фон: blob:-URL мёртв, но картинка лежит в IndexedDB по id — восстанавливаем URL сессии
            if (!restoredConfig.backgroundImageUrl && restoredConfig.backgroundImageId) {
              const url = await resolveImageUrl(restoredConfig.backgroundImageId);
              if (url && isMounted) restoredConfig.backgroundImageUrl = url;
            }
            if (isMounted) setVideoConfig(restoredConfig);
          }
          if (Array.isArray(parsed.words)) {
            const restoredWords = mergeStandaloneDashTokens(parsed.words);
            const restoredWordsChanged = restoredWords.length !== parsed.words.length;
            const originalWords = mergeStandaloneDashTokens(parsed.originalWords || parsed.words);
            const originalWordsChanged = originalWords.length !== (parsed.originalWords || parsed.words).length;
            const restoredLines = restoredWordsChanged || !parsed.lines?.length
              ? groupWordsIntoLines(restoredWords, parsed.providedLyrics, parsed.useReferenceLyrics)
              : parsed.lines;
            const originalLines = originalWordsChanged || !parsed.originalLines?.length
              ? groupWordsIntoLines(originalWords, parsed.providedLyrics, parsed.useReferenceLyrics)
              : parsed.originalLines;

            setWords(restoredWords);
            setLines(restoredLines);
            setOriginalWords(originalWords);
            setOriginalLines(originalLines);
            setFullText(parsed.fullText || '');
            setAudioFileName(parsed.audioFileName || 'song.mp3');
            setProvidedLyrics(parsed.providedLyrics || '');
            setUseReferenceLyrics(parsed.useReferenceLyrics ?? true);
            setSelectedLanguage(parsed.language || 'auto');
            setAlignmentStats(parsed.alignmentStats);
            setIsAlignedWithReference(Boolean(parsed.isAlignedWithReference));

            // Seed initial history state
            setHistory([{ words: restoredWords, lines: restoredLines }]);
            setHistoryIndex(0);
          }
        }

        // Restore original audio File/Blob from IndexedDB
        const [storedAudio, storedVocal] = await Promise.all([getOriginalAudioBlob(), getVocalAudioBlob()]);
        if (storedVocal && isMounted && vocalLoadId.current === restoreVocalId) vocalTrackFileRef.current = storedVocal;
        if (storedVocal && isMounted && vocalLoadId.current === restoreVocalId) setVocalWaveformLoading(true);
        if (storedAudio && isMounted) {
          setAudioFileBlob(storedAudio.file);
          setAudioFileName(storedAudio.name);
          await audioPlayer.loadAudioFile(storedAudio.file);
        }
        if (storedVocal && isMounted && vocalLoadId.current === restoreVocalId) {
          try {
            const peaks = await decodeVocalWaveform(storedVocal);
            if (isMounted && vocalLoadId.current === restoreVocalId) setVocalWaveform({ peaks, name: storedVocal.name });
          } catch (error) {
            console.warn('Could not decode stored vocal waveform:', error);
            if (isMounted && vocalLoadId.current === restoreVocalId) setVocalWaveformError(true);
          } finally {
            if (isMounted && vocalLoadId.current === restoreVocalId) setVocalWaveformLoading(false);
          }
        }
      } catch (e) {
        console.warn('Could not restore project/audio:', e);
      } finally {
        restoredRef.current = true;
      }
    }

    restoreProjectAndAudio();

    return () => {
      isMounted = false;
    };
  }, []);

  // Auto-save project to localStorage whenever relevant state changes.
  // Пишем всегда (даже без слов), чтобы оформление жило само по себе.
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      const projectData: KaraokeProject = {
        audioUrl: null,
        audioFileName,
        audioDuration: audioPlayer.duration,
        audioMimeType: 'audio/mp3',
        providedLyrics,
        language: selectedLanguage,
        useReferenceLyrics,
        words,
        lines,
        originalWords,
        originalLines,
        fullText,
        alignmentStats,
        isAlignedWithReference,
        videoConfig,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(LOCAL_STORAGE_PROJECT_KEY, JSON.stringify(projectData));
    } catch (e) {
      console.warn('Could not auto-save project to localStorage:', e);
    }
  }, [
    words,
    lines,
    audioFileName,
    audioPlayer.duration,
    providedLyrics,
    selectedLanguage,
    useReferenceLyrics,
    originalWords,
    originalLines,
    fullText,
    alignmentStats,
    isAlignedWithReference,
    videoConfig,
  ]);

  // Push to Undo/Redo history helper
  const pushHistory = useCallback((newWords: WordTiming[], newLines: LineTiming[]) => {
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      return [...newHistory, { words: newWords, lines: newLines }].slice(-50); // keep last 50 states
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
  }, [historyIndex]);

  // Undo handler
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const targetState = history[historyIndex - 1];
      setWords(targetState.words);
      setLines(targetState.lines);
      setHistoryIndex((idx) => idx - 1);
    }
  }, [history, historyIndex]);

  // Redo handler
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const targetState = history[historyIndex + 1];
      setWords(targetState.words);
      setLines(targetState.lines);
      setHistoryIndex((idx) => idx + 1);
    }
  }, [history, historyIndex]);

  // Start transcription and alignment workflow
  const handleStartTranscription = async (params: {
    audioFile: File;
    vocalTrackFile?: File | null;
    lyricsPrompt: string;
    language: SupportedLanguage;
    useReferenceLyrics: boolean;
    apiKey?: string;
  }) => {
    const { audioFile, vocalTrackFile, lyricsPrompt, language, useReferenceLyrics: useRef } = params;
    vocalTrackFileRef.current = vocalTrackFile ?? null;
    // Ключ из формы либо сохранённый ранее (важно для повторного запуска из оверлея ошибки)
    const apiKey = (params.apiKey || getApiKey()).trim() || undefined;
    setAudioFileName(audioFile.name);
    setAudioFileBlob(audioFile); // The original song is ALWAYS used for playback, preview, and video export
    const vocalId = ++vocalLoadId.current;
    setVocalWaveform(null);
    setVocalWaveformError(false);
    setVocalWaveformLoading(Boolean(vocalTrackFile));
    setProvidedLyrics(lyricsPrompt);
    setUseReferenceLyrics(useRef);
    setSelectedLanguage(language);

    // Persist original audio in IndexedDB so it survives page reloads
    await saveOriginalAudioBlob(audioFile, audioFile.name);
    if (vocalTrackFile) {
      await saveVocalAudioBlob(vocalTrackFile);
      try {
        const peaks = await decodeVocalWaveform(vocalTrackFile);
        if (vocalLoadId.current === vocalId) setVocalWaveform({ peaks, name: vocalTrackFile.name });
      } catch (error) {
        console.warn('Could not decode vocal waveform:', error);
        if (vocalLoadId.current === vocalId) setVocalWaveformError(true);
      } finally {
        if (vocalLoadId.current === vocalId) setVocalWaveformLoading(false);
      }
    } else {
      await clearVocalAudioBlob();
    }

    // Step 1: Load original song locally into audio player
    setProgress({
      status: 'uploading',
      message: 'Загрузка оригинальной песни в караоке-плеер...',
      percent: 15,
    });

    try {
      // Load ORIGINAL song into HTML5 audio player (for караоке, preview, timeline)
      await audioPlayer.loadAudioFile(audioFile);

      // Determine which track to transcribe: clean vocal track if provided, otherwise the original full song
      const fileToTranscribe = vocalTrackFile || audioFile;
      const isVocalTrack = Boolean(vocalTrackFile);

      setProgress({
        status: 'gemini_upload',
        message: isVocalTrack
          ? 'Оптимизация дорожки вокала и подготовка к отправке...'
          : 'Оптимизация аудиозаписи и подготовка к отправке...',
        percent: 30,
      });

      // Prepare audio for transcription (downsample large WAV/FLAC if >15MB for fast network transfer)
      const preparedAudio = await prepareAudioForTranscription(fileToTranscribe);

      setProgress({
        status: 'gemini_upload',
        message: isVocalTrack
          ? 'Отправка дорожки вокала в Gemini AI...'
          : 'Отправка аудиозаписи в Gemini AI...',
        percent: 45,
      });

      const audioBase64 = await fileToBase64(preparedAudio.blob);

      setProgress({
        status: 'transcribing',
        message: isVocalTrack
          ? 'Высокоточное распознавание вокала с изолированной дорожки...'
          : 'Распознавание речи и определение таймкодов Gemini 3.5 Transcribe...',
        percent: 65,
      });

      // Call server backend (ключ из интерфейса — приоритет над серверным .env)
      const response = await requestTranscription({
        audioBase64,
        mimeType: preparedAudio.mimeType,
        fileName: preparedAudio.fileName,
        isVocalTrackUsed: isVocalTrack,
        lyricsPrompt: lyricsPrompt || undefined,
        language,
        useReferenceLyrics: useRef,
        apiKey,
      });

      setProgress({
        status: 'processing',
        message: lyricsPrompt ? 'Сопоставление с эталонным текстом (Alignment)...' : 'Формирование структуры караоке...',
        percent: 90,
      });

      setWords(response.words);
      setLines(response.lines);
      setOriginalWords(response.words);
      setOriginalLines(response.lines);
      setFullText(response.fullText);
      setDetectedLanguage(response.detectedLanguage);
      setAlignmentStats(response.alignmentStats);
      setIsAlignedWithReference(Boolean(response.isAlignedWithReference));

      // Reset history with fresh initial state
      setHistory([{ words: response.words, lines: response.lines }]);
      setHistoryIndex(0);

      // После каждой обработки: фиксированный стартовый вид превью
      // (блок строк по центру, интервал 1.75, Montserrat обычный, автоподбор ширины).
      setVideoConfig((prev) => ({
        ...prev,
        textPosition: 'middle',
        lyricsPositionY: 50,
        lineHeight: 1.75,
        fontFamily: 'montserrat',
        fontWeight: 400,
        autoFitFontSize: true,
        showNextLine: true,
      }));

      setProgress({
        status: 'ready',
        message: 'Готово!',
        percent: 100,
      });

      // Auto clear overlay after brief success
      setTimeout(() => {
        setProgress({ status: 'idle', message: '', percent: 0 });
      }, 700);
    } catch (err: any) {
      console.error('Transcription failed:', err);
      setProgress({
        status: 'error',
        message: 'Ошибка',
        percent: 100,
        error: err?.message || 'Не удалось распознать аудио.',
      });
    }
  };

  // Reselect original audio file without losing transcription, word timings, or sync offsets
  const handleReselectAudio = useCallback(async (file: File) => {
    setAudioFileName(file.name);
    setAudioFileBlob(file);
    await saveOriginalAudioBlob(file, file.name);
    await audioPlayer.loadAudioFile(file);
  }, [audioPlayer]);

  const handleAttachVocalTrack = useCallback(async (file: File) => {
    const vocalId = ++vocalLoadId.current;
    setVocalWaveformLoading(true);
    setVocalWaveformError(false);
    try {
      const peaks = await decodeVocalWaveform(file);
      if (vocalLoadId.current !== vocalId) return;
      await saveVocalAudioBlob(file);
      if (vocalLoadId.current !== vocalId) return;
      vocalTrackFileRef.current = file;
      setVocalWaveform({ peaks, name: file.name });
    } catch (error) {
      console.warn('Could not attach vocal waveform:', error);
      if (vocalLoadId.current === vocalId) setVocalWaveformError(true);
    } finally {
      if (vocalLoadId.current === vocalId) setVocalWaveformLoading(false);
    }
  }, []);

  // Old saved projects can contain a standalone dash with its own timestamp.
  // Normalize it as soon as such data reaches the editor as well.
  useEffect(() => {
    const normalizedWords = mergeStandaloneDashTokens(words);
    if (normalizedWords.length === words.length) return;

    setWords(normalizedWords);
    setLines(groupWordsIntoLines(normalizedWords, providedLyrics, useReferenceLyrics));
    setOriginalWords((previous) => mergeStandaloneDashTokens(previous));
  }, [providedLyrics, useReferenceLyrics, words]);

  // `lines` and `words` describe the same lyric tokens. Older edits could
  // append a second copy to the flat list, producing a phantom extra row in
  // the editor. The line structure is canonical, so retain each of its words
  // exactly once and keep the flat flow in the same order.
  useEffect(() => {
    if (lines.length === 0) return;

    const ids = new Set<string>();
    const canonicalWords = lines.flatMap((line) => line.words).filter((word) => {
      if (ids.has(word.id)) return false;
      ids.add(word.id);
      return true;
    });
    const isAlreadyCanonical = canonicalWords.length === words.length && canonicalWords.every((word, index) => {
      const current = words[index];
      return current
        && current.id === word.id
        && current.text === word.text
        && current.start === word.start
        && current.end === word.end;
    });

    if (!isAlreadyCanonical) setWords(canonicalWords);
  }, [lines, words]);

  // Compute effective duration with robust fallbacks
  const effectiveAudioDuration =
    audioPlayer.duration > 0
      ? audioPlayer.duration
      : (audioPlayer.audioRef.current?.duration && !isNaN(audioPlayer.audioRef.current.duration) && audioPlayer.audioRef.current.duration > 0)
        ? audioPlayer.audioRef.current.duration
        : (audioPlayer.audioBuffer?.duration || 0) > 0
          ? (audioPlayer.audioBuffer?.duration || 0)
          : words.length > 0
            ? Math.max(...words.map((w) => w.end))
            : 0;

  // Single source of truth: playback time equals karaoke time (1:1, без коррекции)
  const effectiveTime = audioPlayer.currentTime;

  // Active Line and Word computation based on single shared getKaraokeFrameState
  const { currentLine: activeLine, activeWord, nextLine } = React.useMemo(() => {
    return getKaraokeFrameState(words, lines, effectiveTime);
  }, [words, lines, effectiveTime]);

  // Navigation follows lyric structure (line by line), not possibly broken timestamp order.
  const navigationWords = React.useMemo(() => {
    const seenIds = new Set<string>();
    const ordered = lines.flatMap((line) =>
      [...line.words]
        .sort((left, right) => (left.wordIndexInLine ?? 0) - (right.wordIndexInLine ?? 0))
        .filter((word) => {
          if (seenIds.has(word.id)) return false;
          seenIds.add(word.id);
          return true;
        }),
    );

    // Keep any word that is not currently assigned to a line reachable as well.
    return [...ordered, ...words.filter((word) => !seenIds.has(word.id))];
  }, [lines, words]);

  const selectedWord = selectedWordId
    ? navigationWords.find((word) => word.id === selectedWordId) ?? null
    : null;

  const previewFrame = React.useMemo(() => {
    if (audioPlayer.isPlaying || !selectedWord) {
      return { activeLine, activeWord, nextLine };
    }

    const selectedLineIndex = lines.findIndex((line) =>
      line.words.some((word) => word.id === selectedWord.id),
    );
    const selectedLine = selectedLineIndex >= 0 ? lines[selectedLineIndex] : activeLine;

    return {
      activeLine: selectedLine,
      activeWord: selectedWord,
      nextLine: selectedLineIndex >= 0 ? lines[selectedLineIndex + 1] ?? null : nextLine,
    };
  }, [activeLine, activeWord, audioPlayer.isPlaying, lines, nextLine, selectedWord]);

  const { previousWordIndex, nextWordIndex } = React.useMemo(() => {
    const selectedWordIndex = selectedWord
      ? navigationWords.findIndex((word) => word.id === selectedWord.id)
      : -1;

    // Pause always selects the word just sung (including in the tail after the
    // final line), so word navigation must use that selection rather than a
    // later audio cursor position.
    if (selectedWordIndex >= 0) {
      return {
        previousWordIndex: selectedWordIndex - 1,
        nextWordIndex: selectedWordIndex + 1,
      };
    }

    const previousByTime = navigationWords.reduce(
      (lastIndex, word, index) => word.end <= effectiveTime + 0.001 ? index : lastIndex,
      -1,
    );

    return {
      previousWordIndex: previousByTime,
      nextWordIndex: navigationWords.findIndex((word) => word.start >= effectiveTime - 0.001),
    };
  }, [effectiveTime, navigationWords, selectedWord]);

  const handleGoToWord = useCallback((direction: -1 | 1) => {
    if (audioPlayer.isPlaying) return;

    const targetIndex = direction < 0 ? previousWordIndex : nextWordIndex;
    const targetWord = navigationWords[targetIndex];
    if (!targetWord) return;

    audioPlayer.pause();
    setPlayingWordId(null);
    setSelectedWordId(targetWord.id);
    setShouldPlayFromSelectedWord(true);
    audioPlayer.seek(targetWord.start);
  }, [audioPlayer, navigationWords, nextWordIndex, previousWordIndex]);

  const handleSeek = useCallback((time: number) => {
    setPlayingWordId(null);
    setSelectedWordId(null);
    setShouldPlayFromSelectedWord(false);
    audioPlayer.seek(time);
  }, [audioPlayer]);

  const handleToggleTransportPlay = useCallback(() => {
    setPlayingWordId(null);
    if (audioPlayer.isPlaying) {
      const pausedAt = audioPlayer.audioRef.current?.currentTime ?? audioPlayer.currentTime;
      const frameAtPause = getKaraokeFrameState(words, lines, pausedAt);
      let pausedWord = frameAtPause.activeWord;

      // A very short gap can fall between word ranges. In that case, retain
      // the word just sung from the rendered line data, which is the useful
      // one for timing correction and can always be highlighted on screen.
      if (!pausedWord) {
        for (const word of lines.flatMap((line) => line.words)) {
          if (word.end <= pausedAt + 0.001 && (!pausedWord || word.end > pausedWord.end)) {
            pausedWord = word;
          }
        }
      }

      audioPlayer.pause();
      if (pausedWord) {
        setSelectedWordId(pausedWord.id);
      } else {
        setSelectedWordId(null);
      }
      setShouldPlayFromSelectedWord(false);
      return;
    }

    if (selectedWord && shouldPlayFromSelectedWord) {
      audioPlayer.clearLoop();
      audioPlayer.seek(selectedWord.start);
      setSelectedWordId(null);
      setShouldPlayFromSelectedWord(false);
      audioPlayer.play();
      return;
    }

    audioPlayer.play();
  }, [audioPlayer, lines, navigationWords, selectedWord, shouldPlayFromSelectedWord, words]);

  const handleMoveWordStart = useCallback((wordId: string, requestedStart: number) => {
    const result = moveWordStart(words, lines, wordId, requestedStart, effectiveAudioDuration);
    if (!result) return;
    setWords(result.words);
    setLines(result.lines);
    pushHistory(result.words, result.lines);
    setSelectedWordId(wordId);
    setShouldPlayFromSelectedWord(false);
    setPlayingWordId(null);
    audioPlayer.pause();
    audioPlayer.seek(result.start);
  }, [words, lines, effectiveAudioDuration, pushHistory, audioPlayer]);

  const handleDeleteWord = useCallback((wordId: string) => {
    const result = deleteWord(words, lines, wordId);
    if (!result) return;
    audioPlayer.pause();
    setWords(result.words);
    setLines(result.lines);
    pushHistory(result.words, result.lines);
    setSelectedWordId(null);
    setPlayingWordId(null);
    setShouldPlayFromSelectedWord(false);
  }, [words, lines, pushHistory, audioPlayer]);

  const handleShiftAllMarkers = useCallback((deltaSeconds: number) => {
    const result = shiftAllWordTimings(words, lines, deltaSeconds, effectiveAudioDuration);
    if (!result) return;
    setWords(result.words);
    setLines(result.lines);
    pushHistory(result.words, result.lines);
  }, [words, lines, effectiveAudioDuration, pushHistory]);

  const handleToggleWordPlayback = useCallback((word: WordTiming) => {
    setShouldPlayFromSelectedWord(false);
    if (audioPlayer.isPlaying) {
      const rewindWord = navigationWords.find((candidate) => candidate.id === playingWordId) ?? word;
      audioPlayer.pause();
      audioPlayer.seek(rewindWord.start);
      setSelectedWordId(rewindWord.id);
      setPlayingWordId(null);
    } else {
      const selectedIndex = navigationWords.findIndex((candidate) => candidate.id === word.id);
      const nextMarker = navigationWords.slice(selectedIndex + 1)
        .find((candidate) => candidate.start > word.start + 0.001);
      audioPlayer.clearLoop();
      setSelectedWordId(word.id);
      setPlayingWordId(word.id);
      void audioPlayer.playRange(word.start, nextMarker?.start ?? null, true);
    }
  }, [audioPlayer, navigationWords, playingWordId]);

  const handleResetProject = async () => {
    audioPlayer.pause();
    ++vocalLoadId.current;
    vocalTrackFileRef.current = null;
    await clearVocalAudioBlob();
    setVocalWaveform(null);
    setVocalWaveformLoading(false);
    setVocalWaveformError(false);
    localStorage.removeItem(LOCAL_STORAGE_PROJECT_KEY);
    setWords([]);
    setLines([]);
    setOriginalWords([]);
    setOriginalLines([]);
    setFullText('');
    setAudioFileName('');
    setAudioFileBlob(null);
    setAlignmentStats(undefined);
    setIsAlignedWithReference(false);
    setHistory([]);
    setHistoryIndex(-1);
    setSelectedWordId(null);
    setPlayingWordId(null);
    setShouldPlayFromSelectedWord(false);
    setActivePreviewSettingsPanel(null);
  };

  // Keyboard Shortcuts (Space for play/pause, Left/Right for seek, Ctrl+Z / Ctrl+Y for Undo/Redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        handleToggleTransportPlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setPlayingWordId(null);
        audioPlayer.seek(Math.max(0, audioPlayer.currentTime - 3));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setPlayingWordId(null);
        audioPlayer.seek(Math.min(audioPlayer.duration, audioPlayer.currentTime + 3));
      } else if (e.code === 'Escape') {
        setIsExportOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioPlayer, handleRedo, handleToggleTransportPlay, handleUndo]);

  const hasTranscribedData = words.length > 0 || history.some((state) => state.words.length > 0);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
      {/* Hidden audio element managed by useAudioPlayer */}
      <audio ref={audioPlayer.audioRef} preload="metadata" />

      {/* App Header */}
      <Header
        hasData={hasTranscribedData}
        onReset={handleResetProject}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenVideoExport={() => setIsVideoExportOpen(true)}
        onSavePreset={() => videoPreviewRef.current?.openPresetSaveDialog()}
        onLoadPreset={() => videoPreviewRef.current?.openPresetFilePicker()}
        onCaptureSnapshot={() => videoPreviewRef.current?.captureSnapshot()}
        activeSettingsPanel={activePreviewSettingsPanel}
        onToggleSettingsPanel={(panel) => setActivePreviewSettingsPanel((current) => current === panel ? null : panel)}
        fileName={audioFileName}
        isAlignedWithReference={isAlignedWithReference}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-8 py-6">
        {!hasTranscribedData ? (
          /* Initial View: Upload & Settings */
          <AudioUploadSection
            onStartTranscription={handleStartTranscription}
            isLoading={progress.status !== 'idle' && progress.status !== 'error'}
          />
        ) : (
          /* Working Studio Workspace */
          <div className="space-y-6">
            {/* Top: Video Preview & Player Controls (full width) */}
            <div className="space-y-4">
                <VideoPreview
                  ref={videoPreviewRef}
                  activeLine={previewFrame.activeLine}
                  activeWord={previewFrame.activeWord}
                  nextLine={previewFrame.nextLine}
                  selectedWordId={!audioPlayer.isPlaying ? selectedWord?.id ?? null : null}
                  currentTime={effectiveTime}
                  rawMediaTime={audioPlayer.currentTime}
                  words={words}
                  lines={lines}
                  config={videoConfig}
                  audioRef={audioPlayer.audioRef}
                  previewWidth={previewWidth}
                  activeSettingsPanel={activePreviewSettingsPanel}
                  onChangeConfig={(updated) =>
                    setVideoConfig((prev) => ({ ...prev, ...updated }))
                  }
                />

                <AudioPlayerControls
                  isPlaying={audioPlayer.isPlaying}
                  currentTime={audioPlayer.currentTime}
                  duration={audioPlayer.duration}
                  volume={audioPlayer.volume}
                  isMuted={audioPlayer.isMuted}
                  playbackRate={audioPlayer.playbackRate}
                  loopRange={audioPlayer.loopRange}
                  onTogglePlay={handleToggleTransportPlay}
                  onSeek={handleSeek}
                  onSetVolume={audioPlayer.setVolume}
                  onToggleMute={audioPlayer.toggleMute}
                  onSetPlaybackRate={audioPlayer.setPlaybackRate}
                  onClearLoop={audioPlayer.clearLoop}
                  canGoToPreviousWord={!audioPlayer.isPlaying && previousWordIndex >= 0}
                  canGoToNextWord={!audioPlayer.isPlaying && nextWordIndex >= 0 && nextWordIndex < navigationWords.length}
                  onGoToWord={handleGoToWord}
                  previewWidth={previewWidth}
                  onPreviewWidthChange={setPreviewWidth}
                  onOpenFullscreen={() => videoPreviewRef.current?.openFullscreen()}
                  showPanels={showStudioPanels}
                  onTogglePanels={() => setShowStudioPanels((v) => !v)}
                />
            </div>

            {showStudioPanels && (
              <>
                <WaveformTimeline
                  audioUrl={audioPlayer.audioUrl}
                  audioBuffer={audioPlayer.audioBuffer}
                  vocalPeaks={vocalWaveform?.peaks ?? null}
                  vocalFileName={vocalWaveform?.name ?? null}
                  vocalWaveformLoading={vocalWaveformLoading}
                  vocalWaveformError={vocalWaveformError}
                  onAttachVocalTrack={handleAttachVocalTrack}
                  audioRef={audioPlayer.audioRef}
                  duration={effectiveAudioDuration}
                  currentTime={audioPlayer.currentTime}
                  isPlaying={audioPlayer.isPlaying}
                  words={navigationWords}
                  activeWord={previewFrame.activeWord}
                  selectedWordId={selectedWordId}
                  playingWordId={playingWordId}
                  onSeek={handleSeek}
                  onTogglePlay={handleToggleTransportPlay}
                  onToggleWordPlayback={handleToggleWordPlayback}
                  canGoToPreviousWord={!audioPlayer.isPlaying && previousWordIndex >= 0}
                  canGoToNextWord={!audioPlayer.isPlaying && nextWordIndex >= 0 && nextWordIndex < navigationWords.length}
                  onGoToWord={handleGoToWord}
                  onSelectWord={(word) => {
                    setPlayingWordId(null);
                    setSelectedWordId(word.id);
                    setShouldPlayFromSelectedWord(false);
                  }}
                  onMoveWordStart={handleMoveWordStart}
                  onDeleteWord={handleDeleteWord}
                  onShiftAllMarkers={handleShiftAllMarkers}
                  canUndo={historyIndex > 0}
                  canRedo={historyIndex >= 0 && historyIndex < history.length - 1}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                />

                {/* Word list and search below the waveform controls. */}
                <SyncEditor
                  words={words}
                  lines={lines}
                  activeWord={previewFrame.activeWord}
                  activeLine={previewFrame.activeLine}
                  isPlaying={audioPlayer.isPlaying}
                  selectedWordId={selectedWordId}
                  onSeek={handleSeek}
                  onSelectWord={(word) => {
                    setPlayingWordId(null);
                    setSelectedWordId(word ? word.id : null);
                    setShouldPlayFromSelectedWord(Boolean(word));
                  }}
                />
              </>
            )}
          </div>
        )}
      </main>

      {/* Progress & Error Processing Overlay */}
      {progress.status !== 'idle' && (
        <ProcessingOverlay
          progress={progress}
          onRetry={() => {
            if (audioFileBlob) {
              handleStartTranscription({
                audioFile: audioFileBlob,
                vocalTrackFile: vocalTrackFileRef.current,
                lyricsPrompt: providedLyrics,
                language: selectedLanguage,
                useReferenceLyrics,
              });
            }
          }}
          onCancel={() => {
            setProgress({ status: 'idle', message: '', percent: 0 });
          }}
        />
      )}

      {/* Subtitles & Data Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        lines={lines}
        words={words}
        audioFileName={audioFileName}
        audioDuration={effectiveAudioDuration}
      />

      {/* 1080p Video Exporter Modal */}
      <VideoExportModal
        isOpen={isVideoExportOpen}
        onClose={() => setIsVideoExportOpen(false)}
        lines={lines}
        words={words}
        audioFile={audioFileBlob || audioPlayer.audioFile || null}
        audioFileName={audioFileName}
        audioDuration={effectiveAudioDuration}
        audioUrl={audioPlayer.audioUrl || (audioPlayer.audioRef.current?.src || null)}
        audioRef={audioPlayer.audioRef}
        config={videoConfig}
        onReselectAudio={handleReselectAudio}
      />
    </div>
  );
}
