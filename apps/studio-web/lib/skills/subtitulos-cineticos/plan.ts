/**
 * Skill «Subtítulos cinéticos» — planificación (sin efectos secundarios).
 *
 * Convierte subtítulos con tiempos en una lista de palabras: UNA visible a la
 * vez, sincronizada con la voz, sin texto durante las pausas. Las reglas son
 * las aprobadas para los videos de Segmenta (skill editor-segmenta):
 * blanco para el texto, naranja para cifras, marcas y la palabra clave,
 * palabras funcionales cortas en trazo fino.
 */
import type { CaptionCue } from "../../caption-cues";

export type KineticStyle = "normal" | "enfasis" | "ligera";

export type KineticWord = {
  text: string;
  /** Segundo en que la palabra aparece (inicio de su sonido). */
  startSeconds: number;
  /** Segundo en que desaparece: justo antes de la siguiente palabra o tras una breve cola en las pausas. */
  endSeconds: number;
  style: KineticStyle;
  /** true cuando el tiempo se repartió dentro del subtítulo porque no había tiempos por palabra. */
  estimated: boolean;
};

export type KineticPlanOptions = {
  uppercase?: boolean;
  /** Duración del tramo; ninguna palabra queda visible después. */
  durationSeconds?: number;
  /** Palabras que siempre van en naranja (por ejemplo, del libreto). */
  keywords?: string[];
  /** Resaltado automático de la palabra clave de cada frase. */
  autoEmphasis?: boolean;
};

/** Tiempos aprobados en la referencia. */
export const KINETIC_TIMING = {
  /** Si la siguiente palabra llega antes de esto, la actual se mantiene hasta ella. */
  holdGapSeconds: .30,
  /** En una pausa real la palabra se va tras esta cola; no se anticipa la siguiente. */
  tailSeconds: .14,
  minVisibleSeconds: .14,
  /** Una pausa mayor separa frases para el resaltado automático. */
  phraseGapSeconds: .45,
} as const;

const FUNCTION_WORDS = new Set(`a al de del el la las lo los un una unos unas y o u e en con por para
que se es su sus tu te mi me ya no si sí le les nos ni`.split(/\s+/));

const STOP_WORDS = new Set([...FUNCTION_WORDS, ..."pero como más muy este esta esto eso esa ese estos estas todo toda todos todas hay hace hacer tiene tienen ser son está están porque cuando donde también entonces aquí así sobre entre hasta desde sin cada otro otra otros otras puede pueden vamos voy van fue era usted ustedes nosotros ellos ellas tú yo él ella ahí bien solo sólo".split(" ")]);

const NUMBER_WORDS = new Set("cero dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte veintiuno veintidós veintitrés veinticuatro veinticinco treinta cuarenta cincuenta sesenta setenta ochenta noventa cien ciento doscientos trescientos cuatrocientos quinientos seiscientos setecientos ochocientos novecientos mil millón millones billón billones doble triple mitad".split(" "));

/** Ortografía exacta de marcas que el reconocimiento suele escribir en minúscula. */
const CANONICAL: Record<string, string> = {
  segmenta: "Segmenta", chatgpt: "ChatGPT", openai: "OpenAI", tiktok: "TikTok", whatsapp: "WhatsApp",
  instagram: "Instagram", youtube: "YouTube", facebook: "Facebook", google: "Google", claude: "Claude",
  gemini: "Gemini", ia: "IA", ads: "Ads", linkedin: "LinkedIn", shopify: "Shopify", canva: "Canva", capcut: "CapCut",
};
const BRANDS = new Set([...Object.keys(CANONICAL).filter((key) => key !== "ads"), "meta"]);

const PUNCTUATION = /["“”«»(),.;:!¡…*_]/g;

export function normalizeWord(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(PUNCTUATION, "").replace(/[¿?]/g, "").toLowerCase().trim();
}

/** Texto que se dibuja: sin comillas ni puntuación, conservando ¿? como en la referencia. */
export function cleanKineticText(value: string) {
  return value.replace(PUNCTUATION, "").replace(/^[-–—]+|[-–—]+$/g, "").trim();
}

function syllableWeight(word: string) {
  const groups = normalizeWord(word).match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, groups) + (/\d/.test(word) ? word.replace(/\D/g, "").length * .6 : 0);
}

