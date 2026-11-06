"use client";

import { decodeSpeechWav, type SpeechTranscription } from "./transcription-core";
import type { SpeechWorkerMessage, SpeechWorkerRequest } from "./transcription.worker";

export { timedCaptionCards } from "./transcription-core";
export type { SpeechWord, SpeechTranscription } from "./transcription-core";

let speechWorker: Worker | null = null;
let transcriptionActive = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

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
      if (event.data.type === "error") { releaseWorker(); reject(new Error(event.data.error)); }
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
  maxWords: number;
  signal?: AbortSignal;
  onProgress?: (stage: string, percent?: number) => void;
}): Promise<SpeechTranscription> {
  if (input.signal?.aborted) throw abortError();
  if (transcriptionActive) throw new Error("Ya hay una transcripción en curso. Espera a que termine o cancélala.");
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") throw new Error("Este navegador no admite el reconocimiento local. Usa un navegador actualizado o importa SRT/VTT.");
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 120) throw new Error("La transcripción admite tomas de hasta 2 minutos.");
  transcriptionActive = true;
  try {
    input.onProgress?.("Preparando el audio de la toma");
    const response = await fetch(`/api/media/${encodeURIComponent(input.takeId)}/audio`, { cache: "no-store", signal: input.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || "No pudimos extraer la voz de esta toma.");
    }
    const waveform = decodeSpeechWav(await response.arrayBuffer());
    input.signal?.throwIfAborted();
    return await recognize({ waveform, durationSeconds: Math.min(input.durationSeconds, waveform.length / 16_000), maxWords: input.maxWords, signal: input.signal, onProgress: input.onProgress });
  } finally { transcriptionActive = false; }
}
