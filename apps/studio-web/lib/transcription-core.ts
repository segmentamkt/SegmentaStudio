import type { CaptionCue } from "./caption-cues";

export type SpeechWord = { text: string; startInSeconds: number; endInSeconds: number };
export type SpeechTranscription = { transcript: string; captionCues: CaptionCue[] };
export type SpeechChunk = { text: string; timestamp: [number | null, number | null] };

/** The audio endpoint returns mono PCM16 at 16 kHz, including optional RIFF metadata chunks. */
export function decodeSpeechWav(buffer: ArrayBuffer): Float32Array {
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
  if (samples > 121 * 16_000) throw new Error("La transcripción admite tomas de hasta 2 minutos.");
  const waveform = new Float32Array(samples);
  let power = 0;
  for (let index = 0; index < samples; index++) {
    const sample = view.getInt16(dataOffset + index * 2, true) / 32768;
    waveform[index] = sample;
    power += sample * sample;
  }
  if (Math.sqrt(power / samples) < .001) throw new Error("La toma no tiene audio audible para transcribir.");
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
  return { transcript: captionCues.map((cue) => cue.text).join(" "), captionCues };
}
