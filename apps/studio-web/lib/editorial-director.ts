/** Script-guided editorial suggestions. Scores express text overlap, not speech recognition. */
export type EditorialClip = { id: string; title: string; transcript: string };
export type ScriptBeat = { index: number; text: string };
export type ClipMatch = { clipId: string; beatIndex: number | null; score: number; confidence: "alta" | "media" | "baja"; sequenceOffset: number };
export type ResourceSuggestion = {
  id: string;
  beatIndex: number;
  kind: "rotulo" | "apoyo" | "cta";
  title: string;
  detail: string;
  generatedLabel: string | null;
  needsMedia: boolean;
};

const STOP_WORDS = new Set("a al de del el en es esta este la las le lo los o para por que se su sus tu un una unos unas y ya con como me mi nos nosotros te todo todos muy más mas pero así asi cuando donde sobre esta esto esas esos si no".split(" "));

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function splitScriptBeats(script: string): ScriptBeat[] {
  // Production scripts often contain episode metadata followed by quoted lines.
  // The spoken lines, rather than the metadata, define the story chronology.
  const quoted = [...script.matchAll(/«([^»]+)»/g)].map((match) => match[1].trim()).filter(Boolean);
  if (quoted.length >= 2) return quoted.slice(0, 36).map((text, index) => ({ index, text }));
  const paragraphs = script.trim().split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const lines = paragraphs.length > 1 ? paragraphs : script.trim().split(/\n/).map((part) => part.trim()).filter(Boolean);
  const pieces = lines.length > 1 ? lines : (script.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []);
  const beats = pieces.map((part) => part.replace(/^\s*(?:escena|toma)\s*\d+\s*[:.)-]?\s*/i, "").trim()).filter(Boolean);
  return beats.slice(0, 36).map((text, index) => ({ index, text }));
}

function sequenceOffset(spoken: string, beat: string) {
  const speech = tokens(spoken);
  const script = tokens(beat);
  let bestLength = 0;
  let bestOffset = script.length;
  for (let i = 0; i < script.length; i++) {
    for (let j = 0; j < speech.length; j++) {
      let length = 0;
      while (script[i + length] && script[i + length] === speech[j + length]) length++;
      if (length > bestLength || (length === bestLength && length > 0 && i < bestOffset)) {
        bestLength = length;
        bestOffset = i;
      }
    }
  }
  return bestOffset;
}

function similarity(a: string, b: string) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const common = left.filter((word) => rightSet.has(word)).length;
  const coverage = common / Math.min(left.length, right.length);
  const precision = common / Math.max(left.length, right.length);
  return Math.min(1, coverage * .7 + precision * .3);
}

function shortLabel(text: string) {
  const plain = text.replace(/^[¿¡\s]+|[.!?\s]+$/g, "").trim();
  const words = plain.split(/\s+/);
  return words.slice(0, 6).join(" ").slice(0, 56);
}

function resourceFor(beat: ScriptBeat): ResourceSuggestion[] {
  const content = normalize(beat.text);
  const suggestions: ResourceSuggestion[] = [];
  const add = (kind: ResourceSuggestion["kind"], title: string, detail: string, generatedLabel: string | null, needsMedia: boolean) => {
    suggestions.push({ id: `${beat.index}-${kind}-${suggestions.length}`, beatIndex: beat.index, kind, title, detail, generatedLabel, needsMedia });
  };
  if (/whatsapp|cotiza|contact|escrib|llama|reserva/.test(content)) {
    add("cta", "Cierre con llamada a la acción", "Rótulo visible en la toma final y acento sonoro breve.", "Escríbenos por WhatsApp", false);
  } else if (/cantidad|fecha|precio|valor|numero|personas/.test(content)) {
    add("rotulo", "Dato clave en pantalla", "Resalta la información que debe recordar el espectador.", shortLabel(beat.text), false);
  } else {
    add("rotulo", "Idea central en pantalla", "Rótulo breve generado a partir de este fragmento del libreto.", shortLabel(beat.text), false);
  }
  if (/lechona|plato|comida|producto|prepara|servicio|resultado/.test(content)) {
    add("apoyo", "Plano detalle del producto", "Usa una toma cercana y nítida del producto mientras se menciona.", null, true);
  } else if (/equipo|companero|cliente|evento|sitio|lugar|oficina/.test(content)) {
    add("apoyo", "Imagen de contexto", "Busca una toma propia del lugar o de las personas mencionadas.", null, true);
  }
  return suggestions;
}

export function planFromScript(script: string, clips: EditorialClip[]) {
  const beats = splitScriptBeats(script);
  const matches: ClipMatch[] = clips.map((clip) => {
    if (!clip.transcript.trim() || !beats.length) return { clipId: clip.id, beatIndex: null, score: 0, confidence: "baja", sequenceOffset: 0 };
    const scores = beats.map((beat) => similarity(clip.transcript, beat.text));
    const score = Math.max(...scores);
    const beatIndex = score >= .22 ? scores.indexOf(score) : null;
    return { clipId: clip.id, beatIndex, score: Number(score.toFixed(2)), confidence: score >= .5 ? "alta" : score >= .22 ? "media" : "baja", sequenceOffset: beatIndex === null ? 0 : sequenceOffset(clip.transcript, beats[beatIndex].text) };
  });
  const indexed = matches.filter((match) => match.beatIndex !== null);
  const suggestedClipIds = [...clips].sort((a, b) => {
    const left = matches.find((match) => match.clipId === a.id)!;
    const right = matches.find((match) => match.clipId === b.id)!;
    return (left.beatIndex ?? 999) - (right.beatIndex ?? 999) || left.sequenceOffset - right.sequenceOffset;
  }).map((clip) => clip.id);
  const used = new Set(indexed.map((match) => match.beatIndex));
  const missingBeats = beats.filter((beat) => !used.has(beat.index));
  const repeatedBeats = [...used].filter((index) => indexed.filter((match) => match.beatIndex === index).length > 1);
  const duplicateSpeech = repeatedBeats.some((index) => {
    const spoken = matches.filter((match) => match.beatIndex === index).map((match) => normalize(clips.find((clip) => clip.id === match.clipId)?.transcript || ""));
    return new Set(spoken).size !== spoken.length;
  });
  const missingShots: ResourceSuggestion[] = missingBeats.map((beat) => ({
    id: `${beat.index}-missing-shot`, beatIndex: beat.index, kind: "apoyo",
    title: `Falta cubrir la parte ${beat.index + 1}`,
    detail: `Graba o sube una toma que muestre: ${beat.text.slice(0, 100)}`,
    generatedLabel: null, needsMedia: true,
  }));
  const resources = [...missingShots, ...beats.flatMap(resourceFor)].slice(0, 24);
  return {
    beats, matches, suggestedClipIds, missingBeats, repeatedBeats, resources,
    reliableOrder: beats.length >= 2 && indexed.length >= 2 && indexed.length === clips.length && !duplicateSpeech && indexed.every((match) => match.confidence !== "baja"),
    transcriptCoverage: clips.length ? clips.filter((clip) => clip.transcript.trim()).length / clips.length : 0,
  };
}
