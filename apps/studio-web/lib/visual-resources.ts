import type { CaptionCue } from "./caption-cues";

export const BUILTIN_VISUAL_RESOURCE_IDS = ["money", "ideas", "time", "growth", "work", "fear"] as const;
export type BuiltinVisualResourceId = typeof BUILTIN_VISUAL_RESOURCE_IDS[number];
export const MAX_VISUAL_RESOURCES_PER_CLIP = 2;
export const MAX_VISUAL_RESOURCES_TOTAL = 8;
/** Decoded bytes; their base64 representation is up to one third larger. */
export const MAX_VISUAL_IMAGE_BYTES = 200 * 1024;
export const MAX_VISUAL_IMAGE_BYTES_TOTAL = 1.5 * 1024 * 1024;
export const VISUAL_RESOURCE_LAYOUTS = {
  corner: { x: 700, y: 250, width: 300, height: 300 },
  wide: { x: 80, y: 520, width: 920, height: 520 },
} as const;

export type VisualResourceImage =
  | { kind: "builtin"; assetId: BuiltinVisualResourceId }
  | { kind: "upload"; dataUrl: string; title: string };
export type VisualResource = {
  id: string;
  keyword: string;
  /** Absolute source-media times, before trimming, silence removal or speed changes. */
  startSeconds: number;
  endSeconds: number;
  layout: keyof typeof VISUAL_RESOURCE_LAYOUTS;
  image: VisualResourceImage;
};
export type VisualResourceClip = {
  segmentId: string;
  duration: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  captionCues: CaptionCue[];
  included?: boolean;
  playbackSpeed?: number;
  visualResources?: VisualResource[];
  resourcesReviewed?: boolean;
};

export function builtinAssetPath(assetId: BuiltinVisualResourceId) {
  if (!(BUILTIN_VISUAL_RESOURCE_IDS as readonly string[]).includes(assetId)) throw new Error("El recurso visual no pertenece a la biblioteca.");
  return `/visual-resources/${assetId}.png`;
}

export const VISUAL_RESOURCE_CATALOG: ReadonlyArray<{
  id: BuiltinVisualResourceId; title: string; description: string; keywords: readonly string[]; src: string;
}> = [
  { id: "money", title: "Dinero", description: "Apoyo para dinero, presupuesto y ahorro.", keywords: ["dinero", "un solo peso", "pesos", "dólar", "dólares", "moneda", "monedas", "presupuesto", "ahorro", "ahorros", "inversión", "invertir", "cotización", "precio"], src: builtinAssetPath("money") },
  { id: "ideas", title: "Ideas", description: "Apoyo para ideas, creatividad y soluciones.", keywords: ["idea", "ideas", "creatividad", "creativo", "creativa", "imaginación", "imaginar", "innovación", "solución", "soluciones"], src: builtinAssetPath("ideas") },
  { id: "time", title: "Tiempo", description: "Apoyo para tiempo, espera y fechas.", keywords: ["tiempo", "minuto", "minutos", "hora", "horas", "reloj", "esperar", "esperando", "plazo", "fecha", "fechas"], src: builtinAssetPath("time") },
  { id: "growth", title: "Crecimiento", description: "Apoyo para avanzar, mejorar y desarrollar capacidades.", keywords: ["crecer", "crecimiento", "progreso", "progresar", "desarrollar", "desarrolla", "desarrollo", "aprender", "aprendizaje", "mejorar", "talento", "talentos", "habilidad", "habilidades"], src: builtinAssetPath("growth") },
  { id: "work", title: "Trabajo", description: "Apoyo para trabajo, proyectos y equipos.", keywords: ["trabajo", "trabajar", "trabajando", "empresa", "empresas", "oficina", "negocio", "negocios", "equipo", "compañeros", "proyecto", "proyectos", "emprender", "emprendimiento"], src: builtinAssetPath("work") },
  { id: "fear", title: "Miedo", description: "Apoyo para miedo, dudas e inseguridad.", keywords: ["miedo", "temor", "temores", "temer", "duda", "dudas", "inseguridad", "inseguro", "insegura", "ansiedad"], src: builtinAssetPath("fear") },
];

export function resourceImageSrc(image: VisualResourceImage) {
  return image.kind === "builtin" ? builtinAssetPath(image.assetId) : image.dataUrl;
}

