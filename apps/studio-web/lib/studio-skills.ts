/**
 * Segmenta Studio's editable skill registry.
 *
 * Each active render skill writes to fields in kiko.edit-contract.v1 that the
 * current FFmpeg renderer reads. Planning and pending skills are recorded in
 * the manifest, but never reported as rendered effects.
 */

export const SKILL_IDS = [
  "director", "sonido", "efectos", "recortes", "edicion", "filtros",
  "generador", "superposiciones", "audio_fx", "subtitulos", "retoques",
  "narrativa", "transiciones", "clips",
] as const;

export type SkillId = (typeof SKILL_IDS)[number];
export type SkillValue = string | number | boolean;
export type SkillExecution = "render" | "partial" | "plan" | "pending";
export type SkillCategory = "dirección" | "imagen" | "audio" | "texto" | "entrega";

export type SkillSetting = {
  key: string;
  label: string;
  kind: "toggle" | "range" | "select";
  defaultValue: SkillValue;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  options?: Array<{ value: string; label: string }>;
  /** True when this setting is kept in the plan but not yet consumed by the cloud renderer. */
  plannedOnly?: boolean;
};

export type SkillDefinition = {
  id: SkillId;
  name: string;
  icon: string;
  category: SkillCategory;
  execution: SkillExecution;
  description: string;
  capability: string;
  defaultEnabled: boolean;
  defaultInstruction: string;
  settings: SkillSetting[];
};

const choice = (values: Array<[string, string]>) => values.map(([value, label]) => ({ value, label }));

