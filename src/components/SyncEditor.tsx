import React, { useLayoutEffect, useRef, useState } from 'react';
import { WordTiming, LineTiming } from '../../shared/types';
import { formatTimeMs } from '../../shared/syncAlgorithm';
import { Play, Search, AlertTriangle } from 'lucide-react';

interface SyncEditorProps {
  words: WordTiming[];
  lines: LineTiming[];
  activeWord: WordTiming | null;
  activeLine: LineTiming | null;
  isPlaying: boolean;
  selectedWordId: string | null;
  onSeek: (seconds: number) => void;
  onSelectWord: (word: WordTiming | null) => void;
}

export const SyncEditor: React.FC<SyncEditorProps> = ({
  words,
  lines,
  activeWord,
  activeLine,
  isPlaying,
  selectedWordId,
  onSeek,
  onSelectWord,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'tokens' | 'lines'>('lines');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  const query = searchQuery.trim().toLocaleLowerCase();
  const filteredWords = query ? words.filter((word) => word.text.toLocaleLowerCase().includes(query)) : words;
  const matchingWordIds = new Set(filteredWords.map((word) => word.id));
  const followedItemId = viewMode === 'lines' ? activeLine?.id : activeWord?.id;

  useLayoutEffect(() => {
    if (!isPlaying || query || !followedItemId) return;

    const container = scrollContainerRef.current;
    const activeItem = activeItemRef.current;
    if (!container || !activeItem) return;

    const top = container.scrollTop
      + activeItem.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      - container.clientTop;
    container.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }, [isPlaying, viewMode, followedItemId, query]);

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
      {/* Words and Lines Display Container */}
      <div className="space-y-3">
        {/* View Mode switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-400">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-neutral-800">
              <button
                type="button"
                onClick={() => setViewMode('lines')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                  viewMode === 'lines' ? 'bg-neutral-800 text-cyan-400' : 'text-neutral-400 hover:text-white'
                }`}
              >
                По строкам
              </button>
              <button
                type="button"
                onClick={() => setViewMode('tokens')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                  viewMode === 'tokens' ? 'bg-neutral-800 text-cyan-400' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Сплошной поток слов
              </button>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              id="search-sync-words-input"
              type="search"
              aria-label="Поиск слова"
              placeholder="Поиск слова..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 py-2.5 pl-9 pr-3 text-sm text-neutral-200 placeholder-neutral-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        {filteredWords.length === 0 && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-8 text-center text-sm text-neutral-400">
            По запросу «{searchQuery.trim()}» слова не найдены.
          </div>
        )}

        {/* View: By Lines */}
        {viewMode === 'lines' && filteredWords.length > 0 && (
          <div ref={scrollContainerRef} className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {lines.map((line, lIdx) => {
              const visibleWords = query ? line.words.filter((word) => matchingWordIds.has(word.id)) : line.words;
              if (visibleWords.length === 0) return null;
              const isLineActive = activeLine?.id === line.id;

              return (
                <div
                  key={line.id}
                  id={`editor-line-${lIdx}`}
                  ref={isLineActive ? activeItemRef : null}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isLineActive
                      ? 'bg-neutral-950 border-cyan-500/60 ring-1 ring-cyan-500/30'
                      : 'bg-neutral-950/60 border-neutral-800/80 hover:border-neutral-700'
                  }`}
                >
                  {/* Line info */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1.5 border-b border-neutral-800/60 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-neutral-400 font-semibold text-[11px]">
                        Строка #{lIdx + 1}
                      </span>
                      <span className="font-mono text-cyan-400 text-[11px]">
                        {formatTimeMs(line.start)} - {formatTimeMs(line.end)}
                      </span>
                    </div>

                  </div>

                  {/* Words in Line */}
                  <div className="flex flex-wrap items-center gap-2">
                    {visibleWords.map((word) => {
                      const isActive = activeWord?.id === word.id;
                      const isSelected = selectedWordId === word.id;
                      const isInterpolated = word.timingSource === 'interpolated';
                      const isLowConf =
                        word.isLowConfidence ||
                        isInterpolated ||
                        (word.confidence !== undefined && word.confidence < 0.6);

                      return (
                        <div
                          key={word.id}
                          id={`word-token-${word.id}`}
                          onClick={() => {
                            onSeek(word.start);
                            onSelectWord(word);
                          }}
                          className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl cursor-pointer transition-all duration-150 border select-none ${
                            isSelected
                              ? 'bg-indigo-900/90 text-white font-bold border-indigo-400 ring-2 ring-indigo-400/40'
                              : isActive
                              ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-extrabold border-cyan-300 shadow-lg shadow-cyan-500/40 scale-105 ring-2 ring-white/50 z-10'
                              : isLowConf
                              ? 'bg-amber-950/40 hover:bg-amber-950/70 text-amber-200 border-amber-500/40 hover:border-amber-400'
                              : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border-neutral-800 hover:border-neutral-700'
                          }`}
                          title={`Клик: выбрать слово (${formatTimeMs(word.start)} - ${formatTimeMs(word.end)}) и перейти к его началу`}
                        >
                          {isSelected && <span className="text-[10px] font-bold text-white bg-indigo-600 rounded px-1.5 py-0.5">Выбрано</span>}
                          {isActive && !isSelected && <Play className="w-3 h-3 fill-current text-white animate-pulse" />}
                          {isLowConf && !isActive && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}

                          <span className="text-sm font-medium tracking-wide">{word.text}</span>

                          <span
                            className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                              isActive ? 'bg-black/40 text-white font-bold' : 'bg-neutral-800 text-neutral-400'
                            }`}
                          >
                            {formatTimeMs(word.start)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* View: Flat Tokens Flow */}
        {viewMode === 'tokens' && filteredWords.length > 0 && (
          <div ref={scrollContainerRef} className="max-h-[380px] overflow-y-auto p-3 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-wrap gap-2 items-center">
            {filteredWords.map((word) => {
              const isActive = activeWord?.id === word.id;
              const isSelected = selectedWordId === word.id;
              const isInterpolated = word.timingSource === 'interpolated';
              const isLowConf =
                word.isLowConfidence ||
                isInterpolated ||
                (word.confidence !== undefined && word.confidence < 0.6);

              return (
                <div
                  key={word.id}
                  ref={isActive ? activeItemRef : null}
                  onClick={() => {
                    onSeek(word.start);
                    onSelectWord(word);
                  }}
                  className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl cursor-pointer transition-all duration-150 border select-none ${
                    isSelected
                      ? 'bg-indigo-900/90 text-white font-bold border-indigo-400 ring-2 ring-indigo-400/40'
                      : isActive
                      ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-extrabold border-cyan-300 shadow-lg shadow-cyan-500/40 scale-105 ring-2 ring-white/50 z-10'
                      : isLowConf
                      ? 'bg-amber-950/40 hover:bg-amber-950/70 text-amber-200 border-amber-500/40'
                      : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border-neutral-800'
                  }`}
                  title={`${word.text} [${formatTimeMs(word.start)} - ${formatTimeMs(word.end)}] • Клик: выбрать и перейти к началу слова`}
                >
                  {isSelected && <span className="text-[10px] font-bold text-white bg-indigo-600 rounded px-1.5 py-0.5">Выбрано</span>}
                  {isActive && !isSelected && <Play className="w-3 h-3 fill-current text-white animate-pulse" />}
                  {isLowConf && !isActive && <AlertTriangle className="w-3 h-3 text-amber-400" />}

                  <span className="text-sm font-medium">{word.text}</span>

                  <span
                    className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                      isActive ? 'bg-black/40 text-white font-bold' : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {formatTimeMs(word.start)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
