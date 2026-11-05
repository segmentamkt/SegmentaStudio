import { getEditorStyle, type EditorStyle } from "./editor-presets";
import { applySkillProfilesToContract } from "./studio-skills";

type Row = Record<string, unknown>;
type Transition = EditorStyle["transition"];
type SubtitlePosition = EditorStyle["subtitle"]["position"];

const MAX_CLIPS = 12;
const MAX_KNOWN_DURATION_MS = 120_000;

function row(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} no tiene un formato válido.`);
  }
  return value as Row;
}

function rowList(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) throw new Error(`${label} no tiene un formato válido.`);
  return value.map((item) => row(item, label));
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${label} no es válido.`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} debe tener ${maximum} caracteres o menos.`);
  }
  return normalized;
}

function optionalRow(value: unknown, label: string): Row {
  return value === undefined || value === null ? {} : row(value, label);
}

function flag(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} no es válido.`);
  return value;
}

function bounded(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} debe estar entre ${minimum} y ${maximum}.`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, fallback: T, allowed: readonly T[], label: string): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label} no es válido.`);
  return value as T;
}

function durationMs(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Una toma tiene una duración no válida.");
  }
  return value;
}

/** Rebuilds the render contract from owned database rows; no client media path is trusted. */
export function normalizeRenderContract(raw: unknown, session: unknown, scenes: unknown, takes: unknown) {
  const contract = row(raw, "El contrato de edición");
  if (contract.schema !== "kiko.edit-contract.v1") throw new Error("La versión del contrato de edición no es compatible.");
  const dbSession = row(session, "La producción");
  const sessionId = text(dbSession.id, "El ID de la producción", 128);
  const ownerId = text(dbSession.owner_id, "El dueño de la producción", 128);
  const rawSession = row(contract.session, "La producción del contrato");
  if (rawSession.id !== sessionId) throw new Error("El plan no pertenece a esta producción.");

  const dbScenes = rowList(scenes, "Las escenas");
  const dbTakes = rowList(takes, "Las tomas");
  const takeById = new Map<string, Row>();
  for (const take of dbTakes) {
    const id = text(take.id, "El ID de una toma", 128);
    if (takeById.has(id)) throw new Error("Hay tomas duplicadas en la producción.");
    takeById.set(id, take);
  }
  const selectedScenes = dbScenes.filter((scene) => scene.selected_take_id !== null && scene.selected_take_id !== undefined);
  if (!selectedScenes.length) throw new Error("Aprueba al menos una toma antes de renderizar.");
  if (selectedScenes.length > MAX_CLIPS) throw new Error(`El render admite hasta ${MAX_CLIPS} tomas aprobadas.`);
  for (const scene of selectedScenes) {
    if (scene.session_id !== sessionId || scene.owner_id !== ownerId) throw new Error("Una escena no pertenece a esta producción.");
    if (typeof scene.position !== "number" || !Number.isSafeInteger(scene.position) || scene.position < 0) {
      throw new Error("El orden de una escena no es válido.");
    }
  }
  selectedScenes.sort((left, right) => Number(left.position) - Number(right.position));

  if (!Array.isArray(contract.clips) || !contract.clips.length || contract.clips.length > MAX_CLIPS) {
    throw new Error(`El contrato admite hasta ${MAX_CLIPS} clips.`);
  }
  const rawClips = rowList(contract.clips, "Los clips del contrato");
  const rawIds = contract.ordered_clip_ids;
  if (!Array.isArray(rawIds) || rawClips.length !== rawIds.length || new Set(rawIds).size !== rawIds.length) {
    throw new Error("Las tomas del plan ya no coinciden con las aprobadas.");
  }
  const sceneByTake = new Map(selectedScenes.map((scene) => [scene.selected_take_id, scene]));
  let knownDurationMs = 0;
  let captionCharacters = 0;
  const clips = rawClips.map((requestedClip, index) => {
    const scene = sceneByTake.get(rawIds[index]);
    if (!scene) throw new Error("El plan cambió o contiene una toma no autorizada. Vuelve a crear la edición.");
    const sceneId = text(scene.id, "El ID de una escena", 128);
    const takeId = text(scene.selected_take_id, "La toma seleccionada", 128);
    const take = takeById.get(takeId);
    if (!take || take.owner_id !== ownerId || take.session_id !== sessionId || take.scene_id !== sceneId || take.status !== "approved") {
      throw new Error("Una toma seleccionada ya no está aprobada para esta producción.");
    }
    const objectKey = text(take.object_key, "La ruta de una toma", 512);
    if (!objectKey.startsWith(`${ownerId}/${sessionId}/${sceneId}/`)) {
      throw new Error("La ruta de una toma no corresponde a esta producción.");
    }
    if (rawIds[index] !== takeId || requestedClip.id !== takeId || requestedClip.scene_id !== sceneId || requestedClip.object_key !== objectKey) {
      throw new Error("El plan cambió o contiene una ruta de video no autorizada. Vuelve a crear la edición.");
    }
    const measuredMs = durationMs(take.duration_ms);
    knownDurationMs += measuredMs;
    if (knownDurationMs > MAX_KNOWN_DURATION_MS) throw new Error("La duración conocida de las tomas supera los 120 segundos permitidos por render.");
    const transcript = text(requestedClip.transcript ?? scene.script, "El texto hablado de una escena", 1_000, true);
    captionCharacters += transcript.length;
    if (captionCharacters > 5_000) throw new Error("El libreto completo es demasiado largo para este render.");
    const trimStart = bounded(requestedClip.trim_start_seconds, 0, 0, Math.max(0, measuredMs / 1_000 - .2), "El inicio del recorte");
    const trimEnd = bounded(requestedClip.trim_end_seconds, measuredMs / 1_000, .2, measuredMs / 1_000, "El final del recorte");
    if (trimEnd - trimStart < .2) throw new Error("Cada toma debe conservar al menos 0,2 segundos.");
    return {
      id: takeId,
      scene_id: sceneId,
      name: text(scene.title, "El título de una escena", 160),
      object_key: objectKey,
      duration_seconds: measuredMs / 1_000,
      transcript,
      trim_start_seconds: trimStart,
      trim_end_seconds: trimEnd,
      label: text(requestedClip.label ?? "", "El rótulo de una escena", 120, true),
    };
  });

  const style = getEditorStyle(contract.style);
  const requestedStyle = optionalRow(contract.style_snapshot, "El estilo");
  const requestedSubtitle = optionalRow(requestedStyle.subtitle, "Los subtítulos");
  const requestedExecution = optionalRow(requestedStyle.execution, "Los ajustes");
  const requestedCaptions = optionalRow(contract.captions, "Los subtítulos");
  const requestedDeadAir = optionalRow(contract.dead_air, "Los silencios");
  const requestedEffects = optionalRow(contract.effects, "Los efectos");
  const transition = oneOf<Transition>(requestedStyle.transition, style.transition, ["cut", "fade", "dissolve"], "La transición");
  const transitionDuration = bounded(requestedStyle.transitionDuration, style.transitionDuration, transition === "cut" ? 0 : 0.08, 0.8, "La duración de transición");
  const subtitlePosition = oneOf<SubtitlePosition>(requestedSubtitle.position, style.subtitle.position, ["top", "center", "bottom"], "La posición de subtítulos");
  const subtitleSize = bounded(requestedSubtitle.size, style.subtitle.size, 38, 100, "El tamaño de subtítulos");
  const subtitleUppercase = flag(requestedSubtitle.uppercase, style.subtitle.uppercase, "Las mayúsculas de subtítulos");
  const maxWords = bounded(requestedCaptions.max_words_per_card, style.subtitle.maxWords, 2, 8, "Las palabras por subtítulo");
  const silenceThresholdMs = bounded(requestedExecution.silenceThresholdMs ?? requestedDeadAir.threshold_ms, style.execution.silenceThresholdMs, 350, 1_500, "El umbral de silencio");
  const soundEffectVolume = bounded(requestedExecution.soundEffectVolume, style.execution.soundEffectVolume, 0, 1, "El volumen de efectos");
  const soundPreset = oneOf(requestedExecution.soundPreset, "auto", ["auto", "none", "soft", "kinetic", "cinematic", "pop"] as const, "El tipo de efecto sonoro");
  const zoomPercent = bounded(requestedExecution.zoomPercent, style.execution.zoomPercent, 0, 10, "El acercamiento");
  const contrast = bounded(requestedExecution.contrast, style.execution.contrast, 0.8, 1.3, "El contraste");
  const saturation = bounded(requestedExecution.saturation, style.execution.saturation, 0.7, 1.4, "La saturación");
  const framing = oneOf(requestedExecution.framing, style.execution.framing, ["fill", "fit"] as const, "El encuadre");
  const titleCards = flag(requestedExecution.titleCards, style.execution.titleCards, "El rótulo inicial");
  const styleSnapshot: EditorStyle = {
    ...style,
    transition, transitionDuration,
    subtitle: { ...style.subtitle, size: subtitleSize, position: subtitlePosition, uppercase: subtitleUppercase },
    execution: { ...style.execution, silenceThresholdMs, soundEffectVolume, soundPreset, zoomPercent, contrast, saturation, framing, titleCards },
  };
  const captionsEnabled = flag(requestedCaptions.enabled, true, "Los subtítulos");
  const removeDeadAir = flag(requestedDeadAir.remove, true, "El corte de silencios");
  const transitions = flag(requestedEffects.transitions, true, "Las transiciones");
  const soundEffects = flag(requestedEffects.sound_effects, true, "Los efectos sonoros");
  const labels = flag(requestedEffects.labels, true, "Los títulos");
  if (flag(requestedEffects.images_or_broll, false, "Las imágenes B-roll") || flag(requestedEffects.music, false, "La música")) {
    throw new Error("Este motor todavía no admite imágenes B-roll ni música en el render.");
  }
  const baseContract = {
    schema: "kiko.edit-contract.v1" as const,
    objective: text(contract.objective, "La instrucción editorial", 500),
    session: {
      id: sessionId,
      title: text(dbSession.title, "El título de la producción", 160),
      script: text(dbSession.script, "El libreto de la producción", 6_000, true),
    },
    ordered_clip_ids: clips.map((clip) => clip.id),
    clips,
    style: style.id,
    style_snapshot: styleSnapshot,
    target_duration_seconds: null,
    captions: { enabled: captionsEnabled, language: "es" as const, max_words_per_card: maxWords, emphasis: true },
    dead_air: { remove: removeDeadAir, threshold_ms: silenceThresholdMs },
    effects: { transitions, sound_effects: soundEffects, labels, images_or_broll: false, music: false },
    quality_gates: {
      portrait: true,
      audio: true,
      captions: captionsEnabled,
      effects: (transitions && transition !== "cut" && clips.length > 1) || (labels && (titleCards || clips.some((clip) => clip.label))),
    },
  };
  return applySkillProfilesToContract(baseContract, contract.skill_profiles);
}