function normalizedWords(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function keywordMatch(text: string) {
  const words = normalizedWords(text);
  const matches = VISUAL_RESOURCE_CATALOG.flatMap((asset) => asset.keywords.flatMap((keyword) => {
    const phrase = normalizedWords(keyword);
    const index = words.findIndex((_, start) => phrase.every((word, offset) => words[start + offset] === word));
    return index < 0 ? [] : [{ assetId: asset.id, keyword, index, length: phrase.length }];
  }));
  return matches.sort((a, b) => a.index - b.index || b.length - a.length);
}

/** A bounded keyword matcher, not a generative model. It never fabricates timing from a script. */
export function recommendVisualResources(clips: VisualResourceClip[]): Record<string, VisualResource[]> {
  const result: Record<string, VisualResource[]> = Object.create(null) as Record<string, VisualResource[]>;
  const seenAssets = new Set<BuiltinVisualResourceId>();
  let total = 0;
  let outputOffset = 0;
  let lastOutputEnd = -Infinity;
  const occupied: Array<{ start: number; end: number }> = [];
  // Manual choices and explicit dismissals are authoritative. Reserve them even
  // when they occur later in the montage than a proposed new resource.
  for (const clip of clips) {
    if (clip.included === false) continue;
    const speed = clip.playbackSpeed ?? 1;
    if (![clip.duration, clip.trimStartSeconds, clip.trimEndSeconds, speed].every(Number.isFinite)
        || clip.trimStartSeconds < 0 || clip.trimEndSeconds > clip.duration
        || clip.trimEndSeconds <= clip.trimStartSeconds || speed < .5 || speed > 2) continue;
    for (const resource of clip.visualResources || []) {
      total++;
      if (resource.image.kind === "builtin") seenAssets.add(resource.image.assetId);
      occupied.push({ start: outputOffset + (resource.startSeconds - clip.trimStartSeconds) / speed,
        end: outputOffset + (resource.endSeconds - clip.trimStartSeconds) / speed });
    }
    outputOffset += (clip.trimEndSeconds - clip.trimStartSeconds) / speed;
  }
  outputOffset = 0;
  for (const clip of clips) {
    result[clip.segmentId] = [];
    if (clip.included === false) continue;
    const { trimStartSeconds: trimStart, trimEndSeconds: trimEnd, duration } = clip;
    const speed = clip.playbackSpeed ?? 1;
    if (![trimStart, trimEnd, duration, speed].every(Number.isFinite) || trimStart < 0 || trimEnd > duration
        || trimEnd <= trimStart || speed < .5 || speed > 2) continue;
    if (clip.resourcesReviewed || clip.visualResources?.length) {
      outputOffset += (trimEnd - trimStart) / speed;
      continue;
    }
    const candidates = [...clip.captionCues].filter((cue) => Number.isFinite(cue.startSeconds) && Number.isFinite(cue.endSeconds)
      && cue.endSeconds > cue.startSeconds && cue.endSeconds > trimStart && cue.startSeconds < trimEnd)
      .sort((a, b) => a.startSeconds - b.startSeconds);
    for (const cue of candidates) {
      if (total >= MAX_VISUAL_RESOURCES_TOTAL || result[clip.segmentId].length >= MAX_VISUAL_RESOURCES_PER_CLIP) break;
      const start = Math.max(trimStart, cue.startSeconds);
      const end = Math.min(trimEnd, start + 2.6 * speed);
      const outputStart = outputOffset + (start - trimStart) / speed;
      const outputEnd = outputOffset + (end - trimStart) / speed;
      // Leave breathing room between resources, even across adjacent takes.
      if ((end - start) / speed < .65 || outputStart < lastOutputEnd + 2
          || occupied.some((item) => outputStart < item.end + 2 && outputEnd > item.start - 2)) continue;
      const match = keywordMatch(cue.text).find((candidate) => !seenAssets.has(candidate.assetId));
      if (!match) continue;
      const safeSegmentId = clip.segmentId.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 80);
      result[clip.segmentId].push({
        id: `visual:${safeSegmentId}:${match.assetId}:${Math.round(start * 1000)}`,
        keyword: match.keyword,
        startSeconds: start,
        endSeconds: end,
        layout: "corner",
        image: { kind: "builtin", assetId: match.assetId },
      });
      seenAssets.add(match.assetId);
      lastOutputEnd = outputOffset + (end - trimStart) / speed;
      total++;
    }
    outputOffset += (trimEnd - trimStart) / speed;
  }
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} no es válido.`);
  return value as Record<string, unknown>;
}

function shortText(value: unknown, maximum: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} no es válido.`);
  return value.trim();
}

/** Validates encoding and file signatures without importing Node-only APIs into the UI. */
export function visualImageByteLength(dataUrl: unknown): number {
  if (typeof dataUrl !== "string" || dataUrl.length > Math.ceil(MAX_VISUAL_IMAGE_BYTES / 3) * 4 + 30) throw new Error("Cada imagen admite hasta 200 KB. Reduce su tamaño antes de añadirla.");
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new Error("Usa una imagen PNG, JPEG o WebP válida.");
  const encoded = match[2];
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (!bytes || bytes > MAX_VISUAL_IMAGE_BYTES) throw new Error("Cada imagen admite hasta 200 KB. Reduce su tamaño antes de añadirla.");
  let binary: string;
  try { binary = atob(encoded.slice(0, 24)); } catch { throw new Error("La imagen no tiene un formato válido."); }
  const code = (index: number) => binary.charCodeAt(index);
  const valid = match[1] === "png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => code(index) === byte)
    : match[1] === "jpeg" ? code(0) === 255 && code(1) === 216 && code(2) === 255
      : binary.slice(0, 4) === "RIFF" && binary.slice(8, 12) === "WEBP";
  if (!valid) throw new Error("El contenido de la imagen no coincide con su formato.");
  return bytes;
}

