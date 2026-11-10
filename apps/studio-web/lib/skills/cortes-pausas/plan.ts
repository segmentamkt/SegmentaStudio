/**
 * Skill «Cortes y pausas» — planificación (sin efectos secundarios).
 *
 * Decide qué partes de una toma se conservan. Reglas aprobadas para Segmenta
 * (skill editor-segmenta, cortes.py):
 *  - Todo lo dicho antes de la primera palabra del guion se va (cuenta
 *    regresiva «3, 2, 1», «¿ya?», «listo»…), y lo dicho después de la última.
 *  - Se dejan 0,15 s antes de la primera palabra y 0,25 s después de la última.
 *  - Las pausas internas de hasta 0,70 s quedan INTACTAS (respiración, coma, sentido).
 *  - Las pausas de más de 0,70 s se acortan a 0,45 s (0,25 s de cola + 0,20 s de entrada).
 *  - Nunca se corta dentro de voz ni dentro de una palabra reconocida («Y sí» se conserva).
 *  - La voz no se acelera ni se ralentiza.
 */

export type Range = { start: number; end: number };
export type PlanWord = { text: string; startSeconds: number; endSeconds: number };

export const CUT_RULES = {
  preSeconds: .15,
  postSeconds: .25,
  maxPauseSeconds: .70,
  targetPauseSeconds: .45,
  /** Parte de la pausa acortada que queda después de la voz (el resto antes de la siguiente frase). */
  tailShare: .55,
  /** Separación mínima con una palabra descartada para no oír su final. */
  droppedWordGuardSeconds: .03,
  /** Una palabra reconocida nunca queda a menos de esto de un corte. */
  wordGuardSeconds: .05,
} as const;

export type CutPlanInput = {
  /** Ventana elegida por la persona (recorte manual), en segundos del archivo original. */
  window: Range;
  /** Silencios medidos en el audio (segundos del archivo original). */
  silences: Range[];
  hasAudio: boolean;
  /** Palabras reconocidas con sus tiempos (segundos del archivo original). */
  words?: PlanWord[];
  /** Libreto de la escena: lo que la persona debía decir. */
  script?: string;
};

export type CutPlan = {
  ranges: Range[];
  removedSeconds: number;
  /** Palabras descartadas antes del guion (p. ej. «tres dos uno»). */
  droppedLead: string[];
  /** Palabras descartadas después del guion (p. ej. «corta»). */
  droppedTail: string[];
  shortenedPauses: number;
  /** Cómo se encontró el inicio y fin del guion. */
  boundary: "libreto" | "vocabulario" | "audio" | "sin-audio";
  warnings: string[];
};

/** Preparación inequívoca antes de hablar. */
const PREP_WORDS = new Set("accion grabando grabamos dale ok okay vale empezamos arrancamos".split(" "));
/** Solo cuentan como preparación o cierre si se dicen como pregunta («¿ya?», «¿listo?», «¿quedó?»). */
const QUESTION_WORDS = new Set("ya listo lista listos va vamos bien quedo eso perfecto grabo grabando".split(" "));
const COUNTDOWN = ["cinco", "cuatro", "tres", "dos", "uno"];
const DIGIT_WORDS: Record<string, string> = { "5": "cinco", "4": "cuatro", "3": "tres", "2": "dos", "1": "uno" };
const TAIL_WORDS = new Set("corta corte cortar cortamos ok okay vale".split(" "));
const isQuestion = (raw: string) => /[?¿]/.test(raw);

export function normalizeToken(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]/g, "");
}

