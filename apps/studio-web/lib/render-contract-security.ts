import { getEditorStyle, type EditorStyle } from "./editor-presets";
import { applySkillProfilesToContract } from "./studio-skills";

type Row = Record<string, unknown>;
type Transition = EditorStyle["transition"];
type SubtitlePosition = EditorStyle["subtitle"]["position"];

const MAX_CLIPS = 12;

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
  const currentScript = text(dbSession.script, "El libreto de la producción", 6_000, true);
  if (rawSession.script !== currentScript) throw new Error("El libreto cambió. Vuelve a preparar la edición antes de renderizar.");

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
  if (!Array.isArray(rawIds) || rawClips.length !== rawIds.length) {
    throw new Error("Las tomas del plan ya no coinciden con las aprobadas.");
  }
  const sceneByTake = new Map(selectedScenes.map((scene) => [scene.selected_take_id, scene]));
  let plannedDurationSeconds = 0;
  let captionCharacters = 0;
  let cueCharacters = 0;
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
    // Bound the edited intervals below, not unused footage in their originals.
    // The sequential renderer seeks to each interval before analysis/encoding.
    const transcript = text(requestedClip.transcript ?? scene.script, "El texto hablado de una escena", 1_000, true);
    captionCharacters += transcript.length;
    if (captionCharacters > 5_000) throw new Error("El libreto completo es demasiado largo para este render.");
    const trimStart = bounded(requestedClip.trim_start_seconds, 0, 0, Math.max(0, measuredMs / 1_000 - .2), "El inicio del recorte");
    const trimEnd = bounded(requestedClip.trim_end_seconds, measuredMs / 1_000, .2, measuredMs / 1_000, "El final del recorte");
    if (trimEnd - trimStart < .2) throw new Error("Cada toma debe conservar al menos 0,2 segundos.");
    const playbackSpeed = bounded(requestedClip.playback_speed, 1, .5, 2, "La velocidad de una toma");
    plannedDurationSeconds += (trimEnd - trimStart) / playbackSpeed;
    if (plannedDurationSeconds > 120) throw new Error("El video final supera los 120 segundos permitidos por render.");
    const rawCues = requestedClip.caption_cues ?? [];
    if (!Array.isArray(rawCues) || rawCues.length > 100) throw new Error("Hay demasiados subtítulos temporizados en una toma.");
    const captionCues = rowList(rawCues, "Los subtítulos temporizados").map((item) => {
      const startSeconds = bounded(item.startSeconds, 0, 0, measuredMs / 1_000, "El inicio de un subtítulo");
      const endSeconds = bounded(item.endSeconds, 0, 0, measuredMs / 1_000, "El final de un subtítulo");
      if (endSeconds - startSeconds < .1) throw new Error("Un subtítulo temporizado no tiene duración válida.");
      const cueText = text(item.text, "El texto de un subtítulo", 250);
      cueCharacters += cueText.length;
      if (cueCharacters > 5_000) throw new Error("Los subtítulos temporizados son demasiado largos.");
      return { startSeconds, endSeconds, text: cueText };
    });
    return {
      id: takeId,
      scene_id: sceneId,
      name: text(scene.title, "El título de una escena", 160),
      object_key: objectKey,
      duration_seconds: measuredMs / 1_000,
      transcript,
      trim_start_seconds: trimStart,
      trim_end_seconds: trimEnd,
      playback_speed: playbackSpeed,
      audio_volume: bounded(requestedClip.audio_volume, 1, 0, 2, "El volumen de una toma"),
      brightness: bounded(requestedClip.brightness, 0, -.2, .2, "El brillo de una toma"),
      contrast: bounded(requestedClip.contrast, 1, .8, 1.3, "El contraste de una toma"),
      saturation: bounded(requestedClip.saturation, 1, .5, 1.5, "La saturación de una toma"),
      label: text(requestedClip.label ?? "", "El rótulo de una escena", 120, true),
      caption_cues: captionCues,
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
  const noiseDb = bounded(requestedDeadAir.noise_db, -30, -35, -25, "La sensibilidad de silencio");
  if (![-35, -30, -25].includes(noiseDb)) throw new Error("La sensibilidad de silencio no es válida.");
  const soundEffectVolume = bounded(requestedExecution.soundEffectVolume, style.execution.soundEffectVolume, 0, 1, "El volumen de efectos");
  const soundPreset = oneOf(requestedExecution.soundPreset, "auto", ["auto", "none", "soft", "kinetic", "cinematic", "pop"] as const, "El tipo de efecto sonoro");
  const noiseReduction = oneOf(requestedExecution.noiseReduction, "off", ["off", "light", "medium"] as const, "La reducción de ruido");
  const zoomPercent = bounded(requestedExecution.zoomPercent, style.execution.zoomPercent, 0, 10, "El acercamiento");
  const contrast = bounded(requestedExecution.contrast, style.execution.contrast, 0.8, 1.3, "El contraste");
  const saturation = bounded(requestedExecution.saturation, style.execution.saturation, 0.7, 1.4, "La saturación");
  const framing = oneOf(requestedExecution.framing, style.execution.framing, ["fill", "fit"] as const, "El encuadre");
  const titleCards = flag(requestedExecution.titleCards, style.execution.titleCards, "El rótulo inicial");
  const styleSnapshot: EditorStyle = {
    ...style,
    transition, transitionDuration,
    subtitle: { ...style.subtitle, size: subtitleSize, position: subtitlePosition, uppercase: subtitleUppercase },
    execution: { ...style.execution, silenceThresholdMs, soundEffectVolume, soundPreset, noiseReduction, zoomPercent, contrast, saturation, framing, titleCards },
  };
  const captionsEnabled = flag(requestedCaptions.enabled, true, "Los subtítulos");
  if (captionsEnabled && clips.some((clip) => !clip.transcript)) {
    throw new Error("Falta el texto hablado de una o más tomas para generar todos los subtítulos.");
  }
  const qualityGates = optionalRow(contract.quality_gates, "Los controles de calidad");
  if (captionsEnabled && qualityGates.timed_captions === true && clips.some((clip) => !clip.caption_cues.length)) {
    throw new Error("Faltan subtítulos con tiempos reales. Vuelve a escuchar las tomas o importa SRT/VTT.");
  }
  const removeDeadAir = flag(requestedDeadAir.remove, true, "El corte de silencios");
  const transitions = flag(requestedEffects.transitions, true, "Las transiciones");
  const soundEffects = flag(requestedEffects.sound_effects, true, "Los efectos sonoros");
  const labels = flag(requestedEffects.labels, true, "Los títulos");
  if (flag(requestedEffects.images_or_broll, false, "Las imágenes B-roll") || flag(requestedEffects.music, false, "La música")) {
    throw new Error("Este motor todavía no admite imágenes B-roll ni música en el render.");
  }
  const baseContract = {
    schema: "kiko.edit-contract.v1" as const,
    objective: text(contract.objective, "La instrucción editorial", 2_000),
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
    dead_air: { remove: removeDeadAir, threshold_ms: silenceThresholdMs, noise_db: noiseDb },
    effects: { transitions, sound_effects: soundEffects, labels, images_or_broll: false, music: false },
    quality_gates: {
      portrait: true,
      audio: true,
      captions: captionsEnabled,
      timed_captions: captionsEnabled && qualityGates.timed_captions === true,
      effects: (transitions && transition !== "cut" && clips.length > 1) || (labels && (clips.some((clip) => clip.label) || (titleCards && !/^edici[oó]n de \d+ videos?$/i.test(String(dbSession.title))))),
    },
  };
  return applySkillProfilesToContract(baseContract, contract.skill_profiles);
}
