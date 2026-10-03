import React from 'react';
import {
  Sparkles,
  Captions,
  Clapperboard,
  FilePlus2,
  Layers,
  Save,
  FolderOpen,
  Camera,
  LayoutGrid,
  Move,
  Sliders,
} from 'lucide-react';
import { AppIcon } from './AppIcon';

type SettingsPanel = 'text' | 'layout' | 'position';

interface HeaderProps {
  hasData: boolean;
  onReset: () => void;
  onOpenExport: () => void;
  onOpenVideoExport?: () => void;
  onSavePreset?: () => void;
  onLoadPreset?: () => void;
  onCaptureSnapshot: () => void;
  activeSettingsPanel: SettingsPanel | null;
  onToggleSettingsPanel: (panel: SettingsPanel) => void;
  fileName?: string;
  isAlignedWithReference?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  hasData,
  onReset,
  onOpenExport,
  onOpenVideoExport,
  onSavePreset,
  onLoadPreset,
  onCaptureSnapshot,
  activeSettingsPanel,
  onToggleSettingsPanel,
  fileName,
  isAlignedWithReference,
}) => {
  return (
    <header className="border-b border-neutral-800/80 bg-neutral-900/90 backdrop-blur-md sticky top-0 z-30 px-4 lg:px-8 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <AppIcon className="w-11 h-11" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Karaoke Sync Studio
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Sparkles className="w-3 h-3" aria-hidden="true" />
                Gemini 3.5 AI
              </span>
              {isAlignedWithReference && (
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-medium uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  <Layers className="w-2.5 h-2.5" aria-hidden="true" />
                  Reference Aligned
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 font-normal">
              {fileName ? `Трек: ${fileName}` : 'Автоматическое распознавание вокала и посекундная синхронизация'}
            </p>
          </div>
        </div>

        {/* Right action controls */}
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {hasData && (
            <>
              <div className="flex items-center gap-1 rounded-lg border border-neutral-700/50 bg-neutral-800/60 p-1" role="group" aria-label="Настройки предпросмотра">
                <button
                  id="btn-preview-snapshot-header"
                  type="button"
                  onClick={onCaptureSnapshot}
                  className="grid h-8 w-8 place-items-center rounded-md text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
                  title="Сохранить снимок кадра Full HD (PNG)"
                  aria-label="Сохранить снимок кадра Full HD"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  id="btn-preview-layout-header"
                  type="button"
                  onClick={() => onToggleSettingsPanel('layout')}
                  className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${activeSettingsPanel === 'layout' ? 'bg-cyan-500/20 text-cyan-300' : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'}`}
                  title="Настройки титульной шапки и фона"
                  aria-label="Настройки титульной шапки и фона"
                  aria-pressed={activeSettingsPanel === 'layout'}
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  id="btn-preview-position-header"
                  type="button"
                  onClick={() => onToggleSettingsPanel('position')}
                  className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${activeSettingsPanel === 'position' ? 'bg-cyan-500/20 text-cyan-300' : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'}`}
                  title="Настройки передвижения и размера"
                  aria-label="Настройки передвижения и размера"
                  aria-pressed={activeSettingsPanel === 'position'}
                >
                  <Move className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  id="btn-preview-text-header"
                  type="button"
                  onClick={() => onToggleSettingsPanel('text')}
                  className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${activeSettingsPanel === 'text' ? 'bg-cyan-500/20 text-cyan-300' : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'}`}
                  title="Настройки строк и шрифтов"
                  aria-label="Настройки строк и шрифтов"
                  aria-pressed={activeSettingsPanel === 'text'}
                >
                  <Sliders className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {onSavePreset && onLoadPreset && (
                <div className="flex items-center gap-1.5" role="group" aria-label="Пресеты оформления">
                  <button
                    id="btn-save-preset-header"
                    type="button"
                    onClick={onSavePreset}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
                    title="Сохранить пресет оформления"
                    aria-label="Сохранить пресет оформления"
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    id="btn-load-preset-header"
                    type="button"
                    onClick={onLoadPreset}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
                    title="Загрузить пресет оформления"
                    aria-label="Загрузить пресет оформления"
                  >
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}

              {onOpenVideoExport && (
                <button
                  id="btn-create-video-header"
                  onClick={onOpenVideoExport}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all duration-150 cursor-pointer"
                  title="Создать караоке-видео Full HD (MP4/WebM)"
                >
                  <Clapperboard className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Создать видео</span>
                </button>
              )}

              <button
                id="btn-export-karaoke"
                onClick={onOpenExport}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-800 text-neutral-200 hover:text-white border border-neutral-700 text-xs font-semibold shadow-sm transition-all duration-150 cursor-pointer"
                title="Экспортировать караоке (LRC, SRT, VTT, JSON)"
              >
                <Captions className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                <span>Субтитры</span>
              </button>

              <button
                id="btn-reset-project"
                onClick={onReset}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-800 text-neutral-300 hover:text-white text-xs font-medium border border-neutral-700/60 transition-colors cursor-pointer"
                title="Сбросить и загрузить новый трек"
              >
                <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Новый трек</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
