/**
 * Skill «Cortes y pausas» — medición de voz de una toma en el servidor (FFmpeg).
 * El cálculo está en voice-core.ts para poder usarlo también en el navegador.
 */
import { spawn } from "node:child_process";
import type { Range } from "./plan";
import { VOICE_RULES, voiceActivityFromSamples, type VoiceActivity } from "./voice-core";

export { VOICE_RULES, voiceActivityFromSamples, type VoiceActivity };

/**
 * Decodifica solo el audio de la ventana (mono, 8 kHz) y mide la voz. Los tiempos
 * devueltos están en segundos del archivo original.
 */
export async function measureVoiceActivity(command: string, url: string, window: Range, deadline: number): Promise<VoiceActivity | null> {
  const length = window.end - window.start;
  if (!(length > .2)) return null;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("El proyecto excedió el tiempo seguro de exportación.");
  const child = spawn(command, [
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-threads", "1",
    "-ss", window.start.toFixed(3), "-t", length.toFixed(3), "-i", url,
    "-map", "0:a:0?", "-vn", "-ac", "1", "-ar", String(VOICE_RULES.sampleRate), "-f", "f32le", "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, Math.min(remaining, 45_000));
  const chunks: Buffer[] = [];
  let bytes = 0;
  const limit = Math.ceil((length + 1) * VOICE_RULES.sampleRate * 4);
  child.stdout.on("data", (chunk: Buffer) => {
    if (bytes + chunk.length > limit) return;
    bytes += chunk.length;
    chunks.push(chunk);
  });
  let diagnostic = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (part: string) => { diagnostic = (diagnostic + part).slice(-4_000); });
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (value) => resolve(value ?? -1));
  }).finally(() => clearTimeout(timer));
  if (timedOut) throw new Error("La toma tardó demasiado en analizarse.");
  if (code !== 0) throw new Error(`No se pudo medir la voz de una toma: ${diagnostic.slice(-400)}`);
  if (bytes < 4 * VOICE_RULES.sampleRate * .2) return null;
  // Copy into an aligned buffer: a pooled Buffer may not start on a 4-byte boundary.
  const samples = new Float32Array(Math.floor(bytes / 4));
  new Uint8Array(samples.buffer).set(Buffer.concat(chunks, bytes).subarray(0, samples.length * 4));
  return voiceActivityFromSamples(samples, VOICE_RULES.sampleRate, window.start);
}
