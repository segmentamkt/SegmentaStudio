import type { CaptionCue } from "./caption-cues";

export type SpeechWord = { text: string; startInSeconds: number; endInSeconds: number };
export type SpeechTranscription = { transcript: string; captionCues: CaptionCue[]; words?: SpeechWord[]; maxWords?: number };
export type SpeechChunk = { text: string; timestamp: [number | null, number | null] };
export type SpeechRange = { startSeconds: number; endSeconds: number };
export type SpeechWindow = SpeechRange & {
  ownedStartSeconds: number;
  ownedEndSeconds: number;
  rangeStartSeconds: number;
  rangeEndSeconds: number;
};

export const SPEECH_SAMPLE_RATE = 16_000;
export const MAX_SPEECH_AUDIO_BYTES = 4_500_000;
export const MAX_SPEECH_WINDOW_SECONDS = 120;
const SPEECH_WINDOW_SECONDS = 90;
const SPEECH_CONTEXT_SECONDS = 1;
const MAX_TRANSCRIPTION_SECONDS = 60 * 60;

export class SpeechAudioError extends Error {
  constructor(message: string, public readonly code: "silent") { super(message); this.name = "SpeechAudioError"; }
}

/** Union only the source intervals selected in the montage, not the whole source. */
export function normalizeSpeechRanges(ranges: SpeechRange[] | undefined, durationSeconds: number): SpeechRange[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("No conocemos la duración real de esta toma. Vuelve a cargar sus datos antes de generar subtítulos.");
  const selected = ranges ?? [{ startSeconds: 0, endSeconds: durationSeconds }];
  if (selected.length > 100) throw new Error("Hay demasiados recortes para una transcripción. Procesa una selección más pequeña.");
  const sorted = selected.map((range) => {
    if (!Number.isFinite(range.startSeconds) || !Number.isFinite(range.endSeconds) || range.startSeconds < 0 || range.endSeconds <= range.startSeconds || range.startSeconds >= durationSeconds) {
      throw new Error("El intervalo de subtítulos no es válido. Revisa el inicio y final del recorte.");
    }
    return { startSeconds: range.startSeconds, endSeconds: Math.min(durationSeconds, range.endSeconds) };
  }).sort((left, right) => left.startSeconds - right.startSeconds);
  const merged: SpeechRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.startSeconds <= previous.endSeconds) previous.endSeconds = Math.max(previous.endSeconds, range.endSeconds);
    else merged.push({ ...range });
  }
  return merged;
}

/** Every request stays under 120 s; one second of context protects cut words. */
export function planSpeechWindows(ranges: SpeechRange[] | undefined, durationSeconds: number): SpeechWindow[] {
  const selected = normalizeSpeechRanges(ranges, durationSeconds);
  if (!selected.length) throw new Error("Selecciona al menos un intervalo para generar sus subtítulos.");
  if (selected.reduce((seconds, range) => seconds + range.endSeconds - range.startSeconds, 0) > MAX_TRANSCRIPTION_SECONDS) {
    throw new Error("Esta selección supera una hora de voz. Genera los subtítulos por recortes de hasta una hora para cuidar la memoria del dispositivo.");
  }
  const windows: SpeechWindow[] = [];
  for (const range of selected) {
    for (let start = range.startSeconds; start < range.endSeconds; start += SPEECH_WINDOW_SECONDS) {
      const end = Math.min(range.endSeconds, start + SPEECH_WINDOW_SECONDS);
      windows.push({
        startSeconds: Math.max(0, start - SPEECH_CONTEXT_SECONDS),
        endSeconds: Math.min(durationSeconds, end + SPEECH_CONTEXT_SECONDS),
        ownedStartSeconds: start, ownedEndSeconds: end,
        rangeStartSeconds: range.startSeconds, rangeEndSeconds: range.endSeconds,
      });
    }
  }
  return windows;
}

/** Map local word timestamps back to the source and give seam words one owner. */
export function sourceWordsForWindow(words: SpeechWord[], window: SpeechWindow): SpeechWord[] {
  return words.flatMap((word) => {
    if (!Number.isFinite(word.startInSeconds) || !Number.isFinite(word.endInSeconds) || word.endInSeconds < word.startInSeconds || !word.text.trim()) return [];
    const start = window.startSeconds + word.startInSeconds;
    const end = window.startSeconds + word.endInSeconds;
    const midpoint = (start + end) / 2;
    const owns = midpoint >= window.ownedStartSeconds && midpoint < window.ownedEndSeconds;
    const crossesFirstEdge = window.ownedStartSeconds === window.rangeStartSeconds && start < window.rangeStartSeconds && end > window.rangeStartSeconds;
    const crossesLastEdge = window.ownedEndSeconds === window.rangeEndSeconds && start < window.rangeEndSeconds && end > window.rangeEndSeconds;
    if ((!owns && !crossesFirstEdge && !crossesLastEdge) || end <= window.rangeStartSeconds || start >= window.rangeEndSeconds) return [];
    return [{ text: word.text.trim(), startInSeconds: Math.max(window.rangeStartSeconds, start), endInSeconds: Math.min(window.rangeEndSeconds, end) }];
  });
}