export const SKILL_CATALOG: SkillDefinition[] = [
  {
    id: "director", name: "Director", icon: "🧠", category: "dirección", execution: "plan",
    description: "Coordina el objetivo, las tomas aprobadas y las decisiones de edición.",
    capability: "Conserva la prioridad editorial en el plan. La revisión creativa automática requiere un agente conectado.",
    defaultEnabled: true,
    defaultInstruction: "Prioriza claridad, una apertura que retenga y coherencia con la marca.",
    settings: [{ key: "priority", label: "Prioridad", kind: "select", defaultValue: "claridad", options: choice([["claridad", "Claridad"], ["ritmo", "Ritmo"], ["emocion", "Emoción"]]) }],
  },
  {
    id: "sonido", name: "Sonido y voz", icon: "🎚️", category: "audio", execution: "partial",
    description: "Comprime los picos de voz en el render; la música y el aislamiento fino requieren recursos adicionales.",
    capability: "El motor aplica compresión de voz. La música y el aislamiento quedan registrados como plan.",
    defaultEnabled: true,
    defaultInstruction: "Mantén la voz clara y presente. La música no debe competir con ella.",
    settings: [{ key: "musicRequested", label: "Solicitar música de fondo", kind: "toggle", defaultValue: false, plannedOnly: true }],
  },
  {
    id: "efectos", name: "Efectos visuales", icon: "✨", category: "imagen", execution: "partial",
    description: "Activa rótulos visuales. Mapas, iconos y gráficos contextuales requieren recursos propios.",
    capability: "Los rótulos de apertura se renderizan; los gráficos específicos se guardan como solicitud.",
    defaultEnabled: true,
    defaultInstruction: "Usa elementos visuales solo cuando ayuden a entender el mensaje.",
    settings: [{ key: "titleCards", label: "Rótulo de apertura", kind: "toggle", defaultValue: true }],
  },
  {
    id: "recortes", name: "Recortes y silencios", icon: "✂️", category: "dirección", execution: "partial",
    description: "Detecta y elimina silencios largos. Errores y muletillas requieren transcripción alineada.",
    capability: "El motor corta silencios medidos por audio. No identifica aún errores semánticos.",
    defaultEnabled: true,
    defaultInstruction: "Quita tiempos muertos sin cortar sílabas ni pausas que tengan intención.",
    settings: [
      { key: "removeSilence", label: "Quitar silencios", kind: "toggle", defaultValue: true },
      { key: "thresholdMs", label: "Silencio mínimo", kind: "range", defaultValue: 650, min: 350, max: 1500, step: 50, suffix: " ms" },
    ],
  },
  {
    id: "edicion", name: "Edición y encuadre", icon: "🎬", category: "imagen", execution: "render",
    description: "Define zoom y encuadre del video vertical.",
    capability: "Zoom y encuadre se aplican en el render.",
    defaultEnabled: true,
    defaultInstruction: "Usa un acercamiento sutil que conserve el rostro en cuadro.",
    settings: [
      { key: "zoomPercent", label: "Acercamiento", kind: "range", defaultValue: 3, min: 0, max: 10, step: 1, suffix: " %" },
      { key: "framing", label: "Encuadre", kind: "select", defaultValue: "fill", options: choice([["fill", "Llenar pantalla"], ["fit", "Mostrar todo"]]) },
    ],
  },
  {
    id: "filtros", name: "Color", icon: "🎨", category: "imagen", execution: "render",
    description: "Ajusta la intensidad de color del material.",
    capability: "La saturación se aplica directamente al video.",
    defaultEnabled: true,
    defaultInstruction: "Mantén tonos de piel naturales y una imagen consistente.",
    settings: [{ key: "saturation", label: "Saturación", kind: "range", defaultValue: 1.06, min: 0.7, max: 1.4, step: 0.01 }],
  },
  {
    id: "generador", name: "Imágenes generadas", icon: "🖼️", category: "imagen", execution: "pending",
    description: "Preparado para ilustraciones y B-roll aprobados por el creador.",
    capability: "Todavía no genera ni inserta imágenes en el render de Vercel.",
    defaultEnabled: false,
    defaultInstruction: "Propón imágenes simples que aclaren una idea del libreto.",
    settings: [{ key: "visualStyle", label: "Estilo deseado", kind: "select", defaultValue: "fotografia", options: choice([["fotografia", "Fotografía"], ["ilustracion", "Ilustración"], ["cinematico", "Cinematográfico"]]), plannedOnly: true }],
  },
  {
    id: "superposiciones", name: "Superposiciones", icon: "🧩", category: "imagen", execution: "partial",
    description: "Activa el título superpuesto; logo y marcos necesitan subir un recurso.",
    capability: "El título inicial se dibuja en el video. Logos y marcos no se insertan todavía.",
    defaultEnabled: true,
    defaultInstruction: "No tapes el rostro ni las zonas de interfaz de las redes.",
    settings: [{ key: "showTitle", label: "Mostrar título inicial", kind: "toggle", defaultValue: true }],
  },
  {
    id: "audio_fx", name: "Efectos de sonido", icon: "🔊", category: "audio", execution: "partial",
    description: "Acentos sonoros originales al abrir o cambiar de escena, según el estilo elegido.",
    capability: "El motor crea efectos procedimentales para cinco estilos en cambios de escena; no hay sonidos contextuales generados por IA ni biblioteca externa.",
    defaultEnabled: true,
    defaultInstruction: "Los acentos sonoros deben ser discretos y no competir con la voz.",
    settings: [
      { key: "enabled", label: "Sonido en cambios de toma", kind: "toggle", defaultValue: true },
      { key: "volume", label: "Intensidad", kind: "range", defaultValue: 0.35, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: "subtitulos", name: "Subtítulos", icon: "💬", category: "texto", execution: "partial",
    description: "Dibuja subtítulos sincronizados por toma; acepta voz transcrita localmente y archivos SRT/VTT.",
    capability: "La transcripción local en navegadores compatibles obtiene tiempos de voz. SRT y VTT también conservan sus tiempos tras recortes y silencios. Revisa el texto antes de exportar.",
    defaultEnabled: true,
    defaultInstruction: "Subtítulos breves, legibles y ubicados lejos del rostro.",
    settings: [
      { key: "enabled", label: "Mostrar subtítulos", kind: "toggle", defaultValue: true },
      { key: "maxWords", label: "Palabras por tarjeta", kind: "range", defaultValue: 4, min: 2, max: 8, step: 1 },
      { key: "size", label: "Tamaño", kind: "range", defaultValue: 64, min: 38, max: 100, step: 2 },
      { key: "position", label: "Posición", kind: "select", defaultValue: "bottom", options: choice([["top", "Arriba"], ["center", "Centro"], ["bottom", "Abajo"]]) },
      { key: "uppercase", label: "Mayúsculas", kind: "toggle", defaultValue: false },
    ],
  },
  {
    id: "retoques", name: "Retoques", icon: "🪄", category: "imagen", execution: "partial",
    description: "Ajusta el contraste. Suavizado y corrección de piel requieren otro motor.",
    capability: "El contraste se aplica al video; retoques de piel no están implementados.",
    defaultEnabled: true,
    defaultInstruction: "Mejora la imagen con cambios sutiles.",
    settings: [{ key: "contrast", label: "Contraste", kind: "range", defaultValue: 1.04, min: 0.8, max: 1.3, step: 0.01 }],
  },
  {
    id: "narrativa", name: "Narrativa", icon: "📖", category: "dirección", execution: "partial",
    description: "Compara el libreto completo con el texto hablado de cada toma y propone su orden.",
    capability: "Propone y aplica el orden al preparar la edición cuando la coincidencia con el texto hablado es suficiente. Señala huecos y repeticiones; requiere transcripción o SRT/VTT.",
    defaultEnabled: true,
    defaultInstruction: "Abre con la idea principal y conserva la progresión del libreto.",
    settings: [{ key: "structure", label: "Estructura buscada", kind: "select", defaultValue: "libreto", options: choice([["libreto", "Orden del libreto"], ["gancho", "Gancho primero"], ["problema", "Problema y solución"]]), plannedOnly: true }],
  },
  {
    id: "transiciones", name: "Transiciones", icon: "↔️", category: "imagen", execution: "partial",
    description: "Elige corte directo o fundido entre tomas. La disolución usa un fundido a negro en este motor.",
    capability: "El corte y el fundido se aplican entre tomas aprobadas. La disolución solicitada se representa como una transición breve a negro.",
    defaultEnabled: true,
    defaultInstruction: "Usa transiciones breves y solo donde faciliten la lectura del video.",
    settings: [
      { key: "type", label: "Tipo", kind: "select", defaultValue: "cut", options: choice([["cut", "Corte"], ["fade", "Fundido"], ["dissolve", "Fundido a negro"]]) },
      { key: "duration", label: "Duración", kind: "range", defaultValue: 0.18, min: 0.08, max: 0.8, step: 0.02, suffix: " s" },
    ],
  },
  {
    id: "clips", name: "Clips de un video largo", icon: "⚡", category: "entrega", execution: "pending",
    description: "Flujo previsto para encontrar ideas completas y producir clips independientes.",
    capability: "La extracción automática tipo Opus Clip todavía no está conectada al render de Vercel.",
    defaultEnabled: false,
    defaultInstruction: "Cada clip debe tener un gancho, una idea completa y un cierre claro.",
    settings: [{ key: "targetSeconds", label: "Duración objetivo", kind: "range", defaultValue: 45, min: 15, max: 90, step: 5, suffix: " s", plannedOnly: true }],
  },
];

export type SkillProfile = {
  id: SkillId;
  enabled: boolean;
  instruction: string;
  settings: Record<string, SkillValue>;
  /** Only changed settings override the chosen editorial style or editor controls. */
  overrides: string[];
};

export type SkillDecision = {
  skillId: SkillId;
  execution: SkillExecution;
  enabled: boolean;
  summary: string;
  appliedPaths: string[];
};

export type SkillDecisionManifest = {
  schema: "segmenta.skill-manifest.v1";
  decisions: SkillDecision[];
  configuredRenderSkills: SkillId[];
  plannedSkills: SkillId[];
};

export type SkillAwareContract = {
  objective: string;
  style_snapshot: {
    transition?: string;
    transitionDuration?: number;
    subtitle: Record<string, unknown>;
    execution: Record<string, unknown>;
    [key: string]: unknown;
  };
  captions: Record<string, unknown>;
  dead_air: Record<string, unknown>;
  effects: Record<string, unknown>;
  quality_gates?: Record<string, unknown>;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSetting(setting: SkillSetting, value: unknown): SkillValue {
  if (setting.kind === "toggle") return typeof value === "boolean" ? value : setting.defaultValue;
  if (setting.kind === "range") {
    const number = typeof value === "number" ? value : Number(value);
    const fallback = Number(setting.defaultValue);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(setting.max ?? number, Math.max(setting.min ?? number, number));
  }
  const selected = String(value ?? setting.defaultValue);
  return setting.options?.some((option) => option.value === selected) ? selected : setting.defaultValue;
}

export function defaultSkillProfiles(): SkillProfile[] {
  return SKILL_CATALOG.map((definition) => ({
    id: definition.id,
    enabled: definition.defaultEnabled,
    instruction: definition.defaultInstruction,
    settings: Object.fromEntries(definition.settings.map((setting) => [setting.key, setting.defaultValue])),
    overrides: [],
  }));
}

export function normalizeSkillProfiles(raw: unknown): SkillProfile[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.profiles) ? raw.profiles : [];
  const byId = new Map(list.filter(isRecord).map((item) => [item.id, item]));
  return SKILL_CATALOG.map((definition) => {
    const saved = byId.get(definition.id);
    const savedSettings = isRecord(saved?.settings) ? saved.settings : {};
    return {
      id: definition.id,
      enabled: typeof saved?.enabled === "boolean" ? saved.enabled : definition.defaultEnabled,
      instruction: typeof saved?.instruction === "string" ? saved.instruction.trim().slice(0, 1200) : definition.defaultInstruction,
      settings: Object.fromEntries(definition.settings.map((setting) => [setting.key, normalizeSetting(setting, savedSettings[setting.key])])),
      overrides: Array.isArray(saved?.overrides)
        ? saved.overrides.filter((key): key is string => typeof key === "string" && definition.settings.some((setting) => setting.key === key))
        : [],
    };
  });
}

export function skillStorageKey(portfolioId: string): string {
  return `segmenta.skill-profiles.v1:${portfolioId || "default"}`;
}

export function loadSkillProfiles(portfolioId: string): SkillProfile[] {
  if (typeof window === "undefined") return defaultSkillProfiles();
  try {
    const stored = window.localStorage.getItem(skillStorageKey(portfolioId));
    return stored ? normalizeSkillProfiles(JSON.parse(stored)) : defaultSkillProfiles();
  } catch {
    return defaultSkillProfiles();
  }
}

export function saveSkillProfiles(portfolioId: string, profiles: unknown): SkillProfile[] {
  const normalized = normalizeSkillProfiles(profiles);
  if (typeof window !== "undefined") window.localStorage.setItem(skillStorageKey(portfolioId), JSON.stringify({ version: 1, profiles: normalized }));
  return normalized;
}

function value(profile: SkillProfile, key: string): SkillValue {
  return profile.settings[key];
}

function changed(profile: SkillProfile, key: string): boolean {
  return profile.overrides.includes(key);
}

function decision(skillId: SkillId, execution: SkillExecution, enabled: boolean, summary: string, appliedPaths: string[] = []): SkillDecision {
  return { skillId, execution, enabled, summary, appliedPaths };
}

/**
 * Applies only supported settings to the renderer's existing contract fields.
 * The accompanying manifest lists every specialist and makes pending work
 * explicit. No external model is invoked by this function.
 */
export function applySkillProfilesToContract<T extends SkillAwareContract>(contract: T, rawProfiles: unknown): T & {
  skill_profiles: SkillProfile[];
  skill_manifest: SkillDecisionManifest;
} {
  const profiles = normalizeSkillProfiles(rawProfiles);
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const updated = {
    ...contract,
    style_snapshot: {
      ...contract.style_snapshot,
      subtitle: { ...contract.style_snapshot.subtitle },
      execution: { ...contract.style_snapshot.execution },
    },
    captions: { ...contract.captions },
    dead_air: { ...contract.dead_air },
    effects: { ...contract.effects },
    quality_gates: { ...(contract.quality_gates || {}) },
  } as T & { skill_profiles: SkillProfile[]; skill_manifest: SkillDecisionManifest };
  const decisions: SkillDecision[] = [];

  const director = byId.get("director")!;
  decisions.push(decision("director", "plan", director.enabled, director.enabled ? `Prioridad editorial: ${value(director, "priority")}. ${director.instruction}` : "Director desactivado."));

  const sonido = byId.get("sonido")!;
  decisions.push(decision("sonido", "partial", sonido.enabled, sonido.enabled
    ? `Voz normalizada por el motor. ${value(sonido, "musicRequested") ? "Música solicitada, aún sin pista ni mezcla automática." : "Sin música solicitada."}`
    : "Skill de sonido desactivada; el render base sigue normalizando voz."));

  const efectos = byId.get("efectos")!;
  if (!efectos.enabled) updated.style_snapshot.execution.titleCards = false;
  else if (changed(efectos, "titleCards")) updated.style_snapshot.execution.titleCards = value(efectos, "titleCards");
  decisions.push(decision("efectos", "partial", efectos.enabled, efectos.enabled ? "Rótulo visual de apertura según el estilo; gráficos contextuales pendientes." : "Efectos visuales desactivados.", !efectos.enabled || changed(efectos, "titleCards") ? ["style_snapshot.execution.titleCards"] : []));

  const recortes = byId.get("recortes")!;
  if (!recortes.enabled) updated.dead_air.remove = false;
  else if (changed(recortes, "removeSilence")) updated.dead_air.remove = value(recortes, "removeSilence") === true;
  if (recortes.enabled && changed(recortes, "thresholdMs")) updated.dead_air.threshold_ms = value(recortes, "thresholdMs");
  decisions.push(decision("recortes", "partial", recortes.enabled, recortes.enabled ? `Silencios según estilo${changed(recortes, "thresholdMs") ? `, umbral ${value(recortes, "thresholdMs")} ms` : ""}; errores semánticos pendientes.` : "No se recortarán silencios.", [...(!recortes.enabled || changed(recortes, "removeSilence") ? ["dead_air.remove"] : []), ...(recortes.enabled && changed(recortes, "thresholdMs") ? ["dead_air.threshold_ms"] : [])]));

  const edicion = byId.get("edicion")!;
  if (edicion.enabled && changed(edicion, "zoomPercent")) updated.style_snapshot.execution.zoomPercent = value(edicion, "zoomPercent");
  if (edicion.enabled && changed(edicion, "framing")) updated.style_snapshot.execution.framing = value(edicion, "framing");
  decisions.push(decision("edicion", "render", edicion.enabled, edicion.enabled ? "Zoom y encuadre según el estilo, con ajustes personalizados cuando se cambien." : "Se conserva el encuadre del estilo base.", edicion.enabled ? [...(changed(edicion, "zoomPercent") ? ["style_snapshot.execution.zoomPercent"] : []), ...(changed(edicion, "framing") ? ["style_snapshot.execution.framing"] : [])] : []));

  const filtros = byId.get("filtros")!;
  if (filtros.enabled && changed(filtros, "saturation")) updated.style_snapshot.execution.saturation = value(filtros, "saturation");
  decisions.push(decision("filtros", "render", filtros.enabled, filtros.enabled ? changed(filtros, "saturation") ? `Saturación ${value(filtros, "saturation")}.` : "Saturación según el estilo." : "Se conserva la saturación del estilo base.", filtros.enabled && changed(filtros, "saturation") ? ["style_snapshot.execution.saturation"] : []));

  const generador = byId.get("generador")!;
  const brollRequestedInEditor = updated.effects.images_or_broll === true;
  updated.effects.images_or_broll = false; // A plan must never claim that missing images were inserted.
  decisions.push(decision("generador", "pending", generador.enabled, generador.enabled ? `Imágenes ${value(generador, "visualStyle")} solicitadas; no se generan ni insertan aún.` : brollRequestedInEditor ? "B-roll solicitado en el editor; la inserción aún no está disponible." : "Generación de imágenes desactivada."));

  const superposiciones = byId.get("superposiciones")!;
  if (!superposiciones.enabled) updated.effects.labels = false;
  else if (changed(superposiciones, "showTitle")) updated.effects.labels = value(superposiciones, "showTitle") === true;
  decisions.push(decision("superposiciones", "partial", superposiciones.enabled, superposiciones.enabled ? "Título inicial según el estilo; logos y marcos requieren recursos." : "No se superpone título.", !superposiciones.enabled || changed(superposiciones, "showTitle") ? ["effects.labels"] : []));

  const audioFx = byId.get("audio_fx")!;
  if (!audioFx.enabled) updated.effects.sound_effects = false;
  else if (changed(audioFx, "enabled")) updated.effects.sound_effects = value(audioFx, "enabled") === true;
  if (audioFx.enabled && changed(audioFx, "volume")) updated.style_snapshot.execution.soundEffectVolume = value(audioFx, "volume");
  decisions.push(decision("audio_fx", "partial", audioFx.enabled, audioFx.enabled ? "Efectos sonoros procedimentales según el estilo, en cortes de tomas y silencios." : "Efectos de sonido desactivados.", [...(!audioFx.enabled || changed(audioFx, "enabled") ? ["effects.sound_effects"] : []), ...(audioFx.enabled && changed(audioFx, "volume") ? ["style_snapshot.execution.soundEffectVolume"] : [])]));

  const subtitulos = byId.get("subtitulos")!;
  if (!subtitulos.enabled) updated.captions.enabled = false;
  else if (changed(subtitulos, "enabled")) updated.captions.enabled = value(subtitulos, "enabled") === true;
  if (subtitulos.enabled) {
    if (changed(subtitulos, "maxWords")) updated.captions.max_words_per_card = value(subtitulos, "maxWords");
    if (changed(subtitulos, "size")) updated.style_snapshot.subtitle.size = value(subtitulos, "size");
    if (changed(subtitulos, "position")) updated.style_snapshot.subtitle.position = value(subtitulos, "position");
    if (changed(subtitulos, "uppercase")) updated.style_snapshot.subtitle.uppercase = value(subtitulos, "uppercase");
  }
  decisions.push(decision("subtitulos", "partial", subtitulos.enabled, subtitulos.enabled ? "Tarjetas de subtítulos basadas en el libreto; sincronía fina pendiente." : "Subtítulos desactivados.", [...(!subtitulos.enabled || changed(subtitulos, "enabled") ? ["captions.enabled"] : []), ...(subtitulos.enabled ? [["maxWords", "captions.max_words_per_card"], ["size", "style_snapshot.subtitle.size"], ["position", "style_snapshot.subtitle.position"], ["uppercase", "style_snapshot.subtitle.uppercase"]].filter(([key]) => changed(subtitulos, key)).map(([, path]) => path) : [])]));

  const retoques = byId.get("retoques")!;
  if (retoques.enabled && changed(retoques, "contrast")) updated.style_snapshot.execution.contrast = value(retoques, "contrast");
  decisions.push(decision("retoques", "partial", retoques.enabled, retoques.enabled ? changed(retoques, "contrast") ? `Contraste ${value(retoques, "contrast")}; retoque de piel pendiente.` : "Contraste según el estilo; retoque de piel pendiente." : "Se conserva el contraste del estilo base.", retoques.enabled && changed(retoques, "contrast") ? ["style_snapshot.execution.contrast"] : []));

  const narrativa = byId.get("narrativa")!;
  decisions.push(decision("narrativa", "plan", narrativa.enabled, narrativa.enabled ? `Estructura deseada: ${value(narrativa, "structure")}; el render mantiene el orden de escenas aprobado.` : "Se mantiene el orden aprobado sin instrucciones narrativas adicionales."));

  const transiciones = byId.get("transiciones")!;
  if (!transiciones.enabled) updated.effects.transitions = false;
  else if (changed(transiciones, "type")) updated.effects.transitions = value(transiciones, "type") !== "cut";
  if (transiciones.enabled && changed(transiciones, "type")) {
    updated.style_snapshot.transition = value(transiciones, "type") as string;
  }
  if (transiciones.enabled && changed(transiciones, "duration")) {
    updated.style_snapshot.transitionDuration = value(transiciones, "duration") as number;
  }
  decisions.push(decision("transiciones", "render", transiciones.enabled, transiciones.enabled ? changed(transiciones, "type") ? `Transición ${value(transiciones, "type")} de ${value(transiciones, "duration")} s.` : "Transiciones según el estilo y el editor." : "Cortes directos.", [...(!transiciones.enabled || changed(transiciones, "type") ? ["effects.transitions"] : []), ...(transiciones.enabled && changed(transiciones, "type") ? ["style_snapshot.transition"] : []), ...(transiciones.enabled && changed(transiciones, "duration") ? ["style_snapshot.transitionDuration"] : [])]));

  const clips = byId.get("clips")!;
  decisions.push(decision("clips", "pending", clips.enabled, clips.enabled ? `Se solicitan clips de ${value(clips, "targetSeconds")} s; extracción automática aún no disponible.` : "Extracción de clips desactivada."));

  updated.quality_gates!.captions = updated.captions.enabled;
  updated.quality_gates!.effects = Boolean(updated.effects.transitions || updated.effects.sound_effects || (updated.effects.labels && updated.style_snapshot.execution.titleCards !== false));
  updated.skill_profiles = profiles;
  updated.skill_manifest = {
    schema: "segmenta.skill-manifest.v1",
    decisions,
    configuredRenderSkills: decisions.filter((item) => item.enabled && item.appliedPaths.length > 0).map((item) => item.skillId),
    plannedSkills: decisions.filter((item) => item.enabled && (item.execution === "plan" || item.execution === "pending" || item.execution === "partial")).map((item) => item.skillId),
  };
  return updated;
}

export function buildSkillDecisionManifest(contract: SkillAwareContract, rawProfiles: unknown): SkillDecisionManifest {
  return applySkillProfilesToContract(contract, rawProfiles).skill_manifest;
}
