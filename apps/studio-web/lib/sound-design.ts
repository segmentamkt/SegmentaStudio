/**
 * Small, original effects synthesized during rendering. No stock files, API key,
 * or third-party license is needed. The caller chooses *where* a cue belongs;
 * this module owns the sound palette and produces an FFmpeg audio filter graph.
 */
export type SoundPreset = "none" | "soft" | "kinetic" | "cinematic" | "pop";
export type SoundCueKind = "cut" | "title" | "emphasis";

export type SoundCue = {
  atSeconds: number;
  kind: SoundCueKind;
  preset?: SoundPreset;
  strength?: number;
};

export const SOUND_PRESETS: Array<{ id: SoundPreset; name: string; description: string }> = [
  { id: "none", name: "Sin efectos", description: "La voz y el silencio llevan la historia." },
  { id: "soft", name: "Suave", description: "Pequeño acento tonal al cambiar de idea." },
  { id: "kinetic", name: "Cinético", description: "Golpe breve y claro en cortes de alto ritmo." },
  { id: "cinematic", name: "Cinematográfico", description: "Pulso grave y aire sutil para una transición narrativa." },
  { id: "pop", name: "Marca pop", description: "Chispa de dos tonos para titulares y cambios de escena." },
];

export function soundPresetForStyle(styleId: unknown): SoundPreset {
  switch (styleId) {
    case "none": case "soft": case "kinetic": case "cinematic": case "pop": return styleId;
    case "reflexion-intima": case "autoridad-minimal": return "none";
    case "historia-cinematica": return "cinematic";
    case "kiko-impacto": case "ia-demostrativa": return "kinetic";
    case "storytelling-marca-pop": return "pop";
    default: return "soft";
  }
}

function bounded(value: number, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Pick accents at scene changes, but don't make every close cut noisy.
 * These are deterministic editorial decisions; no model inference is claimed.
 */
export function planCutSoundCues(cutTimes: number[], styleId: unknown, minimumGapSeconds = 0.9): SoundCue[] {
  const preset = soundPresetForStyle(styleId);
  if (preset === "none") return [];
  const gap = bounded(minimumGapSeconds, 0.9, 0.2, 5);
  let previous = -Infinity;
  return cutTimes
    .filter((time) => Number.isFinite(time) && time > 0)
    .sort((a, b) => a - b)
    .flatMap((time) => {
      if (time - previous < gap) return [];
      previous = time;
      return [{ atSeconds: time, kind: "cut" as const, preset, strength: 1 }];
    });
}

function sourceForPreset(preset: SoundPreset, kind: SoundCueKind) {
  if (preset === "cinematic") {
    return "sine=frequency=95:sample_rate=48000:duration=0.32,lowpass=f=280,afade=t=in:st=0:d=0.015,afade=t=out:st=0.13:d=0.19";
  }
  if (preset === "kinetic") {
    return kind === "title"
      ? "anoisesrc=color=pink:sample_rate=48000:duration=0.18,highpass=f=700,lowpass=f=5500,afade=t=out:st=0.025:d=0.15"
      : "sine=frequency=520:sample_rate=48000:duration=0.12,highpass=f=220,afade=t=out:st=0.01:d=0.11";
  }
  if (preset === "pop") {
    return "sine=frequency=740:sample_rate=48000:duration=0.14,afade=t=out:st=0.025:d=0.11";
  }
  return "anoisesrc=color=pink:sample_rate=48000:duration=0.16,highpass=f=650,lowpass=f=2600,afade=t=in:st=0:d=0.015,afade=t=out:st=0.03:d=0.13";
}

function gainForPreset(preset: SoundPreset, kind: SoundCueKind) {
  // FFmpeg's sine source peaks near 0.125 while anoisesrc peaks much higher.
  // Compensate for that difference so the UI's 0-1 volume control stays useful.
  if (preset === "cinematic") return 1.35;
  if (preset === "kinetic") return kind === "title" ? 0.15 : 1.25;
  if (preset === "pop") return 1.2;
  return 0.16;
}

/**
 * Append the returned filters to the caller's filter_complex. `inputLabel`
 * must name a stereo audio stream. Output labels contain no brackets.
 */
export function buildSoundDesignGraph(input: {
  inputLabel: string;
  cues: SoundCue[];
  volume: number;
  durationSeconds: number;
  outputLabel?: string;
}): { filters: string[]; outputLabel: string; renderedCueCount: number } {
  const { inputLabel, cues } = input;
  const outputLabel = input.outputLabel || "audioWithSfx";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(inputLabel) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(outputLabel)) {
    throw new Error("Etiqueta de audio inválida para el diseño sonoro.");
  }
  const totalDuration = bounded(input.durationSeconds, 0, 0, 7200);
  const masterVolume = bounded(input.volume, 0.35, 0, 1);
  const eligible = cues
    .filter((cue) => cue.preset !== "none" && Number.isFinite(cue.atSeconds) && cue.atSeconds >= 0 && cue.atSeconds < totalDuration && bounded(cue.strength ?? 1, 1, 0, 1) > 0)
    .slice(0, 120);
  if (!eligible.length || !masterVolume) return { filters: [], outputLabel: inputLabel, renderedCueCount: 0 };

  const filters: string[] = [];
  const labels: string[] = [];
  eligible.forEach((cue, index) => {
    const label = `segmentaSfx${index}`;
    const delayMs = Math.round(cue.atSeconds * 1000);
    const preset = cue.preset || "soft";
    const amplitude = (gainForPreset(preset, cue.kind) * masterVolume * bounded(cue.strength ?? 1, 1, 0, 1)).toFixed(4);
    filters.push(`${sourceForPreset(preset, cue.kind)},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${amplitude},adelay=${delayMs}|${delayMs}[${label}]`);
    labels.push(label);
  });
  filters.push(`[${inputLabel}]${labels.map((label) => `[${label}]`).join("")}amix=inputs=${labels.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[${outputLabel}]`);
  return { filters, outputLabel, renderedCueCount: labels.length };
}
