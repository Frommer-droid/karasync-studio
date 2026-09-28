import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WordTiming, SupportedLanguage } from '../shared/types';

/**
 * Lazy initialization of GoogleGenAI SDK on server-side.
 * Ключ из запроса имеет приоритет над серверным GEMINI_API_KEY —
 * так ключ, введённый в интерфейсе, работает без правки .env.
 */
let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | null = null;

/** Чистая функция выбора ключа (покрыта тестами). */
export function resolveApiKey(requestKey?: string, envKey?: string): string {
  const fromRequest = (requestKey || '').trim();
  if (fromRequest) return fromRequest;
  return (envKey || '').trim();
}

function getGenAI(requestApiKey?: string): GoogleGenAI {
  const apiKey = resolveApiKey(requestApiKey, process.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY не настроен на сервере. Пожалуйста, укажите валидный API ключ Google AI Studio в настройках.'
    );
  }
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedKey = apiKey;
  }
  return cachedClient;
}

export interface TranscribeAudioParams {
  audioBase64: string;
  mimeType: string;
  fileName?: string;
  language?: SupportedLanguage;
  lyricsPrompt?: string;
  apiKey?: string;
}

export interface GeminiTranscribeResult {
  transcript: string;
  words: WordTiming[];
  detectedLanguage?: string;
}

/**
 * Parses time offset into seconds (number with 2 decimal places).
 * Handles string formats like "12.350s", "12.35s", numbers 12.35, or Protobuf Duration objects { seconds, nanos }.
 */
export function parseOffsetToSeconds(offset: any): number {
  if (typeof offset === 'number') {
    return isNaN(offset) ? 0 : parseFloat(offset.toFixed(2));
  }
  if (typeof offset === 'string') {
    const cleaned = offset.trim().replace(/s$/i, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : parseFloat(num.toFixed(2));
  }
  if (offset && typeof offset === 'object') {
    const seconds = parseFloat(offset.seconds ?? 0) || 0;
    const nanos = (parseFloat(offset.nanos ?? 0) || 0) / 1e9;
    return parseFloat((seconds + nanos).toFixed(2));
  }
  return 0;
}

/**
 * Recursively scans model interaction response for annotations where annotation.type === "word_info"
 */
function extractWordInfoAnnotations(data: any): Array<{ text: string; start_offset: any; end_offset: any }> {
  const result: Array<{ text: string; start_offset: any; end_offset: any }> = [];

  const visit = (item: any) => {
    if (!item || typeof item !== 'object') return;

    // Check if item itself is an annotation with type === "word_info"
    const isWordInfo =
      item.type === 'word_info' ||
      item.type === 'WORD_INFO' ||
      Boolean(item.word_info);

    if (isWordInfo) {
      const info = item.word_info || item;
      const text = String(info.text || info.word || item.text || item.word || '').trim();
      const start_offset = info.start_offset ?? info.startOffset ?? item.start_offset ?? item.startOffset;
      const end_offset = info.end_offset ?? info.endOffset ?? item.end_offset ?? item.endOffset;

      if (text) {
        result.push({ text, start_offset, end_offset });
      }
      return;
    }

    // Traverse arrays and nested objects
    if (Array.isArray(item)) {
      for (const elem of item) {
        visit(elem);
      }
    } else {
      if (Array.isArray(item.annotations)) {
        for (const ann of item.annotations) {
          visit(ann);
        }
      }
      if (Array.isArray(item.steps)) {
        for (const step of item.steps) {
          visit(step);
        }
      }
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          visit(c);
        }
      }
      if (Array.isArray(item.candidates)) {
        for (const cand of item.candidates) {
          visit(cand);
        }
      }
    }
  };

  visit(data);
  return result;
}

/**
 * Extracts transcript text from interaction response
 */