export type VisualResourceBudget = { count: number; imageBytes: number };
export function createVisualResourceBudget(): VisualResourceBudget { return { count: 0, imageBytes: 0 }; }

export function validateVisualResourceBudget(resources: VisualResource[]) {
  if (resources.length > MAX_VISUAL_RESOURCES_TOTAL) throw new Error("Este montaje admite hasta 8 recursos visuales.");
  if (new Set(resources.map((item) => item.id)).size !== resources.length) throw new Error("Hay recursos visuales repetidos en el montaje.");
  const bytes = resources.reduce((sum, item) => sum + (item.image.kind === "upload" ? visualImageByteLength(item.image.dataUrl) : 0), 0);
  if (bytes > MAX_VISUAL_IMAGE_BYTES_TOTAL) throw new Error("Las imágenes del montaje superan 1,5 MB. Reduce su tamaño.");
}

/** No remote URLs, paths, arbitrary SVG or external image requests enter the render contract. */
export function normalizeVisualResources(value: unknown, bounds: {
  durationSeconds: number; trimStartSeconds?: number; trimEndSeconds?: number;
}, budget?: VisualResourceBudget): VisualResource[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_VISUAL_RESOURCES_PER_CLIP) throw new Error("Cada toma admite hasta 2 recursos visuales.");
  const from = bounds.trimStartSeconds ?? 0, to = bounds.trimEndSeconds ?? bounds.durationSeconds;
  if (![bounds.durationSeconds, from, to].every(Number.isFinite) || bounds.durationSeconds <= 0 || from < 0 || to > bounds.durationSeconds || to <= from) throw new Error("La duración de la toma no permite situar recursos visuales.");
  let bytes = 0;
  const resources = value.map((raw): VisualResource => {
    const item = object(raw, "El recurso visual");
    const id = shortText(item.id, 128, "El identificador del recurso");
    if (!/^[a-zA-Z0-9_.:-]+$/.test(id)) throw new Error("El identificador del recurso no es válido.");
    const keyword = shortText(item.keyword, 80, "La palabra del recurso");
    if (typeof item.startSeconds !== "number" || typeof item.endSeconds !== "number"
        || !Number.isFinite(item.startSeconds) || !Number.isFinite(item.endSeconds)
        || item.startSeconds < from || item.endSeconds > to || item.endSeconds - item.startSeconds < .1 - 1e-6
        || item.endSeconds - item.startSeconds > 12 + 1e-6) throw new Error("Sitúa cada imagen dentro del recorte, entre 0,1 y 12 segundos.");
    if (item.layout !== "corner" && item.layout !== "wide") throw new Error("La posición de la imagen no es válida.");
    const requestedImage = object(item.image, "La imagen");
    let image: VisualResourceImage;
    if (requestedImage.kind === "builtin") {
      if (typeof requestedImage.assetId !== "string" || !(BUILTIN_VISUAL_RESOURCE_IDS as readonly string[]).includes(requestedImage.assetId)) throw new Error("La imagen no pertenece a la biblioteca de recursos.");
      image = { kind: "builtin", assetId: requestedImage.assetId as BuiltinVisualResourceId };
    } else if (requestedImage.kind === "upload") {
      bytes += visualImageByteLength(requestedImage.dataUrl);
      image = { kind: "upload", dataUrl: requestedImage.dataUrl as string, title: shortText(requestedImage.title, 160, "El título de la imagen") };
    } else throw new Error("Usa una imagen de la biblioteca o una imagen subida desde tu dispositivo.");
    return { id, keyword, startSeconds: item.startSeconds, endSeconds: item.endSeconds, layout: item.layout, image };
  });
  if (new Set(resources.map((item) => item.id)).size !== resources.length) throw new Error("Hay recursos visuales repetidos en la toma.");
  if (budget) {
    if (budget.count + resources.length > MAX_VISUAL_RESOURCES_TOTAL) throw new Error("Este montaje admite hasta 8 recursos visuales.");
    if (budget.imageBytes + bytes > MAX_VISUAL_IMAGE_BYTES_TOTAL) throw new Error("Las imágenes del montaje superan 1,5 MB. Reduce su tamaño.");
    budget.count += resources.length;
    budget.imageBytes += bytes;
  }
  return resources;
}
