/**
 * Recursos visuales creados con IA (Gemini o ChatGPT).
 *
 * 1. Momentos: las palabras clave que la skill de subtítulos ya resalta (cifras, marcas, nombres,
 *    sustantivos fuertes), con su tiempo REAL de voz, respetando el espacio entre imágenes,
 *    las elecciones manuales y los límites del render (2 por toma, 8 por video).
 * 2. Encargo: la frase que se dice, la idea clave, el tema del video y un estilo fijo para que
 *    todas las imágenes del video combinen. Sin texto dentro de la imagen.
 * Código puro: lo usan el navegador (planificar) y el servidor (construir el encargo).
 */
import type { CaptionCue } from "./caption-cues";
import { planKineticCaptions } from "./skills/subtitulos-cineticos/plan";
import { MAX_VISUAL_RESOURCES_PER_CLIP, MAX_VISUAL_RESOURCES_TOTAL, type VisualResource, type VisualResourceClip } from "./visual-resources";

export type AiImageProvider = "gemini" | "openai";
/** Toda fuente de imagen: fotos de banco gratis (Pexels, Openverse) o IA (Gemini, ChatGPT). */
export type ImageSource = AiImageProvider | "pexels" | "openverse";
export const SOURCE_LABELS: Record<ImageSource, string> = { pexels: "Pexels", openverse: "Openverse", gemini: "Gemini", openai: "ChatGPT" };
export type AiImageStyle = "3d" | "foto";
export const AI_PROVIDERS: Record<AiImageProvider, { label: string; envKey: string; approxUsdPerImage: number }> = {
  gemini: { label: "Gemini", envKey: "GEMINI_API_KEY", approxUsdPerImage: .034 },
  openai: { label: "ChatGPT", envKey: "OPENAI_API_KEY", approxUsdPerImage: .05 },
};
export const AI_STYLES: Record<AiImageStyle, { label: string; prompt: string }> = {
  "3d": {
    label: "3D como la biblioteca",
    prompt: "render 3D limpio de estudio, estilo editorial premium; un objeto o escena protagonista con materiales nítidos; fondo oscuro casi negro con un brillo cálido naranja (#FF7A00) suave y toques violeta; iluminación cinematográfica",
  },
  foto: {
    label: "Foto real",
    prompt: "fotografía real de banco de imágenes premium, luz natural, colores naturales sin filtros, enfoque nítido en el sujeto y fondo con desenfoque suave",
  },
};

export type AiVisualMoment = {
  segmentId: string;
  /** Palabra o cifra clave tal como se dice. */
  keyword: string;
  /** Frase completa en la que aparece (el subtítulo). */
  phrase: string;
  /** Tiempos absolutos de la toma (antes de recortes), como VisualResource. */
  startSeconds: number;
  endSeconds: number;
  layout: VisualResource["layout"];
};

type PlannableClip = VisualResourceClip & { title?: string };

const IMAGE_SECONDS = 2.6;
const GAP_SECONDS = 2;
/** Una imagen cada ~7 s de video final como máximo: apoyo, no carrusel. */
const SECONDS_PER_IMAGE = 7;
const STOP = new Set(["que", "porque", "para", "pero", "como", "cuando", "donde", "este", "esta", "esto", "eso", "esos", "esas", "todo", "todos", "nada", "algo", "muy", "mas", "más", "también", "entonces", "ahora", "siempre", "nunca", "aqui", "aquí", "hacer", "tener", "puede", "pueden", "vamos", "usted", "ustedes", "nosotros", "ellos", "ellas", "sobre", "entre", "desde", "hasta", "hola"]);

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9ñ]+/g, "");

const DETERMINERS = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "su", "sus", "mi", "mis", "tu", "tus", "nuestro", "nuestra", "este", "esta", "estos", "estas", "ese", "esa", "del", "al"]);

/**
 * Puntaje visual de una palabra. Lo que mejor se ilustra es un sustantivo concreto: en español casi
 * siempre va después de un artículo («la parábola», «tu equipo»). Adverbios y adjetivos («fuertemente»,
 * «interesante») y verbos pesan poco aunque vayan resaltados.
 */
