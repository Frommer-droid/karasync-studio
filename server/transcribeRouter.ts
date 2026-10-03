import { Router, Request, Response } from 'express';
import { transcribeAudioWithGemini } from './geminiService';
import { groupWordsIntoLines, alignReferenceWithGemini, mergeStandaloneDashTokens } from '../shared/syncAlgorithm';
import { TranscriptionRequest } from '../shared/types';

const router = Router();

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Karaoke Sync Studio API',
    model: 'gemini-3.5-transcribe',
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// Audio transcription endpoint
router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const {
      audioBase64,
      mimeType,
      fileName,
      isVocalTrackUsed,
      lyricsPrompt,
      language,
      useReferenceLyrics,
      apiKey,
    }: TranscriptionRequest = req.body;

    if (!audioBase64) {
      return res.status(400).json({
        error: 'Аудиофайл не передан. Пожалуйста, выберите файл песни.',
      });
    }

    // Log audio received
    const approxBytes = Math.round((audioBase64.length * 3) / 4);
    console.log(
      `[Server] Файл успешно принят (${isVocalTrackUsed ? 'Чистый вокал' : 'Основной трек'}): "${fileName || 'audio'}" (${mimeType || 'audio/mp3'}, ~${(approxBytes / (1024 * 1024)).toFixed(2)} MB)`
    );

    // Call Gemini 3.5 Transcribe service
    const geminiResult = await transcribeAudioWithGemini({
      audioBase64,
      mimeType: mimeType || 'audio/mp3',
      fileName,
      language,
      lyricsPrompt,
      apiKey,
    });

    // Reference Lyrics Alignment:
    // If lyricsPrompt exists and useReferenceLyrics is true (or default true when lyrics are present)
    const hasReference = Boolean(lyricsPrompt && lyricsPrompt.trim().length > 0);
    const shouldAlignWithReference = hasReference && (useReferenceLyrics !== false);

    const words = mergeStandaloneDashTokens(geminiResult.words);

    if (shouldAlignWithReference) {
      console.log('[Server] Выполняется Sequence Alignment с эталонным текстом песни...');
      const alignment = alignReferenceWithGemini(lyricsPrompt!.trim(), words);

      console.log(
        `[Server] Alignment завершён: ${alignment.stats.exactMatches} точных, ${alignment.stats.approxMatches} примерных, ${alignment.stats.interpolated} интерполировано.`
      );

      return res.json({
        transcript: geminiResult.transcript,
        words: alignment.alignedWords,
        lines: alignment.alignedLines,
        fullText: lyricsPrompt!.trim(),
        detectedLanguage: geminiResult.detectedLanguage,
        alignmentStats: alignment.stats,
        isAlignedWithReference: true,
      });
    }

    // Standard grouping without reference text
    const lines = groupWordsIntoLines(words);

    return res.json({
      transcript: geminiResult.transcript,
      words,
      lines,
      fullText: geminiResult.transcript,
      detectedLanguage: geminiResult.detectedLanguage,
      isAlignedWithReference: false,
    });
  } catch (error: any) {
    console.error('[Server] Ошибка транскрибации:', error?.message || error);
    return res.status(500).json({
      error: error?.message || 'Произошла ошибка при транскрибации аудиофайла.',
    });
  }
});

export default router;
