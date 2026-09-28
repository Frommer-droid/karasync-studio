/**
 * Utility to optimize large audio files (e.g. uncompressed WAV/FLAC > 15MB)
 * into compact, high-clarity 16kHz/24kHz mono WAV for Gemini Transcribe API.
 * 
 * Note: The original full-fidelity audio file is always kept in memory
 * for playback, karaoke preview, and video rendering.
 */

function encodeWav(audioBuffer: AudioBuffer, targetSampleRate: number = 16000): Blob {
  const numChannels = 1; // Mono for speech transcription
  const channelData = audioBuffer.getChannelData(0);
  
  // Resample if needed
  const ratio = audioBuffer.sampleRate / targetSampleRate;
  const targetLength = Math.round(channelData.length / ratio);
  const resampledData = new Float32Array(targetLength);
  
  for (let i = 0; i < targetLength; i++) {
    const srcIndex = Math.min(Math.floor(i * ratio), channelData.length - 1);
    resampledData[i] = channelData[srcIndex];
  }
  
  // Convert Float32 to Int16 PCM
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = targetSampleRate * blockAlign;
  const dataSize = resampledData.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  
  // Helper to write string to DataView
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  
  // fmt subchunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, targetSampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)
  
  // data subchunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write PCM audio samples
  let offset = 44;
  for (let i = 0; i < resampledData.length; i++) {
    const s = Math.max(-1, Math.min(1, resampledData[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Optimizes an audio file for speech/vocal transcription if it exceeds threshold.
 * Returns either the original file or a lightweight optimized WAV Blob with its mimeType.
 */
export async function prepareAudioForTranscription(
  file: File,
  sizeThresholdBytes: number = 15 * 1024 * 1024 // 15 MB
): Promise<{ blob: Blob; mimeType: string; fileName: string; isOptimized: boolean }> {
  // If file is already compact (e.g. MP3/M4A < 15MB), send directly
  if (file.size <= sizeThresholdBytes) {
    return {
      blob: file,
      mimeType: file.type || 'audio/mp3',
      fileName: file.name,
      isOptimized: false,
    };
  }

  try {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) {
      return {
        blob: file,
        mimeType: file.type || 'audio/mp3',
        fileName: file.name,
        isOptimized: false,
      };
    }

    const audioCtx = new AudioCtxClass();
    const arrayBuffer = await file.arrayBuffer();
    const decodedAudio = await audioCtx.decodeAudioData(arrayBuffer);
    
    // Encode to 16kHz mono WAV (ideal for ASR transcription, ~1.9 MB per minute)
    const optimizedWavBlob = encodeWav(decodedAudio, 16000);
    
    // Close context
    if (audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    return {
      blob: optimizedWavBlob,
      mimeType: 'audio/wav',
      fileName: `${baseName}_optimized.wav`,
      isOptimized: true,
    };
  } catch (err) {
    console.warn('Could not optimize audio in browser, falling back to original file:', err);
    return {
      blob: file,
      mimeType: file.type || 'audio/mp3',
      fileName: file.name,
      isOptimized: false,
    };
  }
}
