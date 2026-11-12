/**
 * Herramientas por toma: textos libres, encuadre (zoom, posición, giro, espejo) y filtro de color.
 * Las mismas reglas sirven al editor (vista previa con CSS) y al render (filtros de FFmpeg).
 */

export type TextBackground = "none" | "dark" | "light" | "brand";
export type TextOverlay = {
  id: string;
  text: string;
  /** Segundos de la toma original (como los subtítulos): el render los lleva al video final. */
  startSeconds: number;
  endSeconds: number;
  /** Centro de la caja en fracciones del cuadro (0 = izquierda/arriba, 1 = derecha/abajo). */
  x: number;
  y: number;
  /** Tamaño de letra en píxeles sobre un cuadro de 1080 × 1920. */
  size: number;
  color: string;
  background: TextBackground;
};

export type ClipRotation = 0 | 90 | 180 | 270;
export type ClipTransform = {
  /** 1 = cuadro completo; más de 1 acerca y recorta; menos de 1 achica con bordes. */
  scale: number;
  /** −1 … 1: hacia dónde se corre el encuadre cuando hay espacio. */
  x: number;
  y: number;
  rotate: ClipRotation;
  flipH: boolean;
  flipV: boolean;
};

export const COLOR_FILTERS = [
  { id: "none", label: "Original" },
  { id: "vivo", label: "Vivo" },
  { id: "calido", label: "Cálido" },
  { id: "frio", label: "Frío" },
  { id: "cine", label: "Cine" },
  { id: "suave", label: "Suave" },
  { id: "vintage", label: "Vintage" },
  { id: "bn", label: "Blanco y negro" },
] as const;
export type ColorFilterId = (typeof COLOR_FILTERS)[number]["id"];

export const TEXT_LIMITS = { perClip: 6, characters: 120, minSize: 24, maxSize: 100, minSeconds: .2 } as const;
export const TRANSFORM_LIMITS = { minScale: .5, maxScale: 3 } as const;
export const IDENTITY_TRANSFORM: ClipTransform = { scale: 1, x: 0, y: 0, rotate: 0, flipH: false, flipV: false };
export const TEXT_BACKGROUNDS: Record<TextBackground, { label: string; color: string; opacity: number }> = {
  none: { label: "Sin fondo", color: "#000000", opacity: 0 },
  dark: { label: "Caja oscura", color: "#09090B", opacity: .85 },
  light: { label: "Caja blanca", color: "#FFFFFF", opacity: .92 },
  brand: { label: "Naranja Segmenta", color: "#FF7A00", opacity: .95 },
};
export const TEXT_COLORS = ["#FFFFFF", "#09090B", "#FF7A00", "#FACC15", "#34D399", "#60A5FA", "#F472B6"] as const;

type Row = Record<string, unknown>;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

function hex(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

/** Valida los textos de una toma dentro de su recorte. Lanza errores en español para el editor. */
export function normalizeTextOverlays(value: unknown, bounds: { durationSeconds: number; trimStartSeconds: number; trimEndSeconds: number }): TextOverlay[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Los textos de una toma no tienen un formato válido.");
  if (value.length > TEXT_LIMITS.perClip) throw new Error(`Cada toma admite hasta ${TEXT_LIMITS.perClip} textos.`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Un texto no tiene un formato válido.");
    const raw = item as Row;
    const text = typeof raw.text === "string" ? raw.text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
    if (!text) throw new Error("Hay un texto vacío. Escríbelo o bórralo.");
    if (text.length > TEXT_LIMITS.characters) throw new Error(`Cada texto admite hasta ${TEXT_LIMITS.characters} caracteres.`);
    const start = clamp(finite(raw.startSeconds, bounds.trimStartSeconds), bounds.trimStartSeconds, bounds.trimEndSeconds);
    const end = clamp(finite(raw.endSeconds, start + 2), start, Math.min(bounds.trimEndSeconds, bounds.durationSeconds));
    if (end - start < TEXT_LIMITS.minSeconds) throw new Error("Un texto queda fuera del recorte de su toma. Muévelo o bórralo.");
    const background = typeof raw.background === "string" && raw.background in TEXT_BACKGROUNDS ? raw.background as TextBackground : "dark";
    return {
      id: typeof raw.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : `texto-${index + 1}`,
      text,
      startSeconds: Number(start.toFixed(3)),
      endSeconds: Number(end.toFixed(3)),
      x: clamp(finite(raw.x, .5), 0, 1),
      y: clamp(finite(raw.y, .3), 0, 1),
      size: Math.round(clamp(finite(raw.size, 64), TEXT_LIMITS.minSize, TEXT_LIMITS.maxSize)),
      color: hex(raw.color, "#FFFFFF"),
      background,
    };
  });
}

