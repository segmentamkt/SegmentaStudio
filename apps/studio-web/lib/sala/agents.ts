/**
 * Sala de edición — guion de los agentes.
 *
 * Convierte los planes REALES de las skills (Cortes y pausas, Subtítulos
 * cinéticos) en acciones visibles: cada agente tiene su carril y sus pasos se
 * ejecutan en pantalla (cursor, clic, cambio en la línea de tiempo). Nada se
 * inventa: si una skill no produce una acción, el agente no la muestra.
 * Código puro: corre en el navegador sobre el mismo audio y subtítulos que usa el render.
 */
import type { CaptionCue } from "../caption-cues";
import { planCuts, snapWordsToSilences, type CutPlan, type Range } from "../skills/cortes-pausas/plan";
import { planKineticCaptions, summarizeKineticPlan, type KineticWord } from "../skills/subtitulos-cineticos/plan";

export type AgentId = "director" | "cortes" | "subtitulos" | "sonido" | "qa";

export const SALA_AGENTS: Record<AgentId, { name: string; initials: string; role: string; color: string }> = {
  director: { name: "Director", initials: "DI", role: "Ordena las tomas, aplica el estilo y exporta", color: "#A78BFA" },
  cortes: { name: "Cortes y pausas", initials: "CP", role: "Quita cuentas regresivas y colas, acorta pausas largas", color: "#22D3EE" },
  subtitulos: { name: "Subtítulos cinéticos", initials: "SC", role: "Coloca cada palabra cuando se dice", color: "#FF7A00" },
  sonido: { name: "Sonido", initials: "SO", role: "Voz clara a 1,0× y acentos en cambios de escena", color: "#34D399" },
  qa: { name: "Control de calidad", initials: "QA", role: "Revisa sincronía, pausas y resaltados", color: "#F472B6" },
};

export const AGENT_ORDER: AgentId[] = ["director", "cortes", "subtitulos", "sonido", "qa"];

export type SalaClipInput = {
  id: string;
  title: string;
  /** Recorte manual de la toma, en segundos del archivo original. */
  window: Range;
  cues: CaptionCue[];
  script?: string;
  /** Silencios medidos (detección adaptativa) en segundos del archivo original. */
  silences: Range[];
  hasAudio: boolean;
};

export type AgentAction =
  | { kind: "style" }
  | { kind: "select-clip" }
  | { kind: "analyze"; silences: number }
  | { kind: "cut"; range: Range; reason: "inicio" | "pausa" | "cola" }
  | { kind: "word"; word: KineticWord }
  | { kind: "sound"; at: number; effect: "voz" | "acento" }
  | { kind: "check"; ok: boolean; at?: number }
  | { kind: "export" };

export type AgentStep = {
  id: string;
  agent: AgentId;
  clipIndex: number;
  action: AgentAction;
  label: string;
  /** Pasos que deben terminar antes de este (otro carril). */
  after?: string[];
};

export type SalaClipPlan = {
  cut: CutPlan;
  /** Tramos retirados dentro del recorte manual (segundos del archivo original). */
  removed: Range[];
  /** Palabras en segundos del archivo original, ya ajustadas al audio. */
  words: KineticWord[];
  keptSeconds: number;
};

export type SalaScript = { plans: SalaClipPlan[]; lanes: Record<AgentId, AgentStep[]>; totalSteps: number };

const seconds = (value: number) => `${value.toFixed(2).replace(".", ",")} s`;

