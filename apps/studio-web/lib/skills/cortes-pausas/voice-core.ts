/**
 * Skill «Cortes y pausas» — detección de voz con umbral adaptativo (código puro,
 * sirve en el servidor y en el navegador).
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
