import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';
import {
  UploadCloud,
  FileAudio,
  FileText,
  Globe,
  Sparkles,
  AlertCircle,
  Music,
  X,
  Info,
  Mic,
  CheckCircle2,
  Sliders,
  Zap,
  KeyRound,
} from 'lucide-react';
import { SupportedLanguage } from '../../shared/types';
import { getApiKey, setApiKey } from '../services/settings';

interface AudioUploadSectionProps {
  onStartTranscription: (params: {
    audioFile: File;
    vocalTrackFile?: File | null;
    lyricsPrompt: string;
    language: SupportedLanguage;
    useReferenceLyrics: boolean;
    apiKey?: string;
  }) => void;
  isLoading: boolean;
}

const SUPPORTED_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm'];
const SUPPORTED_MIME_TYPES = [
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
  'video/webm',
];

export const AudioUploadSection: React.FC<AudioUploadSectionProps> = ({
  onStartTranscription,
  isLoading,
}) => {
  // Main Audio (Original Full Song)
  const [audioFile, setAudioFile] = useState<File | null>(null);

  // Optional Clean Vocal Track for AI Transcription
  const [vocalTrackFile, setVocalTrackFile] = useState<File | null>(null);

  // Reference lyrics
  const [lyricsPrompt, setLyricsPrompt] = useState<string>('');
  const [useReferenceLyrics, setUseReferenceLyrics] = useState<boolean>(true);

  // Language & state
  const [language, setLanguage] = useState<SupportedLanguage>('auto');
  const [isMainDragOver, setIsMainDragOver] = useState<boolean>(false);
  const [isVocalDragOver, setIsVocalDragOver] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Gemini API key (persisted locally, sent with the request)
  const [apiKey, setApiKeyState] = useState<string>(() => getApiKey());

  const handleApiKeyChange = (value: string) => {
    setApiKeyState(value);
    setApiKey(value);
  };

  const mainFileInputRef = useRef<HTMLInputElement>(null);
  const vocalFileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): boolean => {
    setErrorMessage(null);
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isSupportedExt = SUPPORTED_EXTENSIONS.includes(ext);
    const isSupportedMime = SUPPORTED_MIME_TYPES.some(
      (mime) => file.type.startsWith('audio/') || file.type === mime
    );

    if (!isSupportedExt && !isSupportedMime) {
      setErrorMessage(
        `Формат файла .${ext || 'unknown'} не поддерживается. Допустимые форматы: MP3, WAV, M4A, AAC, FLAC, OGG, WebM.`
      );
      return false;
    }

    if (file.size > 80 * 1024 * 1024) {
      setErrorMessage('Размер файла превышает 80 МБ. Пожалуйста, выберите файл меньшего размера.');
      return false;
    }

    return true;
  };

  const handleMainFileSelect = (file: File) => {
    if (validateFile(file)) {
      setAudioFile(file);
    }
  };

  const handleVocalFileSelect = (file: File) => {
    if (validateFile(file)) {
      setVocalTrackFile(file);
    }
  };

  const handleLyricsChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLyricsPrompt(val);
    if (val.trim().length > 0) {
      setUseReferenceLyrics(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!audioFile) {
      setErrorMessage('Пожалуйста, загрузите основной аудиофайл песни (оригинальный трек).');
      return;
    }

    onStartTranscription({
      audioFile,
      vocalTrackFile: vocalTrackFile || null,
      lyricsPrompt: lyricsPrompt.trim(),
      language,
      useReferenceLyrics: Boolean(lyricsPrompt.trim() && useReferenceLyrics),
      apiKey: apiKey.trim() || undefined,
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} КБ`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  };

  const hasLyrics = lyricsPrompt.trim().length > 0;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Studio Banner / Intro */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-3.5 shadow-sm">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          Музыкальный ИИ-синхронизатор
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Автоматическое создание караоке и таймкодов
        </h2>
        <p className="mt-2 text-sm text-neutral-400 max-w-2xl mx-auto">
          Загрузите оригинальную песню. Gemini 3.5 AI определит тайминги каждого слова с субсекундной точностью и сформирует видео караоке 1080p.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Step 0: Gemini API key (persisted locally) */}
        <div className="p-5 rounded-2xl bg-neutral-900/80 border border-neutral-800 shadow-xl">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
              <KeyRound className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-white">Gemini API ключ</h3>
            {apiKey.trim() ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                Сохранён
              </span>
            ) : (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700 font-semibold">
                Не задан — будет использован ключ сервера (.env)
              </span>
            )}
          </div>
          <input
            id="gemini-api-key-input"
            type="password"
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            placeholder="AIza... (взять: aistudio.google.com → Get API key)"
            autoComplete="off"
            className="w-full px-4 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-xs text-neutral-100 placeholder-neutral-500 font-mono transition-colors"
          />
          <p className="text-[11px] text-neutral-500 mt-1.5">
            Хранится только в этом браузере, отправляется вместе с запросом транскрибации.
          </p>
        </div>

        {/* Step 1: Main Audio File (Original Song) */}
        <div className="p-6 rounded-2xl bg-neutral-900/80 border border-neutral-800 shadow-xl relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold text-xs border border-cyan-500/20">
                1
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Music className="w-4 h-4 text-cyan-400" />
                  Основной аудиофайл (Оригинальная песня)
                </h3>
              </div>
            </div>
            <span className="text-xs text-neutral-400 font-mono">
              MP3, WAV, M4A, AAC, FLAC, OGG, WebM
            </span>
          </div>

          <p className="text-xs text-neutral-400 mb-3.5">
            Этот трек используется для <strong className="text-neutral-200">воспроизведения в караоке-плеере</strong>, экрана <strong className="text-neutral-200">предпросмотра</strong> и <strong className="text-neutral-200">итогового видео</strong>.
          </p>

          <input
            id="audio-file-input"
            ref={mainFileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleMainFileSelect(e.target.files[0]);
              }
            }}
          />

          {!audioFile ? (
            <div
              id="audio-dropzone"
              onClick={() => mainFileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsMainDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsMainDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsMainDragOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleMainFileSelect(e.dataTransfer.files[0]);
                }
              }}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
                isMainDragOver
                  ? 'border-cyan-400 bg-cyan-500/10 scale-[1.01]'
                  : 'border-neutral-700/80 hover:border-neutral-600 bg-neutral-950/40 hover:bg-neutral-950/60'
              }`}
            >
              <div className="w-14 h-14 mx-auto mb-3.5 rounded-2xl bg-neutral-800 flex items-center justify-center text-cyan-400 shadow-inner group-hover:scale-105 transition-transform">
                <UploadCloud className="w-7 h-7" />
              </div>
              <p className="text-sm font-semibold text-white">
                Перетащите файл оригинальной песни сюда или{' '}
                <span className="text-cyan-400 underline underline-offset-2">выберите на устройстве</span>
              </p>
              <p className="text-xs text-neutral-400 mt-1.5">
                Основной аудиомикс с вокалом и музыкой (до 80 МБ)
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-neutral-950/80 border border-neutral-700/80 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-600/30 to-indigo-600/30 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                  <FileAudio className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{audioFile.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-neutral-400">{formatFileSize(audioFile.size)}</span>
                    <span className="text-neutral-600">•</span>
                    <span className="text-[11px] font-mono uppercase px-1.5 py-0.5 rounded bg-neutral-800 text-cyan-300 border border-neutral-700">
                      Оригинал
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => mainFileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-700 transition-colors cursor-pointer"
                >
                  Заменить
                </button>
                <button
                  type="button"
                  onClick={() => setAudioFile(null)}
                  className="p-1.5 rounded-lg bg-neutral-800/80 hover:bg-red-900/30 text-neutral-400 hover:text-red-400 transition-colors cursor-pointer"
                  title="Удалить файл"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Section: Повышение точности (Accuracy Boost) */}
        <div className="p-6 rounded-2xl bg-neutral-900/80 border border-neutral-800 shadow-xl space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-500/20">
                <Zap className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  Повышение точности
                </h3>
                <span className="text-[11px] text-neutral-400">
                  Дополнительные инструменты для идеального распознавания и синхронизации
                </span>
              </div>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-950/70 text-indigo-300 border border-indigo-500/30">
              Опционально
            </span>
          </div>

          {/* 2.1 Clean Vocal Track Upload */}
          <div className="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-indigo-400" />
                <h4 className="text-sm font-semibold text-white">
                  Чистый вокал для распознавания (Acapella / Vocal Stem)
                </h4>
              </div>
              <span className="text-[11px] font-mono text-neutral-400">
                Только для Gemini AI
              </span>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed">
              Если у вас есть изолированная вокальная дорожка (без инструментов и ударных), загрузите её сюда. Gemini 3.5 AI распознает слова по чистому вокалу, а его форма волны появится на шкале для правки начала слов. <strong className="text-neutral-200">Караоке-плеер, предпросмотр и готовое видео будут звучать с оригинальной песней.</strong>
            </p>

            <div className="text-[11px] text-indigo-300/90 bg-indigo-950/40 p-2.5 rounded-lg border border-indigo-500/20 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
              <span>Обе дорожки должны начинаться в один момент времени и иметь одинаковую временную шкалу.</span>
            </div>

            <input
              id="vocal-file-input"
              ref={vocalFileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleVocalFileSelect(e.target.files[0]);
                }
              }}
            />

            {!vocalTrackFile ? (
              <div
                id="vocal-dropzone"
                onClick={() => vocalFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsVocalDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsVocalDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsVocalDragOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleVocalFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                className={`border border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                  isVocalDragOver
                    ? 'border-indigo-400 bg-indigo-500/10'
                    : 'border-neutral-700/70 hover:border-indigo-500/50 bg-neutral-900/40 hover:bg-neutral-900/70'
                }`}
              >
                <div className="flex items-center justify-center gap-2 text-xs font-semibold text-neutral-300">
                  <Mic className="w-4 h-4 text-indigo-400" />
                  <span>
                    Нажмите, чтобы прикрепить чистый вокал, или перетащите файл
                  </span>
                </div>
                <span className="text-[11px] text-neutral-500 mt-1 block">
                  Необязательно • Вокал используется для распознавания и формы волны
                </span>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30 shrink-0">
                    <Mic className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-white truncate">
                        {vocalTrackFile.name}
                      </p>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                        {formatFileSize(vocalTrackFile.size)}
                      </span>
                    </div>
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
                      <CheckCircle2 className="w-3 h-3" />
                      Вокал подключен к Gemini AI для распознавания
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => vocalFileInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-700 transition-colors cursor-pointer"
                  >
                    Заменить
                  </button>
                  <button
                    type="button"
                    onClick={() => setVocalTrackFile(null)}
                    className="p-1 rounded-lg bg-neutral-800 hover:bg-red-900/30 text-neutral-400 hover:text-red-400 transition-colors cursor-pointer"
                    title="Удалить вокальную дорожку"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2.2 Reference Lyrics Text Input */}
          <div className="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <h4 className="text-sm font-semibold text-white">
                  Эталонный текст песни (Reference Lyrics)
                </h4>
              </div>
              <span className="text-[11px] text-neutral-400 font-medium px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700/50">
                Рекомендуется
              </span>
            </div>

            <p className="text-xs text-neutral-400">
              Вставьте официальный текст песни. Режим <strong className="text-neutral-200">Reference Alignment</strong> сохранит оригинальное написание, пунктуацию и разбиение по строкам, сопоставив с ними таймкоды Gemini.
            </p>

            <textarea
              id="lyrics-prompt-input"
              rows={4}
              value={lyricsPrompt}
              onChange={handleLyricsChange}
              placeholder="Вставьте эталонные слова песни по строкам (например:&#10;Я помню чудное мгновенье&#10;Передо мной явилась ты...)"
              className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-xs text-neutral-100 placeholder-neutral-500 font-mono resize-y transition-colors"
            />

            {/* Toggle: Использовать текст песни как эталон */}
            <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between">
              <label
                htmlFor="toggle-ref-lyrics"
                className={`flex items-center gap-2.5 cursor-pointer select-none text-xs ${
                  hasLyrics ? 'text-neutral-200' : 'text-neutral-500 cursor-not-allowed'
                }`}
              >
                <input
                  type="checkbox"
                  id="toggle-ref-lyrics"
                  disabled={!hasLyrics}
                  checked={hasLyrics && useReferenceLyrics}
                  onChange={(e) => setUseReferenceLyrics(e.target.checked)}
                  className="w-4 h-4 rounded border-neutral-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-neutral-900 bg-neutral-950 accent-cyan-500 cursor-pointer"
                />
                <span className="font-semibold">
                  Использовать текст песни как эталон (Reference Lyrics Alignment)
                </span>
              </label>

              {hasLyrics && (
                <span className="text-[11px] text-cyan-400 flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  Оригинальный текст будет сохранён без изменений
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Step 3: Language Selector */}
        <div className="p-6 rounded-2xl bg-neutral-900/80 border border-neutral-800 shadow-xl">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-xs border border-emerald-500/20">
              3
            </div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-400" />
              Язык аудио
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { id: 'auto', label: 'Автоопределение', desc: 'ИИ автоматически определит язык' },
              { id: 'ru', label: 'Русский', desc: 'Оптимизировано для русской речи (ё/е эквивалентность)' },
              { id: 'en', label: 'Английский', desc: 'Оптимизировано для английской речи' },
            ].map((item) => (
              <label
                key={item.id}
                id={`lang-option-${item.id}`}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col ${
                  language === item.id
                    ? 'border-cyan-500 bg-cyan-500/10 text-white ring-1 ring-cyan-500/30'
                    : 'border-neutral-800 bg-neutral-950/40 hover:bg-neutral-800/50 text-neutral-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">{item.label}</span>
                  <input
                    type="radio"
                    name="language"
                    value={item.id}
                    checked={language === item.id}
                    onChange={() => setLanguage(item.id as SupportedLanguage)}
                    className="accent-cyan-500 w-4 h-4"
                  />
                </div>
                <span className="text-[11px] text-neutral-400">{item.desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Error message if any */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {/* Action Button */}
        <div className="pt-2">
          <button
            id="btn-start-sync"
            type="submit"
            disabled={!audioFile || isLoading}
            className={`w-full py-4 px-6 rounded-2xl font-bold text-base tracking-wide flex items-center justify-center gap-3 transition-all duration-200 shadow-xl ${
              !audioFile || isLoading
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700/50'
                : 'bg-gradient-to-r from-cyan-500 via-teal-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 active:scale-[0.99] text-white shadow-cyan-500/25 ring-1 ring-white/20 cursor-pointer'
            }`}
          >
            <Music className="w-5 h-5" />
            <span>
              {vocalTrackFile
                ? 'Распознать вокал и синхронизировать с оригиналом'
                : 'Распознать и синхронизировать'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};
