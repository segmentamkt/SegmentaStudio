"use client";

import {
  decodeSpeechWav, MAX_SPEECH_AUDIO_BYTES, mergeSpeechWindowWords, planSpeechWindows,
  sourceWordsForWindow, SpeechAudioError, SPEECH_SAMPLE_RATE, timedCaptionCards,
  type SpeechRange, type SpeechTranscription, type SpeechWord,
} from "./transcription-core";
import type { SpeechWorkerMessage, SpeechWorkerRequest } from "./transcription.worker";

export { timedCaptionCards } from "./transcription-core";
export type { SpeechWord, SpeechTranscription, SpeechRange } from "./transcription-core";

let speechWorker: Worker | null = null;
let transcriptionActive = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
// Only small timestamped text results are cached, never PCM buffers or video.
const windowCache = new Map<string, SpeechWord[]>();
const MAX_CACHED_WINDOWS = 48;
const MAX_CACHED_WORDS = 30_000;

export function clearSpeechTranscriptionCache() {
  windowCache.clear();
  if (!transcriptionActive) releaseWorker();
}

function cacheWords(key: string, words: SpeechWord[]) {
  windowCache.delete(key);
  windowCache.set(key, words);
  let count = [...windowCache.values()].reduce((total, value) => total + value.length, 0);
  while (windowCache.size > MAX_CACHED_WINDOWS || count > MAX_CACHED_WORDS) {
    const oldest = windowCache.keys().next().value;
    if (oldest === undefined) break;
    count -= windowCache.get(oldest)!.length;
    windowCache.delete(oldest);
  }
}

async function readSpeechAudio(response: Response, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (Number(response.headers.get("content-length") || 0) > MAX_SPEECH_AUDIO_BYTES) throw new Error("El fragmento de audio es demasiado grande. Intenta generar los subtítulos por tramos.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No recibimos el audio de este tramo. Inténtalo de nuevo.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SPEECH_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error("El fragmento de audio es demasiado grande. Intenta generar los subtítulos por tramos.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result.buffer;
}

function releaseWorker() {
  speechWorker?.terminate();
  speechWorker = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function abortError() { return new DOMException("Transcripción cancelada.", "AbortError"); }

function recognize(input: { waveform: Float32Array; durationSeconds: number; maxWords: number; signal?: AbortSignal; onProgress?: (stage: string, percent?: number) => void }): Promise<SpeechTranscription> {
  if (input.signal?.aborted) return Promise.reject(abortError());
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!speechWorker) {
    const created = new Worker(new URL("./transcription.worker.ts", import.meta.url), { type: "module" });
    speechWorker = created;
  }
  const worker = speechWorker;
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", message);
      worker.removeEventListener("error", failed);
      worker.removeEventListener("messageerror", failed);
      input.signal?.removeEventListener("abort", aborted);
      clearTimeout(timeout);
    };
    const failed = () => { cleanup(); releaseWorker(); reject(new Error("No pudimos iniciar el reconocimiento de voz. Actualiza la página e inténtalo de nuevo.")); };
    const aborted = () => { cleanup(); releaseWorker(); reject(abortError()); };
    const message = (event: MessageEvent<SpeechWorkerMessage>) => {
      if (event.data.id !== id) return;
      if (event.data.type === "progress") { input.onProgress?.(event.data.stage, event.data.percent); return; }
      cleanup();
      if (event.data.type === "error") {
        if (event.data.code === "no-speech") {
          idleTimer = setTimeout(releaseWorker, 120_000);
          reject(new SpeechAudioError(event.data.error, "silent"));
        } else { releaseWorker(); reject(new Error(event.data.error)); }
      }
      else {
        // Keep the loaded model for the next take in a batch, then release its memory.
        idleTimer = setTimeout(releaseWorker, 120_000);
        resolve(event.data.result);
      }
    };
    const timeout = setTimeout(() => { cleanup(); releaseWorker(); reject(new Error("El reconocimiento tardó demasiado en este dispositivo. Intenta procesar una toma a la vez.")); }, 15 * 60_000);
    worker.addEventListener("message", message);
    worker.addEventListener("error", failed);
    worker.addEventListener("messageerror", failed);
    input.signal?.addEventListener("abort", aborted, { once: true });
    const request: SpeechWorkerRequest = { id, waveform: input.waveform, durationSeconds: input.durationSeconds, maxWords: input.maxWords };
    try { worker.postMessage(request, [input.waveform.buffer]); }
    catch { failed(); }
  });
}