function tokensOf(text: string) {
  return text.split(/[\s,.;:!?¿¡"“”«»()…-]+/).map(normalizeToken).filter(Boolean)
    .map((token) => DIGIT_WORDS[token] ?? token);
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** Coincidencia tolerante a errores típicos del reconocimiento de voz. */
export function sameWord(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const shortest = Math.min(a.length, b.length);
  if (shortest >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (shortest >= 4 && editDistance(a, b) <= 1) return true;
  return shortest >= 8 && editDistance(a, b) <= 2;
}

const STRICT: number[][] = [[1, 1]];
const TOLERANT: number[][] = [[1, 1], [2, 2], [1, 2], [2, 1]];

/**
 * ¿Arranca aquí el libreto? Se exige una secuencia: primero la palabra siguiente
 * exacta (así «tres, dos, uno · Uno. OpenAI» ancla en el segundo «Uno») y, si no
 * hay ninguna, se tolera un error de reconocimiento.
 */
function anchorsAt(words: string[], index: number, script: string[], position: number, follow: number[][]) {
  if (!sameWord(words[index], script[position])) return false;
  if (script.length === 1 || index === words.length - 1) return true;
  return follow.some(([dw, ds]) => index + dw < words.length && position + ds < script.length && sameWord(words[index + dw], script[position + ds]));
}

function anchorsBackwards(words: string[], index: number, script: string[], position: number, follow: number[][]) {
  if (!sameWord(words[index], script[position])) return false;
  if (script.length === 1 || index === 0) return true;
  return follow.some(([dw, ds]) => index - dw >= 0 && position - ds >= 0 && sameWord(words[index - dw], script[position - ds]));
}

function findScriptStart(tokens: string[], script: string[]) {
  for (const follow of [STRICT, TOLERANT]) {
    const index = tokens.findIndex((_, position) => anchorsAt(tokens, position, script, 0, follow));
    if (index >= 0) return index;
  }
  // El reconocimiento perdió la primera palabra del libreto: se acepta la segunda solo al inicio.
  return script.length > 1 && anchorsAt(tokens, 0, script, 1, TOLERANT) ? 0 : -1;
}

function findScriptEnd(tokens: string[], script: string[], from: number) {
  for (const follow of [STRICT, TOLERANT]) {
    for (let index = tokens.length - 1; index >= from; index -= 1) {
      if (anchorsBackwards(tokens, index, script, script.length - 1, follow)) return index;
    }
  }
  return -1;
}

/**
 * El audio manda sobre los tiempos del reconocimiento. Whisper suele estirar el
 * final de una palabra dentro de la pausa siguiente (o adelantar el inicio de la
 * próxima): una palabra que empieza con voz termina, como tarde, donde empieza el
 * silencio medido; una que empieza dentro de un silencio y termina después empieza
 * donde termina el silencio. Las palabras completamente dentro de un silencio
 * (voz muy baja) se dejan como están para no perderlas.
 */
export function snapWordsToSilences<T extends PlanWord>(words: T[], silences: Range[]): T[] {
  if (!silences.length) return words;
  return words.map((word) => {
    let startSeconds = word.startSeconds;
    let endSeconds = word.endSeconds;
    for (const silence of silences) {
      if (silence.end <= startSeconds || silence.start >= endSeconds) continue;
      const startsInside = startSeconds >= silence.start;
      const endsInside = endSeconds <= silence.end;
      if (startsInside && endsInside) continue;
      if (!startsInside) endSeconds = Math.max(startSeconds + .02, silence.start);
      else startSeconds = Math.min(endSeconds - .02, silence.end);
    }
    return startSeconds === word.startSeconds && endSeconds === word.endSeconds ? word : { ...word, startSeconds, endSeconds };
  });
}

function mergeRanges(ranges: Range[]) {
  const sorted = ranges.filter((range) => range.end - range.start > 1e-3).sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1e-3) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Sin libreto: descarta la preparación inicial. Una cuenta regresiva necesita al
 * menos dos números descendentes («tres, dos, uno», también «3, 2, 1» reconocido
 * como una sola palabra): un número suelto puede ser guion («Tres razones…»,
 * «Uno. OpenAI…») y se conserva con un aviso.
 */
function leadByVocabulary(words: PlanWord[]): { index: number; warning?: string } {
  let index = 0;
  let countdownStep = -1;
  let countdownStart = -1;
  let countdownLength = 0;
  while (index < words.length) {
    const parts = tokensOf(words[index].text);
    const token = parts[0] ?? "";
    const steps = parts.map((part) => COUNTDOWN.indexOf(part));
    const descending = steps.every((step, position) => step >= 0 && (position === 0 ? countdownStep < 0 || step === countdownStep + 1 : step === steps[position - 1] + 1));
    const nextGap = index + 1 < words.length ? words[index + 1].startSeconds - words[index].endSeconds : Infinity;
    if (parts.length && descending) {
      if (countdownStep < 0) countdownStart = index;
      countdownStep = steps[steps.length - 1];
      countdownLength += steps.length;
      index += 1;
      continue;
    }
    if ((PREP_WORDS.has(token) || QUESTION_WORDS.has(token) && isQuestion(words[index].text)) && nextGap >= .3) { index += 1; continue; }
    break;
  }
  if (countdownLength === 1) {
    const lone = words[countdownStart].text.trim();
    return { index: countdownStart, warning: `Se conservó «${lone}» al inicio: puede ser guion o el final de una cuenta regresiva. Con el libreto de la escena se decide solo.` };
  }
  return { index };
}

function tailByVocabulary(words: PlanWord[], tokens: string[]) {
  let index = words.length;
  while (index > 0) {
    const token = tokens[index - 1];
    const gapBefore = index - 2 >= 0 ? words[index - 1].startSeconds - words[index - 2].endSeconds : 0;
    const closing = TAIL_WORDS.has(token) || QUESTION_WORDS.has(token) && isQuestion(words[index - 1].text);
    if (closing && gapBefore >= .4 && index - 1 > 0) { index -= 1; continue; }
    break;
  }
  return index;
}

/**
 * Plan de cortes de una toma. Devuelve los tramos a conservar (en segundos del
 * archivo original), qué se descartó y por qué.
 */
export function planCuts(input: CutPlanInput): CutPlan {
  const window = { start: Math.max(0, input.window.start), end: Math.max(input.window.start, input.window.end) };
  const span = window.end - window.start;
  const warnings: string[] = [];
  if (!input.hasAudio || span <= .2) {
    return { ranges: [window], removedSeconds: 0, droppedLead: [], droppedTail: [], shortenedPauses: 0, boundary: "sin-audio", warnings };
  }
  const silences = mergeRanges(input.silences.map((silence) => ({ start: Math.max(window.start, silence.start), end: Math.min(window.end, silence.end) })));
  const words = snapWordsToSilences((input.words ?? [])
    .filter((word) => word.text.trim() && Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds) && word.endSeconds > window.start && word.startSeconds < window.end)
    .sort((a, b) => a.startSeconds - b.startSeconds), silences);
  const tokens = words.map((word) => tokensOf(word.text)[0] ?? "");

  let first = 0;
  let last = words.length - 1;
  let boundary: CutPlan["boundary"] = "audio";
  if (words.length) {
    boundary = "vocabulario";
    const script = input.script ? tokensOf(input.script) : [];
    let anchoredStart = false;
    let anchoredEnd = false;
    if (script.length) {
      const start = findScriptStart(tokens, script);
      if (start >= 0) { first = start; anchoredStart = true; }
      const end = findScriptEnd(tokens, script, first);
      if (end >= 0) { last = end; anchoredEnd = true; }
      if (anchoredStart || anchoredEnd) boundary = "libreto";
      else warnings.push("El texto reconocido no coincide con el inicio ni el final del libreto; se usaron reglas de cuenta regresiva y colas.");
    }
    if (!anchoredStart) {
      const lead = leadByVocabulary(words);
      first = lead.index;
      if (lead.warning) warnings.push(lead.warning);
    }
    if (!anchoredEnd) last = tailByVocabulary(words, tokens) - 1;
    if (last < first) { first = 0; last = words.length - 1; warnings.push("No se pudo distinguir el guion de la preparación; se conserva toda la voz."); }
  }
  const droppedLead = words.slice(0, first).map((word) => word.text.trim());
  const droppedTail = words.slice(last + 1).map((word) => word.text.trim());

  // Islas de voz medidas en el audio (complemento de los silencios).
  const islands: Range[] = [];
  let cursor = window.start;
  for (const silence of silences) {
    if (silence.start > cursor) islands.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (window.end > cursor) islands.push({ start: cursor, end: window.end });

  let speechStart: number;
  let speechEnd: number;
  if (words.length) {
    speechStart = words[first].startSeconds;
    speechEnd = words[last].endSeconds;
  } else if (islands.length) {
    speechStart = islands[0].start;
    speechEnd = islands[islands.length - 1].end;
  } else {
    return { ranges: [window], removedSeconds: 0, droppedLead, droppedTail, shortenedPauses: 0, boundary, warnings: [...warnings, "No se detectó voz; la toma se conserva completa."] };
  }
  let keepStart = Math.max(window.start, speechStart - CUT_RULES.preSeconds);
  let keepEnd = Math.min(window.end, speechEnd + CUT_RULES.postSeconds);
  if (first > 0) keepStart = Math.max(keepStart, Math.min(speechStart, words[first - 1].endSeconds + CUT_RULES.droppedWordGuardSeconds));
  if (last < words.length - 1) keepEnd = Math.min(keepEnd, Math.max(speechEnd, words[last + 1].startSeconds - CUT_RULES.droppedWordGuardSeconds));
  if (keepEnd - keepStart < .2) {
    return { ranges: [window], removedSeconds: 0, droppedLead: [], droppedTail: [], shortenedPauses: 0, boundary, warnings: [...warnings, "El tramo con voz es demasiado corto; la toma se conserva completa."] };
  }

  // Pausas largas: se acortan a 0,45 s sin tocar ninguna palabra reconocida.
  const kept = words.slice(first, last + 1);
  const tail = CUT_RULES.targetPauseSeconds * CUT_RULES.tailShare;
  const entry = CUT_RULES.targetPauseSeconds - tail;
  const removals: Range[] = [];
  for (const silence of silences) {
    const start = Math.max(silence.start, keepStart);
    const end = Math.min(silence.end, keepEnd);
    if (end - start <= CUT_RULES.maxPauseSeconds) continue;
    let cutStart = start + tail;
    let cutEnd = end - entry;
    for (const word of kept) {
      // Tras ajustar al audio, solo quedan dentro de un silencio las palabras dichas muy bajo:
      // se respetan aunque la pausa quede algo más larga.
      if (word.endSeconds + CUT_RULES.wordGuardSeconds > cutStart && word.startSeconds - CUT_RULES.wordGuardSeconds < cutEnd) {
        if (word.startSeconds - start < end - word.endSeconds) cutStart = Math.max(cutStart, word.endSeconds + CUT_RULES.wordGuardSeconds + tail);
        else cutEnd = Math.min(cutEnd, word.startSeconds - CUT_RULES.wordGuardSeconds - entry);
      }
    }
    if (cutEnd - cutStart > .05) removals.push({ start: cutStart, end: cutEnd });
  }
  const ranges: Range[] = [];
  let position = keepStart;
  for (const removal of removals.sort((a, b) => a.start - b.start)) {
    if (removal.start > position) ranges.push({ start: position, end: removal.start });
    position = Math.max(position, removal.end);
  }
  if (keepEnd > position) ranges.push({ start: position, end: keepEnd });
  const finalRanges = mergeRanges(ranges).filter((range) => range.end - range.start > .04);
  const keptSeconds = finalRanges.reduce((sum, range) => sum + range.end - range.start, 0);
  if (droppedLead.length) warnings.push(`Se quitó lo dicho antes del guion: «${droppedLead.join(" ")}».`);
  if (droppedTail.length) warnings.push(`Se quitó lo dicho después del guion: «${droppedTail.join(" ")}».`);
  return {
    ranges: finalRanges.length ? finalRanges : [window],
    removedSeconds: Number(Math.max(0, span - keptSeconds).toFixed(3)),
    droppedLead, droppedTail,
    shortenedPauses: removals.length,
    boundary,
    warnings,
  };
}