export function normalizeClipTransform(value: unknown): ClipTransform {
  if (value === undefined || value === null) return { ...IDENTITY_TRANSFORM };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("El encuadre de una toma no es válido.");
  const raw = value as Row;
  const rotate = [0, 90, 180, 270].includes(Number(raw.rotate)) ? Number(raw.rotate) as ClipRotation : 0;
  return {
    scale: Number(clamp(finite(raw.scale, 1), TRANSFORM_LIMITS.minScale, TRANSFORM_LIMITS.maxScale).toFixed(3)),
    x: Number(clamp(finite(raw.x, 0), -1, 1).toFixed(3)),
    y: Number(clamp(finite(raw.y, 0), -1, 1).toFixed(3)),
    rotate,
    flipH: raw.flipH === true,
    flipV: raw.flipV === true,
  };
}

export function normalizeColorFilter(value: unknown): ColorFilterId {
  return COLOR_FILTERS.some((item) => item.id === value) ? value as ColorFilterId : "none";
}

export const isIdentityTransform = (t: ClipTransform) => t.scale === 1 && t.x === 0 && t.y === 0 && t.rotate === 0 && !t.flipH && !t.flipV;

/** Giro y espejo: van antes de encuadrar a 1080 × 1920, así una toma girada vuelve a llenar el cuadro. */
export function orientationFilters(t: ClipTransform): string[] {
  const steps: string[] = [];
  if (t.rotate === 90) steps.push("transpose=1");
  if (t.rotate === 270) steps.push("transpose=2");
  if (t.rotate === 180) steps.push("hflip", "vflip");
  if (t.flipH) steps.push("hflip");
  if (t.flipV) steps.push("vflip");
  return steps;
}

/** Zoom y posición sobre el cuadro ya encuadrado de 1080 × 1920. */
export function framingFilters(t: ClipTransform): string[] {
  if (t.scale === 1) return [];
  const size = `scale=trunc(iw*${t.scale}/2)*2:trunc(ih*${t.scale}/2)*2`;
  if (t.scale > 1) return [size, `crop=1080:1920:x='(iw-1080)/2*(1+${t.x})':y='(ih-1920)/2*(1+${t.y})'`];
  return [size, `pad=1080:1920:x='(ow-iw)/2*(1+${t.x})':y='(oh-ih)/2*(1+${t.y})':color=0x09090b`];
}

const FFMPEG_COLOR: Record<ColorFilterId, string[]> = {
  none: [],
  vivo: ["eq=saturation=1.3:contrast=1.08"],
  calido: ["colorbalance=rs=.08:gs=.02:bs=-.08:rm=.06:bm=-.06"],
  frio: ["colorbalance=rs=-.08:bs=.1:rm=-.05:bm=.08"],
  cine: ["colorbalance=rs=.06:bs=-.06:rh=-.04:bh=.06", "eq=saturation=.9:contrast=1.08"],
  suave: ["eq=contrast=.92:saturation=.9:brightness=.03"],
  vintage: ["curves=preset=vintage"],
  bn: ["hue=s=0", "eq=contrast=1.1"],
};
export const colorFilters = (id: ColorFilterId) => FFMPEG_COLOR[id] ?? [];

/** Aproximación en CSS de cada filtro para la vista previa del editor. */
export const CSS_COLOR: Record<ColorFilterId, string> = {
  none: "",
  vivo: "saturate(1.3) contrast(1.08)",
  calido: "sepia(.18) saturate(1.12) hue-rotate(-8deg)",
  frio: "hue-rotate(12deg) saturate(.95) brightness(1.02)",
  cine: "contrast(1.08) saturate(.9) sepia(.1)",
  suave: "contrast(.92) saturate(.9) brightness(1.03)",
  vintage: "sepia(.38) contrast(.95) saturate(.85)",
  bn: "grayscale(1) contrast(1.1)",
};

/** Transformación CSS equivalente al encuadre del render (traslación en % del cuadro antes de escalar). */
export function cssTransform(t: ClipTransform): string {
  const tx = (t.x * (1 - t.scale) / 2) * 100;
  const ty = (t.y * (1 - t.scale) / 2) * 100;
  return `translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%) rotate(${t.rotate}deg) scale(${(t.flipH ? -1 : 1) * t.scale}, ${(t.flipV ? -1 : 1) * t.scale})`;
}

/** Posición de un texto en el render: centrado en (x, y) y siempre dentro del cuadro. */
export function textOverlayPosition(item: Pick<TextOverlay, "x" | "y">) {
  return { x: `'max(0,min(W-w,W*${item.x.toFixed(4)}-w/2))'`, y: `'max(0,min(H-h,H*${item.y.toFixed(4)}-h/2))'` };
}