function visualScore(text: string, previous: string, emphasized: boolean) {
  const plain = normalize(text);
  if (plain.length < 3 || STOP.has(plain) || /^\d+$/.test(plain)) return -1;
  const adverb = /mente$/.test(plain);
  const adjective = /(ante|ente|iente|ivo|iva|oso|osa|able|ible|isimo|isima)$/.test(plain);
  const verb = /(ar|er|ir|amos|emos|imos|aron|ieron|ando|iendo|aba|aban|ado|ido|ada|ida)$/.test(plain);
  const noun = /(cion|sion|dad|tad|miento|aje|ura|ero|era|ista|ismo|or|ora)$/.test(plain);
  return (DETERMINERS.has(normalize(previous)) ? 6 : 0) + (noun ? 3 : 0) + (emphasized ? 3 : 0) + Math.min(plain.length, 9)
    + (/^\p{Lu}/u.test(text) && previous ? 2 : 0) - (adverb ? 12 : 0) - (adjective ? 5 : 0) - (verb ? 6 : 0);
}

/** Clave para no repetir la misma idea («talento» y «talentos» son una). */
const conceptKey = (value: string) => normalize(value).replace(/\d+/g, "").replace(/(es|s)$/, "");

/** Momentos para imágenes generadas, siempre anclados a una palabra con tiempo real de voz. */
export function planAiVisualMoments(clips: PlannableClip[], options: { maxTotal?: number } = {}): AiVisualMoment[] {
  type Candidate = AiVisualMoment & { score: number; outputStart: number; outputEnd: number };
  const occupied: Array<{ start: number; end: number }> = [];
  const perClip = new Map<string, number>();
  const candidates: Candidate[] = [];
  let outputOffset = 0;
  let total = 0;
  for (const clip of clips) {
    if (clip.included === false) continue;
    const speed = clip.playbackSpeed ?? 1;
    const { trimStartSeconds: trimStart, trimEndSeconds: trimEnd, duration } = clip;
    if (![trimStart, trimEnd, duration, speed].every(Number.isFinite) || trimStart < 0 || trimEnd > duration || trimEnd <= trimStart || speed < .5 || speed > 2) continue;
    const toOutput = (seconds: number) => outputOffset + (seconds - trimStart) / speed;
    // Elecciones manuales y descartes explícitos mandan: ocupan su lugar y no se tocan.
    for (const resource of clip.visualResources ?? []) {
      occupied.push({ start: toOutput(resource.startSeconds), end: toOutput(resource.endSeconds) });
      perClip.set(clip.segmentId, (perClip.get(clip.segmentId) ?? 0) + 1);
      total += 1;
    }
    if (!clip.resourcesReviewed) {
      const timed = clip.captionCues.filter((cue) => cue.words?.length && cue.endSeconds > trimStart && cue.startSeconds < trimEnd)
        .sort((a, b) => a.startSeconds - b.startSeconds);
      const kinetic = planKineticCaptions(timed);
      const emphasized = new Set(kinetic.filter((word) => word.style === "enfasis").map((word) => `${Math.round(word.startSeconds * 100)}`));
      const words = timed.flatMap((cue) => cue.words ?? []).sort((a, b) => a.startSeconds - b.startSeconds);
      const clean = (value: string) => value.replace(/[^\p{L}\p{N}%$€-]+/gu, "");
      words.forEach((word, index) => {
        if (word.startSeconds < trimStart || word.startSeconds + .3 >= trimEnd) return;
        const previous = words[index - 1]?.text ?? "";
        const score = visualScore(clean(word.text), clean(previous), emphasized.has(`${Math.round(word.startSeconds * 100)}`));
        if (score <= 6) return;
        // «5 talentos»: a number right before the noun is part of the idea.
        const keyword = /^\d+$/.test(clean(previous)) ? `${clean(previous)} ${clean(word.text)}` : clean(word.text);
        // The whole sentence (up to 14 words each side), so the brief knows what is being said.
        let from = index;
        while (from > 0 && index - from < 14 && !/[.?!]$/.test(words[from - 1].text)) from -= 1;
        let to = index;
        while (to < words.length - 1 && to - index < 14 && !/[.?!]$/.test(words[to].text)) to += 1;
        const start = Math.max(trimStart, word.startSeconds - .05);
        const end = Math.min(trimEnd, start + IMAGE_SECONDS * speed);
        if ((end - start) / speed < .9) return;
        candidates.push({
          segmentId: clip.segmentId, keyword, phrase: words.slice(from, to + 1).map((item) => item.text).join(" ").trim(),
          startSeconds: Number(start.toFixed(3)), endSeconds: Number(end.toFixed(3)), layout: "wide", score,
          outputStart: toOutput(start), outputEnd: toOutput(end),
        });
      });
    }
    outputOffset += (trimEnd - trimStart) / speed;
  }
  const budget = Math.min(options.maxTotal ?? MAX_VISUAL_RESOURCES_TOTAL, MAX_VISUAL_RESOURCES_TOTAL, Math.max(1, Math.ceil(outputOffset / SECONDS_PER_IMAGE))) - total;
  const chosen: Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score || a.outputStart - b.outputStart)) {
    if (chosen.length >= budget) break;
    const key = conceptKey(candidate.keyword);
    if (seen.has(key) || (perClip.get(candidate.segmentId) ?? 0) >= MAX_VISUAL_RESOURCES_PER_CLIP) continue;
    if ([...occupied, ...chosen.map((item) => ({ start: item.outputStart, end: item.outputEnd }))]
      .some((item) => candidate.outputStart < item.end + GAP_SECONDS && candidate.outputEnd > item.start - GAP_SECONDS)) continue;
    chosen.push(candidate);
    seen.add(key);
    perClip.set(candidate.segmentId, (perClip.get(candidate.segmentId) ?? 0) + 1);
  }
  return chosen.sort((a, b) => a.outputStart - b.outputStart)
    .map(({ score: _score, outputStart: _start, outputEnd: _end, ...moment }) => { void _score; void _start; void _end; return moment; });
}

