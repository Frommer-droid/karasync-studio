/**
 * Покадровый декодер видео-заставки для offline-экспорта.
 * MP4 (mp4box) отдаёт все видеосэмплы клипа один раз (~10 МБ на 10с),
 * дальше WebCodecs VideoDecoder выдаёт нужный кадр по времени:
 * вперёд — докачиваем из очереди, назад (виток цикла) — flush + кормление
 * с ближайшего sync-сэмпла. Одновременно держим максимум 1-2 кадра.
 * Поддерживается только H.264 (avc1/avc3) — остальное отклоняем с понятной ошибкой.
 */
import { createFile, DataStream } from 'mp4box';

interface ClipSample {
  ctsUs: number;
  durUs: number;
  sync: boolean;
  data: Uint8Array;
}

export interface CoverClipDecoder {
  /** Длительность клипа, секунды. */
  duration: number;
  /** Кадр на момент t (секунды клипа). Закрывает вызывающий код. Null — мимо. */
  frameAt(tSec: number): Promise<VideoFrame | null>;
  close(): void;
}

function toUs(ticks: number, timescale: number): number {
  return Math.round((ticks * 1e6) / timescale);
}

/**
 * Сериализует распарсенный avcC-бокс обратно в AVCDecoderConfigurationRecord
 * штатным писателем mp4box (round-trip 1:1, включая расширения High-профиля).
 * Ручная сборка по полям опасна: легко потерять хвостовые байты ext.
 */
export function serializeAvcDescription(avcC: { write: (stream: unknown) => void }): Uint8Array {
  const stream = new DataStream();
  avcC.write(stream);
  const raw = new Uint8Array(
    (stream.buffer as ArrayBuffer).slice(0, stream.getPosition()),
  );
  // Отрезаем заголовок бокса (size + 'avcC'), оставляем payload.
  return raw.slice(8);
}

export interface ParsedCoverClip extends AvcConfig {}

/**
 * Разбирает MP4 (только H.264): кодек, avcC-описание и все видеосэмплы.
 * Без WebCodecs — проверяется в node-тестах на реальном файле.
 */
export async function parseCoverClip(blob: Blob): Promise<ParsedCoverClip> {
  const buf = await blob.arrayBuffer();
  const mp4boxFile = createFile();
  // ВАЖНО: setExtractionOptions + start обязаны вызываться синхронно внутри
  // onReady — отложенный вызов после flush() сэмплы уже не отдаёт.
  const parsed = await new Promise<Omit<AvcConfig, 'clipDuration'>>((resolve, reject) => {
    const collected: ClipSample[] = [];
    let trackFps = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Таймаут чтения MP4'));
      }
    }, 30000);
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    mp4boxFile.onReady = (info) => {
      try {
        const videoTracks = info.videoTracks ?? [];
        const found = videoTracks.find((t) => t.codec?.startsWith('avc1') || t.codec?.startsWith('avc3'))
          ?? videoTracks[0];
        if (!found || !(found.codec?.startsWith('avc1') || found.codec?.startsWith('avc3'))) {
          finish(() => reject(new Error(`Кодек ${found?.codec ?? 'неизвестен'} не поддерживается, нужен H.264 (MP4)`)));
          return;
        }
        const codec = found.codec;
        const timescale = found.timescale;
        const expected = found.nb_samples;
        const codedWidth = found.video?.width ?? 1920;
        const codedHeight = found.video?.height ?? 1080;
        if (found.samples_duration > 0 && found.timescale > 0 && found.nb_samples > 0) {
          trackFps = (found.nb_samples * found.timescale) / found.samples_duration;
        }
        const trak = mp4boxFile.getTrackById(found.id);
        const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0] as unknown as
          | { avcC?: { write: (stream: unknown) => void } }
          | undefined;
        const avcC = entry?.avcC;
        if (!avcC || typeof avcC.write !== 'function') {
          finish(() => reject(new Error('В MP4 нет avcC-описания (битый файл?)')));
          return;
        }
        const description = serializeAvcDescription(avcC);
        mp4boxFile.onSamples = (_id, _user, batch) => {
          for (const s of batch) {
            if (!s.data) continue;
            const bytes = new Uint8Array(s.data.length);
            bytes.set(s.data);
            const scale = s.timescale || timescale;
            collected.push({
              ctsUs: toUs(s.cts, scale),
              durUs: Math.max(1, toUs(s.duration, scale)),
              sync: s.is_sync,
              data: bytes,
            });
          }
          if (collected.length >= (expected || Number.MAX_SAFE_INTEGER)) {
            finish(() => resolve({ codec, description, codedWidth, codedHeight, samples: collected, trackFps }));
          }
        };
        mp4boxFile.setExtractionOptions(found.id, null, { nbSamples: found.nb_samples });
        mp4boxFile.start();
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    };
    mp4boxFile.onError = (_mod, msg) => {
      finish(() => reject(new Error(`Не разобран MP4: ${msg}`)));
    };
    const ab = Object.assign(buf, { fileStart: 0 }) as ArrayBuffer & { fileStart: number };
    mp4boxFile.appendBuffer(ab);
    mp4boxFile.flush();
  });

  if (parsed.samples.length === 0) {
    throw new Error('В видеофайле нет кадров');
  }
  const last = parsed.samples[parsed.samples.length - 1];
  return {
    ...parsed,
    clipDuration: (last.ctsUs + last.durUs) / 1e6,
  };
}