/** Ajusta los textos a un recorte nuevo (al recortar o dividir una toma): los de afuera se quitan. */
export function fitTextOverlays(texts: TextOverlay[], start: number, end: number): TextOverlay[] {
  return texts.flatMap((item) => {
    const from = Math.max(start, item.startSeconds);
    const to = Math.min(end, item.endSeconds);
    return to - from >= TEXT_LIMITS.minSeconds ? [{ ...item, startSeconds: from, endSeconds: to }] : [];
  });
}

/** Borrador guardado en el navegador: se conserva lo válido sin bloquear el editor por un texto dañado. */
export function restoreTextOverlays(value: unknown, bounds: { durationSeconds: number; trimStartSeconds: number; trimEndSeconds: number }): TextOverlay[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, TEXT_LIMITS.perClip).flatMap((item) => {
    try { return normalizeTextOverlays([item], bounds); } catch { return []; }
  });
}

export function restoreClipTransform(value: unknown): ClipTransform {
  try { return normalizeClipTransform(value); } catch { return { ...IDENTITY_TRANSFORM }; }
}

/** Texto nuevo en el cursor: dura hasta 3 s dentro del recorte, arriba al centro. */
export function newTextOverlay(id: string, cursor: number, trimStart: number, trimEnd: number): TextOverlay {
  const start = Math.max(trimStart, Math.min(cursor, trimEnd - TEXT_LIMITS.minSeconds));
  return { id, text: "Escribe aquí", startSeconds: Number(start.toFixed(3)), endSeconds: Number(Math.min(trimEnd, start + 3).toFixed(3)), x: .5, y: .22, size: 64, color: "#FFFFFF", background: "dark" };
}

/** Efectos de voz por toma (como los de CapCut). Mantienen la duración: el tono cambia, el ritmo no. */
export const VOICE_EFFECTS = [
  { id: "none", label: "Normal", filters: [] as string[] },
  { id: "ardilla", label: "Ardilla", filters: ["asetrate=48000*1.35", "aresample=48000", "atempo=0.7407"] },
  { id: "grave", label: "Grave", filters: ["asetrate=48000*0.78", "aresample=48000", "atempo=1.2821"] },
  { id: "eco", label: "Eco", filters: ["aecho=0.8:0.85:120|240:0.35|0.2"] },
  { id: "cueva", label: "Cueva", filters: ["aecho=0.8:0.9:500|900:0.3|0.18"] },
  { id: "radio", label: "Radio", filters: ["highpass=f=400", "lowpass=f=3200", "acompressor=threshold=-20dB:ratio=4"] },
  { id: "megafono", label: "Megáfono", filters: ["highpass=f=650", "lowpass=f=2400", "volume=1.6", "alimiter=limit=0.9"] },
  { id: "robot", label: "Robot", filters: ["afftfilt=real='hypot(re\\,im)*sin(0)':imag='hypot(re\\,im)*cos(0)':win_size=512:overlap=0.75"] },
] as const;
export type VoiceEffectId = (typeof VOICE_EFFECTS)[number]["id"];
export const normalizeVoiceEffect = (value: unknown): VoiceEffectId => VOICE_EFFECTS.some((item) => item.id === value) ? value as VoiceEffectId : "none";
export const voiceEffectFilters = (id: VoiceEffectId): string[] => [...(VOICE_EFFECTS.find((item) => item.id === id)?.filters ?? [])];

/** Congelar el último cuadro de la toma (segundos), como el «congelar» de CapCut. */
export const MAX_FREEZE_SECONDS = 3;
export function normalizeFreezeSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Number(Math.min(MAX_FREEZE_SECONDS, value).toFixed(2));
}

/** Fundidos de audio por toma (entrada y salida), en segundos. */
export const MAX_AUDIO_FADE_SECONDS = 3;
export function normalizeAudioFade(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Number(Math.min(MAX_AUDIO_FADE_SECONDS, value).toFixed(2));
}
/** Filtros afade para la voz de una toma de `duration` segundos; nunca se solapan. */
export function audioFadeFilters(fadeIn: number, fadeOut: number, duration: number): string[] {
  const inSeconds = Math.min(normalizeAudioFade(fadeIn), duration / 2);
  const outSeconds = Math.min(normalizeAudioFade(fadeOut), duration / 2);
  return [
    ...(inSeconds > 0 ? [`afade=t=in:st=0:d=${inSeconds.toFixed(3)}`] : []),
    ...(outSeconds > 0 ? [`afade=t=out:st=${Math.max(0, duration - outSeconds).toFixed(3)}:d=${outSeconds.toFixed(3)}`] : []),
  ];
}
