import React, { useState } from 'react';
import { LineTiming, WordTiming } from '../../shared/types';
import {
  generateStandardLRC,
  generateEnhancedLRC,
  generateSRT,
  generateWebVTT,
  generateJSONExport,
  downloadFile,
} from '../../shared/exportUtils';
import { X, Download, Copy, Check, FileText, Code2 } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: LineTiming[];
  words: WordTiming[];
  audioFileName: string;
  audioDuration: number;
}

type ExportType = 'lrc' | 'enhanced_lrc' | 'srt' | 'vtt' | 'json';

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  lines,
  words,
  audioFileName,
  audioDuration,
}) => {
  const [selectedType, setSelectedType] = useState<ExportType>('enhanced_lrc');
  const [copied, setCopied] = useState<boolean>(false);

  if (!isOpen) return null;

  const trackTitle = audioFileName.replace(/\.[^/.]+$/, '') || 'Karaoke_Track';

  const getContent = (type: ExportType): { content: string; filename: string; mime: string } => {
    switch (type) {
      case 'lrc':
        return {
          content: generateStandardLRC(lines, trackTitle),
          filename: `${trackTitle}.lrc`,
          mime: 'text/plain;charset=utf-8',
        };
      case 'enhanced_lrc':
        return {
          content: generateEnhancedLRC(lines, trackTitle),
          filename: `${trackTitle}_word_sync.lrc`,
          mime: 'text/plain;charset=utf-8',
        };
      case 'srt':
        return {
          content: generateSRT(lines),
          filename: `${trackTitle}.srt`,
          mime: 'text/plain;charset=utf-8',
        };
      case 'vtt':
        return {
          content: generateWebVTT(lines),
          filename: `${trackTitle}.vtt`,
          mime: 'text/vtt;charset=utf-8',
        };
      case 'json':
        return {
          content: generateJSONExport({
            title: trackTitle,
            duration: audioDuration,
            words,
            lines,
          }),
          filename: `${trackTitle}_sync_data.json`,
          mime: 'application/json;charset=utf-8',
        };
    }
  };

  const { content, filename, mime } = getContent(selectedType);

  const handleDownload = () => {
    downloadFile(content, filename, mime);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formats: { type: ExportType; title: string; desc: string }[] = [
    {
      type: 'enhanced_lrc',
      title: 'Enhanced LRC (Слово за словом)',
      desc: 'Посекундные таймкоды для каждого отдельного слова караоке',
    },
    {
      type: 'lrc',
      title: 'Standard LRC (Построчно)',
      desc: 'Классический формат караоке для медиаплееров и плееров авто',
    },
    {
      type: 'srt',
      title: 'SRT Субтитры',
      desc: 'Для видеоредакторов (Premiere, DaVinci, Final Cut, CapCut)',
    },
    {
      type: 'vtt',
      title: 'WebVTT (.vtt)',
      desc: 'Для веб-плееров, HTML5 видео и онлайн сервисов',
    },
    {
      type: 'json',
      title: 'JSON проект',
      desc: 'Полные сырые данные слов и строк со всеми таймингами',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
              <Download className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-white">Экспорт караоке и таймкодов</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-control p-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Закрыть окно экспорта"
            aria-label="Закрыть окно экспорта"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Format Selector Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {formats.map((f) => (
              <button
                key={f.type}
                type="button"
                onClick={() => setSelectedType(f.type)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  selectedType === f.type
                    ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/30'
                    : 'border-neutral-800 bg-neutral-950/40 hover:bg-neutral-800/40 text-neutral-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white">{f.title}</span>
                  {selectedType === f.type && (
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  )}
                </div>
                <p className="text-[11px] text-neutral-400 leading-tight">{f.desc}</p>
              </button>
            ))}
          </div>

          {/* Preview code block */}
          <div>
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-1.5 font-mono">
              <span>Предпросмотр: <strong className="text-neutral-200">{filename}</strong></span>
              <span>{content.split('\n').length} строк</span>
            </div>
            <pre className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-xs font-mono text-cyan-300/90 overflow-x-auto max-h-52 select-all whitespace-pre-wrap break-all">
              {content}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-800 text-neutral-200 text-xs font-semibold flex items-center gap-2 border border-neutral-700 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">Скопировано!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Скопировать</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Скачать файл</span>
          </button>
        </div>
      </div>
    </div>
  );
};
