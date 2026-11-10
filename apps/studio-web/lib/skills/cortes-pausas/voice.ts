/**
 * Skill «Cortes y pausas» — detección de voz con umbral adaptativo.
 *
 * Un umbral fijo (−30 dB) confunde sílabas suaves con silencio en grabaciones
 * bajas o comprimidas (WhatsApp), y entonces se corta voz. Aquí, como en la skill
 * aprobada (cortes.py), el umbral se adapta a cada toma:
 *   piso  = percentil 10 de la envolvente (ruido de fondo)
 *   pico  = percentil 98 (voz fuerte)
 *   umbral = máx(piso + 11 dB, pico − 38 dB)
 * Islas de voz separadas por ≤ 0,14 s se unen; ninguna isla se descarta por
 * corta salvo ruido de < 0,05 s («Y sí» sobrevive).
 */
import { spawn } from "node:child_process";
import type { Range } from "./plan";

export const VOICE_RULES = {
  windowSeconds: .01,
  floorPercentile: .10,
  peakPercentile: .98,
  aboveFloorDb: 11,
  belowPeakDb: 38,
  bridgeSeconds: .14,
  minIslandSeconds: .05,
  sampleRate: 8_000,
} as const;

export type VoiceActivity = { islands: Range[]; silences: Range[]; thresholdDb: number; floorDb: number; peakDb: number };

function percentile(sorted: Float64Array, fraction: number) {
  if (!sorted.length) return -120;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))];
}

/** Envolvente en dB (ventanas de 10 ms) → islas de voz y silencios, en segundos relativos al inicio de las muestras. */
export function voiceActivityFromSamples(samples: Float32Array, sampleRate: number, offsetSeconds = 0): VoiceActivity {
  const size = Math.max(1, Math.round(sampleRate * VOICE_RULES.windowSeconds));
  const count = Math.floor(samples.length / size);
  const envelope = new Float64Array(count);
  for (let block = 0; block < count; block += 1) {
    let power = 0;
    for (let index = block * size; index < (block + 1) * size; index += 1) power += samples[index] * samples[index];
    envelope[block] = 10 * Math.log10(power / size + 1e-12);
  }
  const sorted = Float64Array.from(envelope).sort();
  const floorDb = percentile(sorted, VOICE_RULES.floorPercentile);
  const peakDb = percentile(sorted, VOICE_RULES.peakPercentile);
  const thresholdDb = Math.max(floorDb + VOICE_RULES.aboveFloorDb, peakDb - VOICE_RULES.belowPeakDb);
  const raw: Range[] = [];
  let start = -1;
  for (let block = 0; block <= count; block += 1) {
    const active = block < count && envelope[block] > thresholdDb;
    if (active && start < 0) start = block;
    if (!active && start >= 0) { raw.push({ start: start * VOICE_RULES.windowSeconds, end: block * VOICE_RULES.windowSeconds }); start = -1; }
  }
  const bridged: Range[] = [];
  for (const island of raw) {
    const last = bridged[bridged.length - 1];
    if (last && island.start - last.end <= VOICE_RULES.bridgeSeconds) last.end = island.end;
    else bridged.push({ ...island });
  }
  const islands = bridged.filter((island) => island.end - island.start >= VOICE_RULES.minIslandSeconds)
    .map((island) => ({ start: island.start + offsetSeconds, end: island.end + offsetSeconds }));
  const total = count * VOICE_RULES.windowSeconds + offsetSeconds;
  const silences: Range[] = [];
  let cursor = offsetSeconds;
  for (const island of islands) {
    if (island.start > cursor) silences.push({ start: cursor, end: island.start });
    cursor = island.end;
  }
  if (total > cursor) silences.push({ start: cursor, end: total });
  return { islands, silences, thresholdDb, floorDb, peakDb };
}

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