/** La frase hablada alrededor de un instante de la toma (para regenerar una imagen ya colocada). */
export function phraseAt(cues: CaptionCue[], seconds: number) {
  const cue = cues.find((item) => seconds >= item.startSeconds - .05 && seconds < item.endSeconds + .05)
    ?? [...cues].sort((a, b) => Math.abs(a.startSeconds - seconds) - Math.abs(b.startSeconds - seconds))[0];
  return cue?.text.trim() ?? "";
}

export type ImageBrief = { keyword: string; phrase: string; context?: string; style: AiImageStyle; layout: VisualResource["layout"] };

const clip = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

/** El encargo que reciben Gemini y ChatGPT: idéntico para los dos, para poder comparar. */
export function buildImagePrompt(brief: ImageBrief) {
  const keyword = clip(brief.keyword, 60);
  const phrase = clip(brief.phrase, 300);
  const context = brief.context ? clip(brief.context, 300) : "";
  return [
    "Crea una imagen de apoyo para un reel vertical de una marca que habla en español.",
    `La persona dice: «${phrase}». La idea que debe verse de inmediato es «${keyword}».`,
    context ? `Tema general del video: ${context}.` : "",
    `Estilo: ${AI_STYLES[brief.style].prompt}.`,
    brief.layout === "wide"
      ? "Composición horizontal 16:9, sujeto centrado con aire alrededor; se verá en el centro del video durante unos dos segundos."
      : "Composición cuadrada 1:1 con un solo objeto protagonista centrado; se verá pequeña en una esquina, debe entenderse de un vistazo.",
    "Reglas: sin texto, letras, cifras escritas, logotipos ni marcas de agua; sin personas reconocibles ni marcas reales; una sola idea clara que acompañe lo que se dice, nunca que lo contradiga.",
  ].filter(Boolean).join("\n");
}

/** Fuente de una imagen, leída de su título («Pexels · idea · Foto de…», «Gemini · idea»). */
export function providerOfTitle(title: string | undefined): ImageSource | null {
  if (!title) return null;
  return (Object.keys(SOURCE_LABELS) as ImageSource[]).find((source) => title.startsWith(`${SOURCE_LABELS[source]} · `)) ?? null;
}