export function mergeSpeechWindowWords(words: SpeechWord[]): SpeechWord[] {
  const merged: SpeechWord[] = [];
  const normalize = (text: string) => text.toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, "");
  for (const word of [...words].sort((left, right) => left.startInSeconds - right.startInSeconds)) {
    const previous = merged.at(-1);
    const overlap = previous ? Math.min(previous.endInSeconds, word.endInSeconds) - Math.max(previous.startInSeconds, word.startInSeconds) : 0;
    if (previous && normalize(previous.text) && normalize(previous.text) === normalize(word.text)
      && Math.abs(previous.startInSeconds - word.startInSeconds) < .25
      && overlap > Math.min(previous.endInSeconds - previous.startInSeconds, word.endInSeconds - word.startInSeconds) * .5) {
      previous.endInSeconds = Math.max(previous.endInSeconds, word.endInSeconds);
    } else merged.push({ ...word });
  }
  return merged;
}

/** The audio endpoint returns mono PCM16 at 16 kHz, including optional RIFF metadata chunks. */
export function decodeSpeechWav(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength > MAX_SPEECH_AUDIO_BYTES) throw new Error("El fragmento de audio es demasiado grande. Vuelve a generar los subtítulos por tramos.");
  const view = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (view.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("El audio recibido no es un WAV válido.");
  let validFormat = false;
  let dataOffset = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > view.byteLength) throw new Error("El audio llegó incompleto. Intenta generar los subtítulos de nuevo.");
    if (tag(offset) === "fmt ") {
      validFormat = size >= 16 && view.getUint16(start, true) === 1 && view.getUint16(start + 2, true) === 1
        && view.getUint32(start + 4, true) === 16_000 && view.getUint16(start + 14, true) === 16;
    }
    if (tag(offset) === "data") { dataOffset = start; dataSize = size; }
    offset = start + size + (size % 2);
  }
  if (!validFormat || !dataOffset || !dataSize || dataSize % 2) throw new Error("No pudimos preparar el formato de la voz de esta toma.");
  const samples = dataSize / 2;
  if (samples > MAX_SPEECH_WINDOW_SECONDS * SPEECH_SAMPLE_RATE) throw new Error("El fragmento de audio supera el límite de memoria. Vuelve a generar los subtítulos por tramos.");
  const waveform = new Float32Array(samples);
  let power = 0;
  for (let index = 0; index < samples; index++) {
    const sample = view.getInt16(dataOffset + index * 2, true) / 32768;
    waveform[index] = sample;
    power += sample * sample;
  }
  if (Math.sqrt(power / samples) < .001) throw new SpeechAudioError("Este tramo no tiene audio audible para transcribir.", "silent");
  return waveform;
}

/** Keep cards on recognized word timestamps; do not spread a supplied script over the clip. */
export function timedCaptionCards(words: SpeechWord[], durationSeconds: number, maxWords = 4): CaptionCue[] {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (duration < .1) return [];
  const count = Math.max(2, Math.min(8, Math.floor(maxWords) || 4));
  const usable = words.filter((word) => Number.isFinite(word.startInSeconds) && Number.isFinite(word.endInSeconds)
    && word.endInSeconds >= word.startInSeconds && word.startInSeconds < duration && word.text.trim())
    .sort((a, b) => a.startInSeconds - b.startInSeconds);
  const cards: CaptionCue[] = [];
  let group: SpeechWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const startSeconds = Math.max(0, Math.min(duration - .101, group[0].startInSeconds));
    const endSeconds = Math.min(duration, Math.max(startSeconds + .101, group[group.length - 1].endInSeconds + .08));
    cards.push({ startSeconds, endSeconds, text: group.map((word) => word.text.trim()).join(" ") });
    group = [];
  };
  for (const word of usable) {
    const last = group[group.length - 1];
    if (last && (group.length >= count || word.startInSeconds - last.endInSeconds > .48
      || word.endInSeconds - group[0].startInSeconds > 2.45)) flush();
    group.push(word);
  }
  flush();
  // Trim padding at the next onset; merge very close onsets instead of silently losing words.
  const aligned: CaptionCue[] = [];
  for (const cue of cards) {
    const previous = aligned.at(-1);
    if (previous && cue.startSeconds - previous.startSeconds < .101) {
      previous.text += ` ${cue.text}`;
      previous.endSeconds = Math.max(previous.endSeconds, cue.endSeconds);
    } else {
      if (previous) previous.endSeconds = Math.min(previous.endSeconds, cue.startSeconds);
      aligned.push({ ...cue });
    }
  }
  return aligned;
}

export function transcriptionFromChunks(chunks: SpeechChunk[], durationSeconds: number, maxWords: number): SpeechTranscription {
  const starts = chunks.map((chunk) => chunk.timestamp[0]);
  if (!chunks.length || starts.some((start) => start === null || !Number.isFinite(start))) {
    throw new Error("No reconocimos palabras con tiempos. Revisa que se escuche la voz e inténtalo de nuevo.");
  }
  const words = chunks.map((chunk, index) => {
    const start = Math.max(0, starts[index]!);
    const nextStart = starts[index + 1];
    const fallbackEnd = nextStart !== undefined && nextStart !== null && nextStart >= start ? nextStart : durationSeconds;
    const modelEnd = chunk.timestamp[1];
    return { text: chunk.text, startInSeconds: start,
      endInSeconds: Math.min(durationSeconds, modelEnd !== null && Number.isFinite(modelEnd) && modelEnd >= start ? modelEnd : fallbackEnd) };
  });
  const captionCues = timedCaptionCards(words, durationSeconds, maxWords);
  if (!captionCues.length) throw new Error("No reconocimos voz con tiempos válidos. Revisa el audio o importa un SRT/VTT.");
  return { transcript: captionCues.map((cue) => cue.text).join(" "), captionCues, words, maxWords };
}
