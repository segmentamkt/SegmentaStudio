import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

export const MAX_SPEECH_WINDOW_SECONDS = 120;
export const MAX_SPEECH_WAV_BYTES = MAX_SPEECH_WINDOW_SECONDS * 16_000 * 2 + 65_536;
export type SpeechAudioWindow = { startSeconds: number; endSeconds: number };

export class SpeechAudioError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 422) { super(message); }
}

/** Source duration is a hint, never a reason to reject an explicit bounded trim. */
export function speechAudioWindow(search: URLSearchParams, durationMs: unknown): SpeechAudioWindow {
  const hasStart = search.has("startSeconds"), hasEnd = search.has("endSeconds");
  if (!hasStart && !hasEnd) {
    const hint = Number(durationMs) / 1_000;
    return { startSeconds: 0, endSeconds: Number.isFinite(hint) && hint > 0 ? Math.min(hint, MAX_SPEECH_WINDOW_SECONDS) : MAX_SPEECH_WINDOW_SECONDS };
  }
  if (!hasStart || !hasEnd || search.getAll("startSeconds").length !== 1 || search.getAll("endSeconds").length !== 1
      || !search.get("startSeconds")!.trim() || !search.get("endSeconds")!.trim()) {
    throw new SpeechAudioError("Indica el inicio y el final del fragmento de voz.", "invalid_audio_window", 400);
  }
  const startSeconds = Number(search.get("startSeconds")), endSeconds = Number(search.get("endSeconds"));
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds
      || endSeconds > Number.MAX_SAFE_INTEGER / 1_000 || endSeconds - startSeconds > MAX_SPEECH_WINDOW_SECONDS + 1e-8) {
    throw new SpeechAudioError("Cada fragmento de voz debe tener un intervalo válido de hasta 120 segundos.", "invalid_audio_window", 400);
  }
  return { startSeconds, endSeconds };
}

export function sourceDurationFromDiagnostic(line: string): number | null {
  const match = line.match(/^(?: {2})?Duration:\s*(\d{2,}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

/** Read PCM chunk length, not a potentially stale upload duration or RIFF header size. */
export function speechWavDuration(buffer: Uint8Array): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tag = (offset: number) => String.fromCharCode(...buffer.subarray(offset, offset + 4));
  if (buffer.length < 44 || buffer.length > MAX_SPEECH_WAV_BYTES || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new SpeechAudioError("El audio de este fragmento no se pudo preparar.", "invalid_speech_audio");
  }
  let valid = false, dataBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > buffer.length) throw new SpeechAudioError("El audio del fragmento quedó incompleto.", "invalid_speech_audio");
    if (tag(offset) === "fmt ") valid = size >= 16 && view.getUint16(start, true) === 1 && view.getUint16(start + 2, true) === 1
      && view.getUint32(start + 4, true) === 16_000 && view.getUint16(start + 14, true) === 16;
    if (tag(offset) === "data") dataBytes += size;
    offset = start + size + (size % 2);
  }
  if (!valid || dataBytes % 2) throw new SpeechAudioError("No pudimos preparar el formato de la voz.", "invalid_speech_audio");
  if (!dataBytes) throw new SpeechAudioError("El intervalo elegido no contiene audio. Revisa el recorte de esta toma.", "empty_audio_window");
  const duration = dataBytes / (16_000 * 2);
  if (duration > MAX_SPEECH_WINDOW_SECONDS + .001) throw new SpeechAudioError("El fragmento de voz supera el tamaño permitido.", "invalid_speech_audio");
  return duration;
}

export function shouldRepairSourceDuration(currentDurationMs: unknown, sourceDurationSeconds: number | null): boolean {
  const current = Number(currentDurationMs);
  return (!Number.isFinite(current) || current <= 0) && sourceDurationSeconds !== null
    && Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds > 0;
}

/** FFmpeg seeks before decoding, so a short late trim does not decode the full video. */
export async function extractSpeechWindow(command: string, source: string, target: string, window: SpeechAudioWindow) {
  // Reuse public validation even for non-HTTP callers.
  speechAudioWindow(new URLSearchParams({ startSeconds: String(window.startSeconds), endSeconds: String(window.endSeconds) }), 0);
  const duration = Math.min(MAX_SPEECH_WINDOW_SECONDS, window.endSeconds - window.startSeconds);
  const child = spawn(command, [
    "-y", "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", "-threads", "1",
    "-ss", String(window.startSeconds), "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", String(duration),
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", target,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let diagnostic = "", pending = "";
  let sourceDurationSeconds: number | null = null;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (part: string) => {
    diagnostic = (diagnostic + part).slice(-4_000);
    pending += part;
    const lines = pending.split(/[\r\n]/);
    pending = lines.pop()!.slice(-4_000);
    for (const line of lines) sourceDurationSeconds ??= sourceDurationFromDiagnostic(line);
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 45_000);
  try {
    let code: number;
    try { code = await new Promise<number>((resolve, reject) => { child.on("error", reject); child.on("close", (value) => resolve(value ?? -1)); }); }
    catch { throw new SpeechAudioError("El extractor de voz no pudo iniciarse.", "audio_extractor_unavailable", 503); }
    sourceDurationSeconds ??= sourceDurationFromDiagnostic(pending);
    if (timedOut) throw new SpeechAudioError("La extracción de este fragmento de voz tardó demasiado. Reintenta.", "audio_extraction_timeout", 504);
    if (code !== 0) {
      const noAudio = /matches no streams|does not contain any stream/i.test(diagnostic);
      throw new SpeechAudioError(noAudio ? "Esta toma no contiene una pista de voz." : "No pudimos leer la voz de esta toma.", noAudio ? "no_audio_track" : "audio_extraction_failed");
    }
    const size = (await stat(target)).size;
    if (size > MAX_SPEECH_WAV_BYTES) throw new SpeechAudioError("El audio del fragmento supera el tamaño permitido.", "invalid_speech_audio");
    const bytes = new Uint8Array(await readFile(target));
    return { bytes, durationSeconds: speechWavDuration(bytes), sourceDurationSeconds };
  } catch (error) {
    if (error instanceof SpeechAudioError) throw error;
    // Never expose child diagnostics, source URLs or temporary paths to clients.
    throw new SpeechAudioError("No pudimos preparar la voz de este fragmento.", "audio_extraction_failed");
  } finally { clearTimeout(timer); }
}
