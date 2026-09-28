import React, { useState, useEffect, useRef, useCallback, RefObject } from 'react';

export interface UseAudioPlayerReturn {
  audioRef: RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  waveformPeaks: number[];
  isAudioLoading: boolean;
  audioBuffer: AudioBuffer | null;
  audioUrl: string | null;
  audioFile: File | Blob | null;
  loopRange: { start: number; end: number; label?: string } | null;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  seekAndPlay: (seconds: number) => Promise<void>;
  playRange: (start: number, end: number | null, rewindOnEnd?: boolean) => Promise<void>;
  setLoopRange: (range: { start: number; end: number; label?: string } | null) => void;
  toggleLoopRange: (range: { start: number; end: number; label?: string }) => void;
  clearLoop: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  loadAudioFile: (file: File) => Promise<string>;
  loadAudioUrl: (url: string) => void;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(0.9);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRateState] = useState<number>(1);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | Blob | null>(null);
  const [loopRange, setLoopRangeState] = useState<{ start: number; end: number; label?: string } | null>(null);

  const loopRangeRef = useRef<{ start: number; end: number; label?: string } | null>(null);
  loopRangeRef.current = loopRange;

  const playUntilRef = useRef<{ start: number; end: number | null; rewindOnEnd: boolean } | null>(null);
  const animationFrameId = useRef<number | null>(null);

  const setLoopRange = useCallback((range: { start: number; end: number; label?: string } | null) => {
    setLoopRangeState(range);
    loopRangeRef.current = range;
  }, []);

  const clearLoop = useCallback(() => {
    setLoopRange(null);
  }, [setLoopRange]);

  const toggleLoopRange = useCallback((range: { start: number; end: number; label?: string }) => {
    if (
      loopRangeRef.current &&
      Math.abs(loopRangeRef.current.start - range.start) < 0.05 &&
      Math.abs(loopRangeRef.current.end - range.end) < 0.05
    ) {
      setLoopRange(null);
    } else {
      setLoopRange(range);
      if (audioRef.current) {
        audioRef.current.currentTime = range.start;
        setCurrentTime(range.start);
        audioRef.current.play().catch(() => {});
      }
    }
  }, [setLoopRange]);

  // High-precision time updater using requestAnimationFrame during playback
  const updatePlaybackTime = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      const cur = audio.currentTime;
      setCurrentTime(cur);

      // Check loop range
      if (loopRangeRef.current) {
        if (cur >= loopRangeRef.current.end) {
          audio.currentTime = loopRangeRef.current.start;
          setCurrentTime(loopRangeRef.current.start);
        }
      } else if (playUntilRef.current && playUntilRef.current.end !== null) {
        // Single range play stop
        if (cur >= playUntilRef.current.end) {
          const range = playUntilRef.current;
          playUntilRef.current = null;
          audio.pause();
          if (range.rewindOnEnd) {
            audio.currentTime = range.start;
            setCurrentTime(range.start);
          }
          setIsPlaying(false);
          return;
        }
      }

      animationFrameId.current = requestAnimationFrame(updatePlaybackTime);
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      setIsPlaying(true);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = requestAnimationFrame(updatePlaybackTime);
    };

    const handlePause = () => {
      setIsPlaying(false);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    };

    const handleEnded = () => {
      const range = playUntilRef.current;
      playUntilRef.current = null;
      if (range?.rewindOnEnd && audioRef.current) {
        audioRef.current.currentTime = range.start;
        setCurrentTime(range.start);
      }
      setIsPlaying(false);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };

    const handleTimeUpdate = () => {
      if (audioRef.current && audioRef.current.paused) {
        setCurrentTime(audioRef.current.currentTime);
      }
    };

    const handleLoadedMetadata = () => {
      if (audioRef.current && !isNaN(audioRef.current.duration) && audioRef.current.duration > 0) {
        setDuration(audioRef.current.duration);
      }
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleLoadedMetadata);
    audio.addEventListener('canplay', handleLoadedMetadata);
    audio.addEventListener('loadeddata', handleLoadedMetadata);

    if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleLoadedMetadata);
      audio.removeEventListener('canplay', handleLoadedMetadata);
      audio.removeEventListener('loadeddata', handleLoadedMetadata);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [updatePlaybackTime]);

  const play = useCallback(async () => {
    if (audioRef.current) {
      try {
        await audioRef.current.play();
      } catch (err) {
        console.warn('Playback error:', err);
      }
    }
  }, []);

  const pause = useCallback(() => {
    if (audioRef.current) {
      playUntilRef.current = null;
      audioRef.current.pause();
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      play();
    } else {
      pause();
    }
  }, [play, pause]);

  const seek = useCallback((seconds: number) => {
    if (audioRef.current) {
      playUntilRef.current = null;
      const clamped = Math.max(0, Math.min(seconds, audioRef.current.duration || 0));
      audioRef.current.currentTime = clamped;
      setCurrentTime(clamped);
    }
  }, []);

  const seekAndPlay = useCallback(async (seconds: number) => {
    if (audioRef.current) {
      playUntilRef.current = null;
      const clamped = Math.max(0, Math.min(seconds, audioRef.current.duration || 0));
      audioRef.current.currentTime = clamped;
      setCurrentTime(clamped);
      try {
        await audioRef.current.play();
      } catch (err) {
        console.warn('Playback error on seekAndPlay:', err);
      }
    }
  }, []);

  const playRange = useCallback(async (start: number, end: number | null, rewindOnEnd = false) => {
    if (audioRef.current) {
      const validStart = Math.max(0, start);
      const validEnd = end === null ? null : Math.max(validStart + 0.05, end);
      playUntilRef.current = { start: validStart, end: validEnd, rewindOnEnd };
      audioRef.current.currentTime = validStart;
      setCurrentTime(validStart);
      try {
        await audioRef.current.play();
      } catch (err) {
        playUntilRef.current = null;
        console.warn('Playback range error:', err);
      }
    }
  }, []);

  const setVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
      if (clamped > 0 && isMuted) {
        setIsMuted(false);
        audioRef.current.muted = false;
      }
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      const next = !isMuted;
      setIsMuted(next);
      audioRef.current.muted = next;
    }
  }, [isMuted]);

  const setPlaybackRate = useCallback((rate: number) => {
    const validRate = Math.max(0.25, Math.min(2.0, rate));
    setPlaybackRateState(validRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = validRate;
    }
  }, []);

  // Compute waveform peaks from audio buffer
  const computeWaveform = useCallback((buffer: AudioBuffer, samplesCount: number = 300) => {
    const rawData = buffer.getChannelData(0);
    const blockSize = Math.floor(rawData.length / samplesCount);
    const peaks: number[] = [];

    for (let i = 0; i < samplesCount; i++) {
      const blockStart = blockSize * i;
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[blockStart + j]);
      }
      peaks.push(sum / blockSize);
    }

    // Normalize peaks to 0..1
    const maxVal = Math.max(...peaks, 0.001);
    const normalized = peaks.map(p => Math.min(1, Math.max(0.08, p / maxVal)));
    setWaveformPeaks(normalized);
  }, []);

  const loadAudioFile = useCallback(async (file: File): Promise<string> => {
    setIsAudioLoading(true);
    setAudioFile(file);
    const blobUrl = URL.createObjectURL(file);
    setAudioUrl(blobUrl);

    try {
      // Decode audio for waveform visualization
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        setAudioBuffer(decodedBuffer);
        if (decodedBuffer.duration && decodedBuffer.duration > 0) {
          setDuration(decodedBuffer.duration);
        }
        computeWaveform(decodedBuffer, 300);
        audioCtx.close();
      }
    } catch (e) {
      console.warn('Could not decode audio data for waveform:', e);
      const fallbackPeaks = Array.from({ length: 200 }, () => 0.15 + Math.random() * 0.7);
      setWaveformPeaks(fallbackPeaks);
    } finally {
      setIsAudioLoading(false);
    }

    if (audioRef.current) {
      audioRef.current.src = blobUrl;
      audioRef.current.load();
    }

    return blobUrl;
  }, [computeWaveform]);

  const loadAudioUrl = useCallback((url: string) => {
    setAudioUrl(url);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.load();
    }
  }, []);

  return {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    playbackRate,
    waveformPeaks,
    isAudioLoading,
    audioBuffer,
    audioUrl,
    audioFile,
    loopRange,
    play,
    pause,
    togglePlay,
    seek,
    seekAndPlay,
    playRange,
    setLoopRange,
    toggleLoopRange,
    clearLoop,
    setVolume,
    toggleMute,
    setPlaybackRate,
    loadAudioFile,
    loadAudioUrl,
  };
}