interface AvcConfig {
  codec: string;
  description: Uint8Array;
  codedWidth: number;
  codedHeight: number;
  samples: ClipSample[];
  clipDuration: number;
  /** Средняя частота кадров трека (для предупреждения о несовпадении с fps экспорта). */
  trackFps: number;
}

/**
 * Глубина докачки по cts: кадру нужны референсы, чей cts может быть позже.
 * B-пирамиды глубже ~15 кадров (500мс) на практике не встречаются.
 * Плюс прайминг: декодеру нужен полный reorder-буфер (до 16 кадров в H.264),
 * прежде чем он начнёт отдавать выходы, — первые N сэмплов кормим безусловно.
 * Удержанных будущих кадров держим не больше MAX_KEPT_FUTURES: иначе
 * исчерпывается пул выходов декодера и виснет flush (доказано живым тестом).
 */
const FEED_REF_DEPTH_US = 500000;
const FEED_PRIME_SAMPLES = 16;
const MAX_KEPT_FUTURES = 10;

class DecoderSession implements CoverClipDecoder {
  readonly duration: number;
  private codec: string;
  private description: Uint8Array;
  private codedWidth: number;
  private codedHeight: number;
  private decoder: VideoDecoder | null = null;
  private samples: ClipSample[];
  private queue: VideoFrame[] = [];
  private feedIndex = 0;
  private primeUntil = 0;
  private maxFedCts = -1;
  private fedCount = 0;
  private outputCount = 0;
  private outputWaiter: (() => void) | null = null;
  private tailFlushed = false;
  private lastOutputUs = -1;
  private decodeError: unknown = null;
  private hwMode: 'prefer-hardware' | 'prefer-software' | undefined;

  constructor(
    codec: string,
    description: Uint8Array,
    codedWidth: number,
    codedHeight: number,
    samples: ClipSample[],
    duration: number,
    hwMode?: 'prefer-hardware' | 'prefer-software',
  ) {
    this.codec = codec;
    this.description = description;
    this.codedWidth = codedWidth;
    this.codedHeight = codedHeight;
    this.samples = samples;
    this.duration = duration;
    this.hwMode = hwMode;
    this.decoder = this.createDecoder();
  }

  private createDecoder(): VideoDecoder {
    const decoder = new VideoDecoder({
      output: (frame) => {
        this.queue.push(frame);
        this.outputCount += 1;
        const w = this.outputWaiter;
        this.outputWaiter = null;
        w?.();
      },
      error: (e) => {
        this.decodeError = e;
      },
    });
    decoder.configure({
      codec: this.codec,
      description: this.description,
      codedWidth: this.codedWidth,
      codedHeight: this.codedHeight,
      ...(this.hwMode ? { hardwareAcceleration: this.hwMode } : {}),
    });
    return decoder;
  }

  private get liveDecoder(): VideoDecoder {
    const decoder = this.decoder;
    if (!decoder) {
      throw new Error('Декодер клипа уже закрыт');
    }
    return decoder;
  }