type Token = { raw: string; startSeconds: number; endSeconds: number; estimated: boolean; cueIndex: number };

/**
 * Tiempos por palabra de un subtítulo. Si el texto se corrigió y ya no coincide
 * con las palabras reconocidas, se reparte el tiempo por sílabas y se marca como estimado.
 */
export function cueTokens(cue: CaptionCue, cueIndex = 0): Token[] {
  const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !(cue.endSeconds > cue.startSeconds)) return [];
  const words = cue.words;
  if (words?.length === tokens.length && words.every((word) => Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds))) {
    return tokens.map((raw, index) => ({
      raw, cueIndex, estimated: false,
      startSeconds: words[index].startSeconds,
      endSeconds: Math.max(words[index].startSeconds, words[index].endSeconds),
    }));
  }
  const weights = tokens.map(syllableWeight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const span = cue.endSeconds - cue.startSeconds;
  let cursor = cue.startSeconds;
  return tokens.map((raw, index) => {
    const startSeconds = cursor;
    cursor += span * weights[index] / total;
    return { raw, cueIndex, estimated: true, startSeconds, endSeconds: cursor };
  });
}

function isNumberLike(normalized: string, raw: string) {
  return /\d/.test(raw) || raw.includes("%") || NUMBER_WORDS.has(normalized);
}

/**
 * Plan completo: una palabra por vez, tiempos de visibilidad y estilo de cada una.
 * Escribir una palabra entre asteriscos (*clave*) la fuerza a naranja.
 */
