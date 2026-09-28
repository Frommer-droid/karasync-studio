import React from 'react';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Music,
  AudioWaveform,
  Cpu,
  FileCheck,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import { ProcessingProgress } from '../../shared/types';
import { AppIcon } from './AppIcon';

interface ProcessingOverlayProps {
  progress: ProcessingProgress;
  onRetry?: () => void;
  onCancel?: () => void;
}

interface StepInfo {
  key: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}

const STEPS: StepInfo[] = [
  {
    key: 'uploading',
    title: 'Загрузка файла',
    desc: 'Чтение и подготовка аудиодорожки',
    icon: <Music className="w-4 h-4" />,
  },
  {
    key: 'gemini_upload',
    title: 'Загрузка в Gemini',
    desc: 'Передача аудио в нейросеть Google',
    icon: <Cpu className="w-4 h-4" />,
  },
  {
    key: 'transcribing',
    title: 'Транскрибация',
    desc: 'Распознавание речи и определение таймкодов слов',
    icon: <AudioWaveform className="w-4 h-4" />,
  },
  {
    key: 'processing',
    title: 'Обработка результата',
    desc: 'Формирование строк и выравнивание таймингов',
    icon: <FileCheck className="w-4 h-4" />,
  },
];

export const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({
  progress,
  onRetry,
  onCancel,
}) => {
  const getStepStatus = (stepKey: string, currentStatus: string) => {
    const order = ['idle', 'uploading', 'gemini_upload', 'transcribing', 'processing', 'ready'];
    const stepIdx = order.indexOf(stepKey);
    const currentIdx = order.indexOf(currentStatus);

    if (currentStatus === 'error') {
      if (stepIdx <= currentIdx) return 'failed';
      return 'pending';
    }
    if (currentIdx > stepIdx) return 'completed';
    if (currentIdx === stepIdx) return 'active';
    return 'pending';
  };

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-3xl bg-neutral-900 border border-neutral-800 shadow-2xl p-6 sm:p-8 relative overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 bg-cyan-500/20 blur-2xl rounded-full pointer-events-none" />

        {progress.status !== 'error' ? (
          <div>
            {/* Header */}
            <div className="text-center mb-6">
              <div className="relative inline-flex mb-3">
                <AppIcon className="w-16 h-16" />
                <span className="absolute -right-1 -bottom-1 w-7 h-7 rounded-full bg-neutral-950 border border-cyan-400/50 text-cyan-300 flex items-center justify-center shadow-lg shadow-cyan-500/25">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                </span>
              </div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                {progress.message || 'Синхронизация трека...'}
              </h3>
              <p className="text-xs text-neutral-400 mt-1">
                Gemini 3.5 анализирует аудиоспектр и формирует точные таймкоды
              </p>
            </div>

            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between text-xs text-neutral-400 mb-2 font-mono">
                <span>Прогресс</span>
                <span className="text-cyan-400 font-bold">{progress.percent}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-neutral-800 overflow-hidden border border-neutral-700/50 p-0.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-teal-400 to-indigo-500 transition-all duration-300"
                  style={{ width: `${Math.max(5, progress.percent)}%` }}
                />
              </div>
            </div>

            {/* Steps List */}
            <div className="space-y-3 bg-neutral-950/60 p-4 rounded-2xl border border-neutral-800/80 mb-6">
              {STEPS.map((step) => {
                const status = getStepStatus(step.key, progress.status);
                return (
                  <div
                    key={step.key}
                    className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${
                      status === 'active'
                        ? 'bg-cyan-500/10 border border-cyan-500/30 text-white'
                        : status === 'completed'
                        ? 'text-neutral-300'
                        : 'text-neutral-600'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                        status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : status === 'active'
                          ? 'bg-cyan-500 text-neutral-950 animate-pulse'
                          : 'bg-neutral-800 text-neutral-500'
                      }`}
                    >
                      {status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        step.icon
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{step.title}</span>
                        {status === 'active' && (
                          <span className="text-[10px] uppercase font-mono text-cyan-400 tracking-wider">
                            В процессе...
                          </span>
                        )}
                        {status === 'completed' && (
                          <span className="text-[10px] uppercase font-mono text-emerald-400">
                            Готово
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-500 truncate">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Studio VU animation */}
            <div className="flex items-center justify-center gap-1 h-6">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-cyan-400/60 rounded-full animate-pulse"
                  style={{
                    height: `${20 + Math.sin(i * 0.6) * 60 + Math.random() * 20}%`,
                    animationDuration: `${0.4 + (i % 5) * 0.15}s`,
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          /* Error State */
          <div className="text-center py-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 mb-3 shadow-lg shadow-red-500/10">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white tracking-tight">Ошибка транскрибации</h3>
            <p className="text-xs text-red-300 mt-2 bg-red-950/50 p-3 rounded-xl border border-red-900/50 text-left font-mono break-words">
              {progress.error || 'Не удалось распознать аудио. Пожалуйста, проверьте подключение и повторите попытку.'}
            </p>

            <div className="flex items-center justify-center gap-3 mt-6">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  Попробовать снова
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold border border-neutral-700 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  Назад к настройкам
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
