import { TranscriptionRequest, TranscriptionResponse } from '../../shared/types';

/**
 * Converts a browser Blob or File object to Base64 string
 */
export async function fileToBase64(file: Blob | File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip Data URI prefix (e.g. "data:audio/mp3;base64,")
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * Calls server endpoint to transcribe audio with Gemini
 */
export async function requestTranscription(
  requestData: TranscriptionRequest
): Promise<TranscriptionResponse> {
  let response: Response;
  try {
    response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
  } catch (netErr: any) {
    throw new Error(
      `Сетевая ошибка при отправке аудио на сервер: ${netErr?.message || 'Сервер недоступен'}.`
    );
  }

  if (!response.ok) {
    let errorMessage = `Ошибка сервера (${response.status})`;
    if (response.status === 413) {
      errorMessage =
        'Файл слишком большой для отправки на сервер (413 Payload Too Large). Пожалуйста, выберите сжатый аудиофайл (MP3/M4A/OGG) или более короткий фрагмент.';
    }
    try {
      const errJson = await response.json();
      if (errJson.error) {
        errorMessage = errJson.error;
      }
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(errorMessage);
  }

  return response.json();
}
