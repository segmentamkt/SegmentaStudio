import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const MCP_VERSION = "2026-07-28";

type JsonRecord = Record<string, unknown>;
type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: JsonRecord };

const tools = [
  {
    name: "kiko_prepare_edit",
    description: "Convierte una intención editorial ya interpretada en un contrato de edición verificable para Kiko Studio. Úsalo antes de ejecutar el render.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["objective", "clips", "clip_order", "style"],
      properties: {
        objective: { type: "string", minLength: 3, description: "Resultado narrativo pedido por el usuario." },
        clips: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["id", "name", "duration_seconds"], properties: { id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, duration_seconds: { type: "number", exclusiveMinimum: 0 }, transcript: { type: "string" } } } },
        clip_order: { type: "array", minItems: 1, items: { type: "string" } },
        style: { type: "string", minLength: 1 },
        target_duration_seconds: { type: "number", exclusiveMinimum: 0 },
        captions: { type: "object", additionalProperties: false, properties: { enabled: { type: "boolean" }, language: { type: "string" }, max_words_per_card: { type: "integer", minimum: 1, maximum: 12 }, emphasis: { type: "boolean" } } },
        dead_air: { type: "object", additionalProperties: false, properties: { remove: { type: "boolean" }, threshold_ms: { type: "integer", minimum: 150, maximum: 3000 } } },
        effects: { type: "object", additionalProperties: false, properties: { transitions: { type: "boolean" }, sound_effects: { type: "boolean" }, images_or_broll: { type: "boolean" }, labels: { type: "boolean" }, music: { type: "boolean" } } },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "kiko_validate_timeline",
    description: "Audita una línea de tiempo antes del render: orden, huecos, subtítulos, efectos y cobertura del objetivo editorial.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["timeline", "requirements"],
      properties: {
        timeline: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["clip_id", "start_seconds", "end_seconds"], properties: { clip_id: { type: "string" }, start_seconds: { type: "number", minimum: 0 }, end_seconds: { type: "number", exclusiveMinimum: 0 }, caption_count: { type: "integer", minimum: 0 }, effect_count: { type: "integer", minimum: 0 }, transition: { type: "string" } } } },
        requirements: { type: "object", additionalProperties: false, properties: { captions_required: { type: "boolean" }, effects_required: { type: "boolean" }, transitions_required: { type: "boolean" }, max_gap_seconds: { type: "number", minimum: 0, maximum: 5 }, target_duration_seconds: { type: "number", exclusiveMinimum: 0 } } },
      },
    },
  },
  {
    name: "kiko_release_gate",
    description: "Decide si un render puede entregarse. Exige evidencia de archivo reproducible, imagen, audio y elementos editoriales solicitados.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["evidence", "requirements"],
      properties: {
        evidence: { type: "object", additionalProperties: false, required: ["file_exists", "playable", "duration_seconds", "width", "height", "has_audio"], properties: { file_exists: { type: "boolean" }, playable: { type: "boolean" }, duration_seconds: { type: "number", minimum: 0 }, width: { type: "integer", minimum: 0 }, height: { type: "integer", minimum: 0 }, has_audio: { type: "boolean" }, caption_count: { type: "integer", minimum: 0 }, effect_count: { type: "integer", minimum: 0 }, removed_silence_seconds: { type: "number", minimum: 0 }, output_path: { type: "string" } } },
        requirements: { type: "object", additionalProperties: false, properties: { captions_required: { type: "boolean" }, effects_required: { type: "boolean" }, portrait_required: { type: "boolean" }, min_duration_seconds: { type: "number", minimum: 0 } } },
      },
    },
  },
  {
    name: "kiko_diagnose_failure",
    description: "Clasifica un fallo del editor local y devuelve una reparación concreta y comprobable, sin afirmar que el video quedó editado.",
    inputSchema: { type: "object", additionalProperties: false, required: ["stage", "message"], properties: { stage: { type: "string", enum: ["upload", "transcription", "planning", "timeline", "render", "verification", "unknown"] }, message: { type: "string", minLength: 1 }, exit_code: { type: "integer" }, context: { type: "object" } } },
  },
] as const;

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toolResult(value: JsonRecord, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

function prepareEdit(args: JsonRecord) {
  const clips = Array.isArray(args.clips) ? args.clips.map(asObject) : [];
  const requestedOrder = Array.isArray(args.clip_order) ? args.clip_order.map(String) : [];
  const clipIds = new Set(clips.map((clip) => String(clip.id ?? "")));
  const order = requestedOrder.filter((id, index) => clipIds.has(id) && requestedOrder.indexOf(id) === index);
  const warnings: string[] = [];
  const missing = clips.map((clip) => String(clip.id ?? "")).filter((id) => id && !order.includes(id));
  if (missing.length) { order.push(...missing); warnings.push(`Se añadieron al final clips omitidos del orden: ${missing.join(", ")}.`); }
  const invalidIds = requestedOrder.filter((id) => !clipIds.has(id));
  if (invalidIds.length) warnings.push(`Se ignoraron identificadores inexistentes: ${invalidIds.join(", ")}.`);
  const captions = { enabled: true, language: "es", max_words_per_card: 6, emphasis: true, ...asObject(args.captions) };
  const deadAir = { remove: true, threshold_ms: 550, ...asObject(args.dead_air) };
  const effects = { transitions: true, sound_effects: true, images_or_broll: true, labels: true, music: false, ...asObject(args.effects) };
  const sourceDuration = clips.reduce((sum, clip) => sum + Number(clip.duration_seconds || 0), 0);
  const contract = {
    schema_version: "kiko.edit-contract.v1", status: order.length ? "ready" : "blocked", objective: String(args.objective ?? ""),
    style: String(args.style ?? "kiko-pro"), ordered_clip_ids: order, source_duration_seconds: Number(sourceDuration.toFixed(3)),
    target_duration_seconds: Number(args.target_duration_seconds || sourceDuration), captions, dead_air: deadAir, effects, notes: String(args.notes ?? ""),
    quality_gates: ["timeline_validated", "render_playable", "audio_present", captions.enabled ? "captions_present" : "captions_optional", Object.values(effects).some(Boolean) ? "effects_present" : "effects_optional"],
  };
  return toolResult({ contract, warnings, next_action: "Ejecutar este contrato en Kiko Studio y después llamar kiko_validate_timeline." });
}

function validateTimeline(args: JsonRecord) {
  const timeline = Array.isArray(args.timeline) ? args.timeline.map(asObject) : [];
  const req = asObject(args.requirements);
  const maxGap = Number(req.max_gap_seconds ?? 0.65);
  const errors: string[] = [];
  const warnings: string[] = [];
  let previousEnd = 0, captions = 0, effects = 0, transitions = 0;
  timeline.forEach((item, index) => {
    const start = Number(item.start_seconds ?? 0), end = Number(item.end_seconds ?? 0);
    if (end <= start) errors.push(`Segmento ${index + 1}: el final debe ser posterior al inicio.`);
    if (index > 0 && start < previousEnd - 0.01) errors.push(`Segmento ${index + 1}: se solapa con el anterior.`);
    if (index > 0 && start - previousEnd > maxGap) warnings.push(`Hay ${Number((start - previousEnd).toFixed(2))} s de vacío antes del segmento ${index + 1}.`);
    previousEnd = Math.max(previousEnd, end);
    captions += Number(item.caption_count ?? 0); effects += Number(item.effect_count ?? 0);
    if (String(item.transition ?? "").trim()) transitions += 1;
  });
  if (req.captions_required === true && captions === 0) errors.push("Se solicitaron subtítulos pero la línea de tiempo no contiene ninguno.");
  if (req.effects_required === true && effects === 0) errors.push("Se solicitaron efectos pero la línea de tiempo no contiene ninguno.");
  if (req.transitions_required === true && timeline.length > 1 && transitions === 0) errors.push("Se solicitaron transiciones pero no hay ninguna aplicada.");
  const target = Number(req.target_duration_seconds ?? 0);
  if (target > 0 && Math.abs(previousEnd - target) > Math.max(2, target * 0.2)) warnings.push(`La duración de la línea de tiempo (${previousEnd.toFixed(2)} s) se aleja del objetivo (${target.toFixed(2)} s).`);
  return toolResult({ ready: errors.length === 0, duration_seconds: Number(previousEnd.toFixed(3)), metrics: { segments: timeline.length, captions, effects, transitions }, errors, warnings, next_action: errors.length ? "Corregir la línea de tiempo antes de renderizar." : "Renderizar y llamar kiko_release_gate con evidencia del archivo final." });
}

function releaseGate(args: JsonRecord) {
  const evidence = asObject(args.evidence), req = asObject(args.requirements);
  const failures: string[] = [];
  if (evidence.file_exists !== true) failures.push("No existe el archivo de salida.");
  if (evidence.playable !== true) failures.push("El archivo no pasó la prueba de reproducción.");
  if (Number(evidence.duration_seconds ?? 0) <= Number(req.min_duration_seconds ?? 0)) failures.push("La duración final no supera el mínimo solicitado.");
  if (evidence.has_audio !== true) failures.push("El render no contiene una pista de audio válida.");
  if (req.captions_required === true && Number(evidence.caption_count ?? 0) < 1) failures.push("Faltan los subtítulos solicitados.");
  if (req.effects_required === true && Number(evidence.effect_count ?? 0) < 1) failures.push("Faltan los efectos solicitados.");
  if (req.portrait_required === true && Number(evidence.height ?? 0) <= Number(evidence.width ?? 0)) failures.push("La salida no está en formato vertical.");
  const passed = failures.length === 0;
  return toolResult({ passed, decision: passed ? "approved" : "rejected", failures, output_path: String(evidence.output_path ?? ""), message: passed ? "Render verificado. Puede presentarse al usuario como edición terminada." : "Render rechazado. No debe presentarse como edición terminada hasta resolver todos los fallos." });
}

function diagnoseFailure(args: JsonRecord) {
  const stage = String(args.stage ?? "unknown"), message = String(args.message ?? ""), lower = message.toLowerCase();
  let cause = "Fallo no clasificado", repair = "Conservar los originales, revisar el registro completo y repetir únicamente la etapa fallida.";
  if (lower.includes("subtitle") || lower.includes("caption") || lower.includes("subtít")) { cause = "Fallo en generación o incrustación de subtítulos"; repair = "Regenerar el archivo de subtítulos, validar tiempos y caracteres, y reintentar el render sin reprocesar los clips."; }
  else if (lower.includes("ffmpeg") || stage === "render") { cause = "Fallo del motor de render"; repair = "Validar codecs, dimensiones y pistas de cada entrada; aislar el clip incompatible y reanudar desde el render."; }
  else if (lower.includes("audio") || lower.includes("sound")) { cause = "Fallo de audio o mezcla"; repair = "Comprobar pistas, frecuencia de muestreo y niveles; normalizar a un formato común antes de mezclar."; }
  else if (lower.includes("timeout") || lower.includes("offline") || lower.includes("connection")) { cause = "Servicio local no disponible"; repair = "Comprobar que Kiko Studio y su trabajador local estén activos; mantener el trabajo en cola y reintentar sin duplicarlo."; }
  else if (stage === "transcription") { cause = "Transcripción incompleta"; repair = "Confirmar que el audio sea legible, retranscribir el clip afectado y bloquear la edición si no existe un libreto fiable."; }
  return toolResult({ stage, cause, repair, retry_from: stage, preserve_originals: true, original_message: message });
}

function callTool(name: string, args: JsonRecord) {
  switch (name) {
    case "kiko_prepare_edit": return prepareEdit(args);
    case "kiko_validate_timeline": return validateTimeline(args);
    case "kiko_release_gate": return releaseGate(args);
    case "kiko_diagnose_failure": return diagnoseFailure(args);
    default: return toolResult({ error: `Herramienta desconocida: ${name}` }, true);
  }
}

function rpcResponse(id: RpcRequest["id"], result?: unknown, error?: JsonRecord) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, ...(error ? { error } : { result }) }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function handleMcp(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS" } });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS" } });
  let body: RpcRequest;
  try { body = (await request.json()) as RpcRequest; }
  catch { return rpcResponse(null, undefined, { code: -32700, message: "Invalid JSON" }); }
  if (body.method === "server/discover") return rpcResponse(body.id, { name: "Kiko Video Director", version: "1.0.0", supportedVersions: [MCP_VERSION], capabilities: { tools: {} } });
  if (body.method === "initialize") return rpcResponse(body.id, { protocolVersion: MCP_VERSION, capabilities: { tools: {} }, serverInfo: { name: "Kiko Video Director", version: "1.0.0" } });
  if (body.method === "notifications/initialized") return new Response(null, { status: 204 });
  if (body.method === "tools/list") return rpcResponse(body.id, { tools });
  if (body.method === "tools/call") { const params = asObject(body.params); return rpcResponse(body.id, callTool(String(params.name ?? ""), asObject(params.arguments))); }
  return rpcResponse(body.id, undefined, { code: -32601, message: `Method not found: ${body.method ?? ""}` });
}

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return handleMcp(request);
    if (url.pathname === "/api/health") return Response.json({ ok: true, service: "Kiko Video Director", protocol: MCP_VERSION, tools: tools.map((tool) => tool.name) });
    let binding = ctx.props?.CONNECTORS;
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS, expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() { if (Date.now() >= expiresAt) return { status: "request_context_expired" }; return preview.getContext?.() ?? { status: "binding_unavailable" }; },
        async invoke(connectorId, actionName, args) { if (Date.now() >= expiresAt) return { status: "request_context_expired", message: "This request has expired. Please try again." }; return preview.invoke(connectorId, actionName, args); },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;