function extractTranscriptText(interaction: any): string {
  if (interaction.output_text) {
    return String(interaction.output_text).trim();
  }
  if (typeof interaction.text === 'string') {
    return interaction.text.trim();
  }

  let textParts: string[] = [];
  if (Array.isArray(interaction.steps)) {
    for (const step of interaction.steps) {
      if (step.type === 'model_output' || step.type === 'transcript') {
        if (Array.isArray(step.content)) {
          for (const c of step.content) {
            if (c && typeof c.text === 'string') {
              textParts.push(c.text);
            }
          }
        }
      }
    }
  }

  return textParts.join(' ').trim();
}

/**
 * Transcribes audio file using Gemini 3.5 Transcribe with verbatim mode and word-level timestamps.
 */
export async function transcribeAudioWithGemini(
  params: TranscribeAudioParams
): Promise<GeminiTranscribeResult> {
  const ai = getGenAI(params.apiKey);
  const { audioBase64, mimeType = 'audio/mp3', language = 'auto' } = params;

  // Determine language codes according to rules:
  // ru -> ["ru-RU"], en -> ["en-US"], auto -> []
  const languageCodes: string[] =
    language === 'ru'
      ? ['ru-RU']
      : language === 'en'
      ? ['en-US']
      : [];

  // Write temporary file for Files API upload
  const fileExt = mimeType.includes('/') ? mimeType.split('/')[1].replace('mpeg', 'mp3') : 'mp3';
  const tempFilePath = path.join(
    os.tmpdir(),
    `karaoke-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
  );

  let uploadedFileUri: string | null = null;

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    await fs.promises.writeFile(tempFilePath, audioBuffer);

    // 2. Upload audio file through Gemini Files API
    console.log('[Server] Upload Gemini начался');
    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: {
        mimeType: mimeType || 'audio/mp3',
      },
    });
    uploadedFileUri = uploadResult.uri;
    console.log(`[Server] Upload Gemini завершён (URI: ${uploadedFileUri || uploadResult.name})`);

    // 3. Run interaction with gemini-3.5-transcribe
    console.log('[Server] Transcription началась...');

    const interactionParams = {
      model: 'gemini-3.5-transcribe',
      input: [
        {
          type: 'audio',
          uri: uploadResult.uri,
          mime_type: mimeType || 'audio/mp3',
        },
      ],
      generation_config: {
        transcription_config: {
          language_codes: languageCodes,
          mode: {
            type: 'verbatim',
            timestamp_granularities: ['word'],
          },
        },
      },
    };

    const interaction: any = await (ai as any).interactions.create(interactionParams);

    // 4. Extract word_info annotations
    const rawWordInfos = extractWordInfoAnnotations(interaction);
    console.log('[Server] Количество полученных word_info:', rawWordInfos.length);

    // 5. Diagnostic error if no word_info is returned
    if (rawWordInfos.length === 0) {
      throw new Error(
        'Диагностическая ошибка: Модель не вернула временные метки слов (word_info отсутствуют в ответе gemini-3.5-transcribe). Проверьте качество звука, наличие слышимого вокала в треке или выберите другой фрагмент.'
      );
    }

    // 6. Map to structured word objects with parsed numerical seconds (e.g. 12.35)
    const words: WordTiming[] = rawWordInfos.map((item, index) => {
      const start = parseOffsetToSeconds(item.start_offset);
      const end = parseOffsetToSeconds(item.end_offset);

      return {
        id: `w-${index}-${start.toFixed(2)}`,
        text: item.text,
        start,
        end: end > start ? end : parseFloat((start + 0.3).toFixed(2)),
      };
    });

    let transcript = extractTranscriptText(interaction);
    if (!transcript) {
      transcript = words.map(w => w.text).join(' ');
    }

    console.log('[Server] Transcription завершена.');

    return {
      transcript,
      words,
      detectedLanguage: languageCodes.length > 0 ? languageCodes[0] : 'auto',
    };
  } finally {
    // Clean up local temp file
    try {
      if (fs.existsSync(tempFilePath)) {
        await fs.promises.unlink(tempFilePath);
      }
    } catch {
      // Ignore file deletion error
    }
  }
}