/** Download only a model; recognition runs in a worker on this device without an API key. */
export async function transcribeTakeInBrowser(input: {
  takeId: string;
  durationSeconds: number;
  /** Absolute source intervals. Omit only to transcribe the complete source. */
  ranges?: SpeechRange[];
  maxWords: number;
  signal?: AbortSignal;
  onProgress?: (stage: string, percent?: number) => void;
}): Promise<SpeechTranscription> {
  if (input.signal?.aborted) throw abortError();
  if (transcriptionActive) throw new Error("Ya hay una transcripción en curso. Espera a que termine o cancélala.");
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") throw new Error("Este navegador no admite el reconocimiento local. Usa un navegador actualizado o importa SRT/VTT.");
  const windows = planSpeechWindows(input.ranges, input.durationSeconds);
  transcriptionActive = true;
  try {
    const words: SpeechWord[] = [];
    for (const [index, window] of windows.entries()) {
      input.signal?.throwIfAborted();
      const prefix = windows.length > 1 ? `Tramo ${index + 1} de ${windows.length} · ` : "";
      const key = JSON.stringify([input.takeId, window.startSeconds, window.endSeconds]);
      let recognized = windowCache.get(key);
      if (recognized) {
        // Touch LRU order without copying audio or repeating inference after a retry.
        windowCache.delete(key); windowCache.set(key, recognized);
        input.onProgress?.(`${prefix}Recuperando palabras ya reconocidas`, Math.round(index / windows.length * 100));
      } else {
        input.onProgress?.(`${prefix}Preparando el audio de este recorte`, Math.round(index / windows.length * 100));
        const params = new URLSearchParams({ startSeconds: String(window.startSeconds), endSeconds: String(window.endSeconds) });
        const response = await fetch(`/api/media/${encodeURIComponent(input.takeId)}/audio?${params}`, { cache: "no-store", signal: input.signal });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(`${prefix}${payload.error || "No pudimos extraer la voz de este tramo."}`);
        }
        try {
          const waveform = decodeSpeechWav(await readSpeechAudio(response, input.signal));
          input.signal?.throwIfAborted();
          const result = await recognize({ waveform, durationSeconds: Math.min(window.endSeconds - window.startSeconds, waveform.length / SPEECH_SAMPLE_RATE), maxWords: input.maxWords, signal: input.signal,
            onProgress: (stage, percent) => input.onProgress?.(`${prefix}${stage}`, percent === undefined ? undefined : Math.round((index + percent / 100) / windows.length * 100)),
          });
          // Old worker bundles can still return timestamped cards after a deploy;
          // preserving them is safer than discarding already recognized text.
          recognized = result.words ?? result.captionCues.map((cue) => ({ text: cue.text, startInSeconds: cue.startSeconds, endInSeconds: cue.endSeconds }));
        } catch (error) {
          if (error instanceof SpeechAudioError && error.code === "silent") recognized = [];
          else throw error;
        }
        cacheWords(key, recognized);
      }
      words.push(...sourceWordsForWindow(recognized, window));
      input.onProgress?.(`${prefix}Palabras sincronizadas`, Math.round((index + 1) / windows.length * 100));
    }
    input.signal?.throwIfAborted();
    const sourceWords = mergeSpeechWindowWords(words);
    const captionCues = timedCaptionCards(sourceWords, input.durationSeconds, input.maxWords);
    if (!captionCues.length) throw new Error("No reconocimos voz con tiempos en los recortes seleccionados. Revisa el audio o importa SRT/VTT.");
    return { transcript: captionCues.map((cue) => cue.text).join(" "), captionCues, words: sourceWords, maxWords: input.maxWords };
  } finally {
    transcriptionActive = false;
    if (input.signal?.aborted) releaseWorker();
  }
}