  async frameAt(tSec: number): Promise<VideoFrame | null> {
    if (this.decodeError) throw this.decodeError;
    const targetUs = Math.round(tSec * 1e6);
    // Назад (виток цикла) или первый запрос — откатываемся к ближайшему
    // sync-сэмплу. Последний sync в порядке декодирования с cts <= target
    // (cts немонотонен из-за B-кадров — сканируем все, без break).
    if (targetUs < this.lastOutputUs || this.lastOutputUs < 0) {
      // Новый сегмент (виток цикла / первый запрос): старый декодер
      // закрываем БЕЗ flush — flush после кормления виснет. Свежий декодер
      // стартует с ключевого кадра, held-кадры отданы пулу через drain.
      this.drainQueue();
      try {
        this.decoder?.close();
      } catch {
        // ignore
      }
      this.decoder = this.createDecoder();
      // flush отменяет несъеденное — счётчики лётного заново.
      this.fedCount = 0;
      this.outputCount = 0;
      let start = 0;
      for (let i = 0; i < this.samples.length; i += 1) {
        if (this.samples[i].sync && this.samples[i].ctsUs <= targetUs) start = i;
      }
      // Первым обязан идти ключевой кадр — страхуемся.
      while (start < this.samples.length && !this.samples[start].sync) {
        start += 1;
      }
      if (start >= this.samples.length) {
        throw new Error('В клипе нет ключевого кадра для старта декодирования');
      }
      this.feedIndex = start;
      this.maxFedCts = -1;
      this.primeUntil = Math.min(this.samples.length, start + FEED_PRIME_SAMPLES);
      this.tailFlushed = false;
      this.lastOutputUs = -1;
    }
    // Докачиваем вперёд с запасом на референсы B-кадров (их cts позже цели).
    // trailing flush НЕ делаем: после него декодер требует ключевой кадр.
    const feedMore = (): boolean => {
      if (this.feedIndex >= this.samples.length) return false;
      const priming = this.feedIndex < this.primeUntil;
      if (!priming && this.feedIndex > 0 && this.maxFedCts >= targetUs + FEED_REF_DEPTH_US) return false;
      const s = this.samples[this.feedIndex];
      this.feedIndex += 1;
      this.liveDecoder.decode(
        new EncodedVideoChunk({
          type: s.sync ? 'key' : 'delta',
          timestamp: s.ctsUs,
          duration: s.durUs,
          data: s.data,
        }),
      );
      this.fedCount += 1;
      if (s.ctsUs > this.maxFedCts) this.maxFedCts = s.ctsUs;
      return true;
    };
    // Первый кадр с cts >= target (допуск пол-кадра назад); старое закрываем,
    // будущее оставляем в очереди следующим запросам, но не больше
    // MAX_KEPT_FUTURES: удержанные выходы исчерпывают пул декодера.
    // Недодержанное докормится гейтом при следующих запросах.
    // Fallback: свежий прошлый кадр (до 100мс) лучше дырки на стыке витка.
    const pickBest = (): VideoFrame | null => {
      const eps = 20000;
      const staleLimit = 100000;
      let best: VideoFrame | null = null;
      let newestOld: VideoFrame | null = null;
      const kept: VideoFrame[] = [];
      const closeFrame = (f: VideoFrame) => {
        try {
          f.close();
        } catch {
          // ignore
        }
      };
      for (const f of this.queue) {
        if (f.timestamp >= targetUs - eps) {
          if (!best) {
            best = f;
            continue;
          }
        } else if (!newestOld || f.timestamp > newestOld.timestamp) {
          if (newestOld) closeFrame(newestOld);
          newestOld = f;
          continue;
        }
        if (best && kept.length < MAX_KEPT_FUTURES) {
          kept.push(f);
        } else {
          closeFrame(f);
        }
      }
      if (!best && newestOld && targetUs - newestOld.timestamp <= staleLimit) {
        best = newestOld;
      } else if (newestOld && newestOld !== best) {
        closeFrame(newestOld);
      }
      this.queue = kept;
      return best;
    };
    // ВАЖНО: будильник регистрируем ДО скана и кормления — выходы декодера
    // могут приходить синхронно внутри decode(), иначе проспим событие.
    const eps = 20000;
    const deadline = performance.now() + 10000;
    for (;;) {
      if (this.decodeError) throw this.decodeError;
      let wakePromise: Promise<void> | null = null;
      const armWaiter = () => {
        wakePromise = new Promise<void>((resolve) => {
          this.outputWaiter = resolve;
        });
        return wakePromise;
      };
      const disarmWaiter = () => {
        this.outputWaiter = null;
      };
      // Регистрируем ДО скана и кормления: выходы декодера могут приходить
      // синхронно внутри decode(), иначе проспим событие.
      armWaiter();
      const found = pickBest();
      if (found) {
        disarmWaiter();
        this.lastOutputUs = found.timestamp;
        return found;
      }
      // Нужного кадра нет: либо ещё летит, либо данные кончились.
      // Хвост клипа: всё скормлено, а кадры сидят в reorder-буфере декодера —
      // выталкиваем их разовым flush с таймаутом (виснущий flush не должен
      // вешать экспорт: дальше только хвост, вернём null).
      if (this.feedIndex >= this.samples.length && !this.tailFlushed) {
        this.tailFlushed = true;
        try {
          await Promise.race([
            this.liveDecoder.flush(),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('__cover_flush_timeout__')), 3000);
            }),
          ]);
        } catch (e) {
          if (e instanceof Error && e.message === '__cover_flush_timeout__') {
            return null;
          }
          throw e;
        }
        continue;
      }
      // Кормим агрессивно, пока гейт разрешает: декодеру нужен полный
      // reorder-буфер, иначе он молчит (проверено: 2 сэмпла недостаточно).
      let fedAny = false;
      while (feedMore()) fedAny = true;
      // Повторный скан: синхронные выходы уже могли прилететь.
      const synced = pickBest();
      if (synced) {
        disarmWaiter();
        this.lastOutputUs = synced.timestamp;
        return synced;
      }
      const inFlight = this.fedCount - this.outputCount;
      if (inFlight === 0 && !fedAny) {
        disarmWaiter();
        return null; // всё скормлено и получено — дальше только хвост клипа
      }
      // Ждём именно выхода кадров, а не тика таймера: под нагрузкой
      // setTimeout срабатывает медленно и душил скорость экспорта.
      const waitMs = deadline - performance.now();
      if (waitMs <= 0) {
        disarmWaiter();
        throw new Error(`Таймаут ожидания кадра клипа (${tSec.toFixed(2)}с)`);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          wakePromise as Promise<void>,
          new Promise<void>((_, reject) => {
            timer = setTimeout(() => reject(new Error('__cover_wait_timeout__')), waitMs);
          }),
        ]);
      } catch (e) {
        disarmWaiter();
        if (e instanceof Error && e.message === '__cover_wait_timeout__') {
          throw new Error(`Таймаут ожидания кадра клипа (${tSec.toFixed(2)}с)`);
        }
        throw e;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  }

  private drainQueue(): void {
    for (const f of this.queue) {
      try {
        f.close();
      } catch {
        // ignore
      }
    }
    this.queue = [];
  }

  close(): void {
    this.drainQueue();
    try {
      this.decoder?.close();
    } catch {
      // ignore
    }
    this.decoder = null;
  }
}