export function planKineticCaptions(cues: CaptionCue[], options: KineticPlanOptions = {}): KineticWord[] {
  const tokens = cues
    .map((cue, index) => ({ cue, index }))
    .sort((left, right) => left.cue.startSeconds - right.cue.startSeconds)
    .flatMap(({ cue, index }) => cueTokens(cue, index))
    .filter((token) => token.endSeconds - token.startSeconds >= .02 || token.estimated)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const keywords = new Set((options.keywords ?? []).map(normalizeWord).filter(Boolean));
  let insideMark = false;
  const prepared = tokens.map((token, index) => {
    const normalized = normalizeWord(token.raw);
    const nextNormalized = normalizeWord(tokens[index + 1]?.raw ?? "");
    let text = cleanKineticText(token.raw);
    const canonical = CANONICAL[normalized] ?? (normalized === "meta" && nextNormalized === "ads" ? "Meta" : undefined);
    if (canonical) text = text.replace(/[\p{L}\p{N}]+/u, canonical);
    // *una palabra* o *varias palabras seguidas* entre asteriscos van en naranja.
    const opens = /^[¿¡"“«(]*\*/.test(token.raw);
    const closes = /\*[?!.,;:)"”»]*$/.test(token.raw) && (!opens || token.raw.replace(/[^*]/g, "").length >= 2);
    const forced = insideMark || opens;
    if (opens && !closes) insideMark = true;
    if (closes) insideMark = false;
    const previousNormalized = normalizeWord(tokens[index - 1]?.raw ?? "");
    const brand = BRANDS.has(normalized) && (normalized !== "meta" || nextNormalized === "ads")
      || normalized === "ads" && ["meta", "google", "tiktok", "facebook", "linkedin"].includes(previousNormalized);
    const strong = forced || brand || keywords.has(normalized) || isNumberLike(normalized, token.raw);
    return { ...token, normalized, text, strong, light: !strong && FUNCTION_WORDS.has(normalized) && normalized.length <= 3 };
  }).filter((token) => token.text.length > 0);

  // Resaltado automático: una palabra clave por frase, sin saturar (≈1 de cada 5–8 palabras).
  const emphasis = new Set<number>();
  prepared.forEach((token, index) => { if (token.strong) emphasis.add(index); });
  if (options.autoEmphasis !== false) {
    const phrases: number[][] = [];
    prepared.forEach((token, index) => {
      const previous = prepared[index - 1];
      const breaks = !previous || token.startSeconds - previous.endSeconds > KINETIC_TIMING.phraseGapSeconds
        || /[.;:!?…]\*?$/.test(previous.raw);
      if (breaks) phrases.push([]);
      phrases[phrases.length - 1].push(index);
    });
    // Una frase larga sin pausas se reparte en tramos de ~6–7 palabras: un resaltado por tramo.
    const segments = phrases.flatMap((phrase) => {
      if (phrase.length <= 8) return [phrase];
      const parts = Math.ceil(phrase.length / 7);
      const size = Math.ceil(phrase.length / parts);
      return Array.from({ length: parts }, (_, part) => phrase.slice(part * size, (part + 1) * size)).filter((part) => part.length);
    });
    phrases.splice(0, phrases.length, ...segments);
    let lastEmphasis = -Infinity;
    for (const [phraseIndex, phrase] of phrases.entries()) {
      const existing = phrase.filter((index) => emphasis.has(index));
      if (existing.length) { lastEmphasis = Math.max(lastEmphasis, ...existing); continue; }
      const minimumWords = phraseIndex === 0 ? 2 : 4;
      if (phrase.length < minimumWords) continue;
      const candidates = phrase.filter((index) => !STOP_WORDS.has(prepared[index].normalized) && prepared[index].normalized.length >= 5);
      if (!candidates.length) continue;
      // Se prefiere el sustantivo o adjetivo que carga el sentido: palabras largas, nombres propios y
      // posiciones finales (la información nueva suele ir al final en español); los verbos pesan menos.
      const score = (index: number) => {
        const token = prepared[index];
        const verbLike = /(ar|er|ir|amos|emos|imos|aron|ieron|ando|iendo|aba|aban)$/.test(token.normalized);
        const properNoun = index !== phrase[0] && /^\p{Lu}/u.test(token.text);
        return token.normalized.length + (verbLike ? -6 : 0) + (properNoun ? 3 : 0) + 2 * (index - phrase[0]) / Math.max(1, phrase.length - 1);
      };
      const pick = candidates.reduce((best, index) => score(index) >= score(best) ? index : best, candidates[0]);
      if (pick - lastEmphasis < 5 && phraseIndex !== 0) continue;
      emphasis.add(pick);
      lastEmphasis = pick;
    }
  }

  const duration = options.durationSeconds;
  return prepared.map((token, index) => {
    const next = prepared[index + 1];
    const end = token.endSeconds;
    let visibleUntil = next && next.startSeconds - end <= KINETIC_TIMING.holdGapSeconds ? next.startSeconds : end + KINETIC_TIMING.tailSeconds;
    visibleUntil = Math.max(visibleUntil, token.startSeconds + KINETIC_TIMING.minVisibleSeconds);
    if (next) visibleUntil = Math.min(visibleUntil, next.startSeconds);
    if (duration !== undefined) visibleUntil = Math.min(visibleUntil, duration);
    const style: KineticStyle = emphasis.has(index) ? "enfasis" : token.light ? "ligera" : "normal";
    const text = options.uppercase ? token.text.toLocaleUpperCase("es") : token.text;
    return { text, startSeconds: token.startSeconds, endSeconds: visibleUntil, style, estimated: token.estimated };
  }).filter((word) => word.endSeconds - word.startSeconds >= 1 / 30 && (duration === undefined || word.startSeconds < duration));
}

/** Cifras de control de calidad para el informe del render. */
export function summarizeKineticPlan(words: KineticWord[]) {
  const emphasis = words.filter((word) => word.style === "enfasis").length;
  return {
    words: words.length,
    emphasis,
    estimated: words.filter((word) => word.estimated).length,
    emphasisRatio: words.length ? Number((emphasis / words.length).toFixed(3)) : 0,
  };
}
