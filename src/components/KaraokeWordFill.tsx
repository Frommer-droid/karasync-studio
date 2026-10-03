import React from 'react';
import { WordTiming } from '../../shared/types';
import { calculateWordProgress } from '../../shared/syncAlgorithm';

interface KaraokeWordFillProps {
  word: WordTiming;
  currentTime: number;
  karaokeColor: string;
  baseColor?: string;
  className?: string;
  onClick?: () => void;
}

/**
 * Switches the whole word to the karaoke color when its start time is reached.
 * Earlier words remain highlighted as the next words begin.
 */
export const KaraokeWordFill: React.FC<KaraokeWordFillProps> = ({
  word,
  currentTime,
  karaokeColor,
  baseColor = '#ffffff',
  className = '',
  onClick,
}) => {
  const isHighlighted = calculateWordProgress(currentTime, word.start, word.end) === 1;

  return (
    <span
      onClick={onClick}
      className={`inline-block select-none whitespace-nowrap ${onClick ? 'cursor-pointer' : ''} ${className}`}
      title={`${word.text} (${word.start.toFixed(2)}s - ${word.end.toFixed(2)}s)`}
      style={{
        color: isHighlighted ? karaokeColor : baseColor,
        textShadow: isHighlighted
          ? `0 0 8px ${karaokeColor}66, 0 2px 4px rgba(0,0,0,0.8)`
          : '0 2px 8px rgba(0, 0, 0, 0.65)',
      }}
    >
      {word.text}
    </span>
  );
};