/**
 * Проверяет конфигурацию декодера до configure(): пробует hardware,
 * затем software. Возвращает рабочий режим или кидает ошибку с параметрами
 * клипа — чтобы было видно, что именно не поддерживается.
 */
async function pickDecoderMode(
  codec: string,
  codedWidth: number,
  codedHeight: number,
): Promise<'prefer-hardware' | 'prefer-software' | undefined> {
  if (typeof VideoDecoder.isConfigSupported !== 'function') {
    return undefined;
  }
  const label = `${codec}, ${codedWidth}x${codedHeight}`;
  const modes: Array<'prefer-hardware' | 'prefer-software' | undefined> = [
    'prefer-hardware',
    'prefer-software',
    undefined,
  ];
  for (const mode of modes) {
    try {
      const res = await VideoDecoder.isConfigSupported({
        codec,
        codedWidth,
        codedHeight,
        ...(mode ? { hardwareAcceleration: mode } : {}),
      });
      if (res.supported) return mode;
    } catch {
      // ignore — пробуем следующий режим
    }
  }
  throw new Error(`Декодер не поддерживает клип (${label})`);
}

/** Открывает декодер клипа. Кидает понятную ошибку, если клип не разобрать. */
export async function openCoverClipDecoder(blob: Blob, durationHint?: number): Promise<DecoderSession> {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') {
    throw new Error('WebCodecs VideoDecoder недоступен в этом браузере');
  }
  const cfg = await parseCoverClip(blob);
  const duration = durationHint && durationHint > 0 ? durationHint : cfg.clipDuration;
  const hwMode = await pickDecoderMode(cfg.codec, cfg.codedWidth, cfg.codedHeight);
  try {
    return new DecoderSession(
      cfg.codec, cfg.description, cfg.codedWidth, cfg.codedHeight, cfg.samples, duration, hwMode,
    );
  } catch (e) {
    throw new Error(
      `Декодер отклонил клип (${cfg.codec}, ${cfg.codedWidth}x${cfg.codedHeight}): ${e instanceof Error ? e.message : e}`,
    );
  }
}
