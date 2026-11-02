type DbRow = Record<string, unknown>;

export function toAccount(row: DbRow) {
  return { id: row.id, ownerId: row.owner_id, name: row.name, handle: row.handle, createdAt: row.created_at };
}

export function toPortfolio(row: DbRow) {
  return { id: row.id, ownerId: row.owner_id, accountId: row.account_id, name: row.name, niche: row.niche, essence: row.essence, accent: row.accent, createdAt: row.created_at };
}

export function toSession(row: DbRow) {
  return { id: row.id, ownerId: row.owner_id, portfolioId: row.portfolio_id, title: row.title, script: row.script, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function toScene(row: DbRow) {
  return { id: row.id, ownerId: row.owner_id, sessionId: row.session_id, position: row.position, title: row.title, script: row.script, selectedTakeId: row.selected_take_id, createdAt: row.created_at };
}

export function toTake(row: DbRow) {
  return { id: row.id, ownerId: row.owner_id, sessionId: row.session_id, sceneId: row.scene_id, objectKey: row.object_key, mimeType: row.mime_type, bytes: Number(row.bytes || 0), durationMs: row.duration_ms, status: row.status, createdAt: row.created_at };
}

export function toEditJob(row: DbRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    style: row.style,
    objective: row.objective,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    contract: row.contract,
    resultObjectKey: row.result_object_key,
    resultMetadata: row.result_metadata,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function clean(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function scriptScenes(script: string) {
  const paragraphs = script.split(/\n\s*\n/).map((item) => item.replace(/^escena\s*\d*\s*[:.-]?\s*/i, "").trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  const lines = script.split("\n").map((item) => item.trim()).filter(Boolean);
  return lines.length > 1 ? lines : [script.trim() || "Video importado para edición."];
}