function complement(window: Range, kept: Range[]): Range[] {
  const removed: Range[] = [];
  let cursor = window.start;
  for (const range of [...kept].sort((a, b) => a.start - b.start)) {
    if (range.start - cursor > .005) removed.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (window.end - cursor > .005) removed.push({ start: cursor, end: window.end });
  return removed;
}

function overlapShare(word: { startSeconds: number; endSeconds: number }, ranges: Range[]) {
  const length = Math.max(1e-3, word.endSeconds - word.startSeconds);
  return ranges.reduce((sum, range) => sum + Math.max(0, Math.min(range.end, word.endSeconds) - Math.max(range.start, word.startSeconds)), 0) / length;
}

/** Planes reales por toma: cortes de la skill y palabras cinéticas sobre lo que queda. */
export function planSalaClip(clip: SalaClipInput, options: { uppercase?: boolean } = {}): SalaClipPlan {
  const words = clip.cues.flatMap((cue) => cue.words ?? []);
  const cut = planCuts({ window: clip.window, silences: clip.silences, hasAudio: clip.hasAudio, words, script: clip.script });
  const removed = complement(clip.window, cut.ranges);
  const snappedCues = clip.cues.map((cue) => cue.words?.length ? { ...cue, words: snapWordsToSilences(cue.words, clip.silences) } : cue);
  const kinetic = planKineticCaptions(snappedCues, { uppercase: options.uppercase })
    .filter((word) => word.startSeconds >= clip.window.start - .05 && word.startSeconds < clip.window.end)
    // Una palabra descartada por la skill de cortes (cuenta regresiva, cola) no llega al video.
    .filter((word) => overlapShare(word, removed) < .5);
  const keptSeconds = cut.ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  return { cut, removed, words: kinetic, keptSeconds };
}

/** Guion completo: un carril por agente, con dependencias para que trabajen en paralelo sin pisarse. */
export function buildSalaScript(clips: SalaClipInput[], options: { styleName: string; uppercase?: boolean; soundEffects?: boolean }): SalaScript {
  const plans = clips.map((clip) => planSalaClip(clip, options));
  const lanes: Record<AgentId, AgentStep[]> = { director: [], cortes: [], subtitulos: [], sonido: [], qa: [] };
  const add = (step: AgentStep) => { lanes[step.agent].push(step); return step.id; };

  const styleStep = add({ id: "director-style", agent: "director", clipIndex: 0, action: { kind: "style" }, label: `Aplica el estilo «${options.styleName}»` });
  const clipReady: string[] = [];
  clips.forEach((clip, index) => {
    clipReady[index] = add({ id: `director-clip-${index}`, agent: "director", clipIndex: index, action: { kind: "select-clip" }, label: `Abre la toma ${index + 1}: ${clip.title}`, after: index === 0 ? [styleStep] : undefined });
  });

  const cutsDone: string[] = [];
  plans.forEach((plan, index) => {
    const clip = clips[index];
    let last = add({ id: `cortes-analyze-${index}`, agent: "cortes", clipIndex: index, after: [clipReady[index]],
      action: { kind: "analyze", silences: clip.silences.length },
      label: clip.hasAudio ? `Escucha la toma ${index + 1}: ${clip.silences.filter((silence) => silence.end - silence.start >= .35).length} silencios medidos` : `La toma ${index + 1} no tiene audio: se conserva completa` });
    plan.removed.forEach((range, cutIndex) => {
      const reason: "inicio" | "pausa" | "cola" = range.start <= clip.window.start + .005 ? "inicio" : range.end >= clip.window.end - .005 ? "cola" : "pausa";
      const lead = reason === "inicio" && plan.cut.droppedLead.length ? ` («${plan.cut.droppedLead.join(" ")}»)` : "";
      const tail = reason === "cola" && plan.cut.droppedTail.length ? ` («${plan.cut.droppedTail.join(" ")}»)` : "";
      const label = reason === "inicio" ? `Quita la espera inicial${lead}: ${seconds(range.end - range.start)}`
        : reason === "cola" ? `Quita la cola final${tail}: ${seconds(range.end - range.start)}`
        : `Acorta una pausa de ${seconds(range.end - range.start + .45)} a 0,45 s`;
      last = add({ id: `cortes-${index}-${cutIndex}`, agent: "cortes", clipIndex: index, action: { kind: "cut", range, reason }, label });
    });
    if (!plan.removed.length && clip.hasAudio) last = add({ id: `cortes-ok-${index}`, agent: "cortes", clipIndex: index, action: { kind: "check", ok: true }, label: "Sin tiempos muertos: todas las pausas son naturales (≤ 0,7 s)" });
    cutsDone[index] = last;
  });

  const wordsDone: string[] = [];
  plans.forEach((plan, index) => {
    let last = "";
    if (!plan.words.length) {
      last = add({ id: `subtitulos-none-${index}`, agent: "subtitulos", clipIndex: index, after: [clipReady[index]], action: { kind: "check", ok: false },
        label: `La toma ${index + 1} no tiene subtítulos con tiempos: genera los subtítulos primero` });
    }
    plan.words.forEach((word, wordIndex) => {
      const label = word.style === "enfasis" ? `Resalta «${word.text}» en naranja` : word.style === "ligera" ? `Coloca «${word.text}» en trazo fino` : `Coloca «${word.text}»`;
      last = add({ id: `subtitulos-${index}-${wordIndex}`, agent: "subtitulos", clipIndex: index, action: { kind: "word", word }, label,
        after: wordIndex === 0 ? [clipReady[index]] : undefined });
    });
    wordsDone[index] = last;
  });

  const soundDone: string[] = [];
  clips.forEach((clip, index) => {
    const start = plans[index].cut.ranges[0]?.start ?? clip.window.start;
    let last = add({ id: `sonido-voz-${index}`, agent: "sonido", clipIndex: index, after: [cutsDone[index]], action: { kind: "sound", at: start, effect: "voz" },
      label: clip.hasAudio ? "Voz a 1,0× con compresión suave: sin acelerar ni cambiar el tono" : "Toma sin audio: se añade silencio limpio" });
    if (options.soundEffects && index > 0) {
      last = add({ id: `sonido-acento-${index}`, agent: "sonido", clipIndex: index, action: { kind: "sound", at: start, effect: "acento" }, label: `Acento discreto al entrar en la toma ${index + 1}` });
    }
    soundDone[index] = last;
  });

  // El Director abre la siguiente toma solo cuando la anterior quedó cortada, subtitulada y con sonido.
  lanes.director.forEach((step) => {
    if (step.action.kind === "select-clip" && step.clipIndex > 0) {
      step.after = [cutsDone[step.clipIndex - 1], wordsDone[step.clipIndex - 1], soundDone[step.clipIndex - 1]].filter(Boolean);
    }
  });
  const everything = [...cutsDone, ...wordsDone, ...soundDone].filter(Boolean);
  plans.forEach((plan, index) => {
    const summary = summarizeKineticPlan(plan.words);
    const inPause = plan.words.filter((word) => overlapShare(word, plan.removed) > 0).length;
    const checks: Array<[boolean, string]> = [
      [inPause === 0, inPause === 0 ? "Ninguna palabra queda sobre un corte" : `${inPause} palabras tocan un corte: revisar`],
      [summary.estimated === 0, summary.estimated === 0 ? "Todas las palabras con tiempo real de la voz" : `${summary.estimated} palabras con tiempo estimado (texto editado)`],
      [summary.emphasisRatio <= .25, `Naranja en ${Math.round(summary.emphasisRatio * 100)} % de las palabras`],
      ...plan.cut.warnings.filter((warning) => !warning.startsWith("Se quitó")).map((warning): [boolean, string] => [false, warning]),
    ];
    checks.forEach(([ok, label], checkIndex) => add({ id: `qa-${index}-${checkIndex}`, agent: "qa", clipIndex: index, action: { kind: "check", ok }, label,
      after: checkIndex === 0 && index === 0 ? everything : undefined }));
  });
  add({ id: "director-export", agent: "director", clipIndex: Math.max(0, clips.length - 1), action: { kind: "export" },
    label: "Todo listo para exportar el MP4 con este plan", after: lanes.qa.length ? [lanes.qa[lanes.qa.length - 1].id] : everything });

  const totalSteps = Object.values(lanes).reduce((sum, steps) => sum + steps.length, 0);
  return { plans, lanes, totalSteps };
}
