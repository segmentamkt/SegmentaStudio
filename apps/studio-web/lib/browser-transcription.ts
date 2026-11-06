import type { CaptionCue } from "./caption-cues";

export type SpeechWord = { text: string; startInSeconds: number; endInSeconds: number };
export type SpeechTranscription = { transcript: string; captionCues: CaptionCue[] };

/** Keep each card tied to spoken words instead of stretching a script over the whole clip. */
export function timedCaptionCards(words: SpeechWord[], durationSeconds: number, maxWords = 4): CaptionCue[] {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const count = Math.max(2, Math.min(8, Math.floor(maxWords)));
  const usable = words.filter((word) => Number.isFinite(word.startInSeconds) && Number.isFinite(word.endInSeconds)
    && word.endInSeconds > word.startInSeconds && word.startInSeconds < duration && word.text.trim())
    .sort((a, b) => a.startInSeconds - b.startInSeconds);
  const cards: CaptionCue[] = [];
  let group: SpeechWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const startSeconds = Math.max(0, Math.min(duration, group[0].startInSeconds));
    const endSeconds = Math.min(duration, Math.max(startSeconds + .1, group[group.length - 1].endInSeconds + .08));
    if (endSeconds <= duration && cards.length < 100) {
      cards.push({ startSeconds, endSeconds, text: group.map((word) => word.text.trim()).join(" ").slice(0, 250) });
    }
    group = [];
  };
  for (const word of usable) {
    const last = group[group.length - 1];
    if (last && (group.length >= count || word.startInSeconds - last.endInSeconds > .48
      || word.endInSeconds - group[0].startInSeconds > 2.45)) flush();
    group.push(word);
  }
  flush();
  return cards;
}

export async function transcribeTakeInBrowser(input: {
  takeId: string;
  durationSeconds: number;
  maxWords: number;
  onProgress?: (stage: string) => void;
}): Promise<SpeechTranscription> {
  const { canUseWhisperWebGpu, downloadWhisperModel, resampleTo16Khz, transcribe } = await import("@remotion/whisper-webgpu");
  const support = await canUseWhisperWebGpu();
  if (!support.supported) throw new Error("Este navegador no admite transcripción local con WebGPU. Usa Chrome actualizado o importa un SRT/VTT de esta toma.");
  input.onProgress?.("Preparando el audio de la toma");
  const response = await fetch(`/api/media/${encodeURIComponent(input.takeId)}/audio`, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "No pudimos extraer la voz de esta toma.");
  }
  const wav = new Blob([await response.arrayBuffer()], { type: "audio/wav" });
  const waveform = await resampleTo16Khz({ file: wav });
  const rms = Math.sqrt(waveform.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, waveform.length));
  if (rms < .001) throw new Error("La toma no tiene voz audible para transcribir.");
  input.onProgress?.("Descargando el modelo de voz en este navegador (primera vez: unos 120 MB)");
  await downloadWhisperModel({ model: "tiny" });
  input.onProgress?.("Escuchando la voz y ubicando cada palabra");
  const output = await transcribe({ channelWaveform: waveform, model: "tiny", language: "spanish", task: "transcribe" });
  const captionCues = timedCaptionCards(output.words, input.durationSeconds, input.maxWords);
  if (!captionCues.length) throw new Error("No obtuvimos palabras con tiempos verificables. Revisa el audio o importa un SRT/VTT.");
  const transcript = captionCues.map((cue) => cue.text).join(" ");
  if (transcript.length > 1_000) throw new Error("Esta toma contiene demasiado diálogo para un solo segmento. Divídela en la línea de tiempo antes de sincronizarla.");
  return { transcript, captionCues };
}
