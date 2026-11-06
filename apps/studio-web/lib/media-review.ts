import { createHash } from "node:crypto";

export type MediaReviewStatus = "approved" | "rejected" | "blooper";
export type MediaReviewDecision = { takeId: string; status: MediaReviewStatus };
export type MediaReviewReceipt = {
  id: string;
  orderedTakeIds: string[];
  decisions: MediaReviewDecision[];
  confirmedAt: string;
  fingerprint: string;
};
export type MediaReview = MediaReviewReceipt;
export type MediaRow = Record<string, unknown>;
export const MEDIA_REVIEW_STATUSES = ["media_review", "media_review_stale"];
export const MEDIA_REVIEW_SCHEMA = "segmenta.media-review.v1";

export class MediaReviewError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "MediaReviewError"; }
}

function record(value: unknown): MediaRow | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as MediaRow : null;
}

function compareIds(left: MediaRow, right: MediaRow) { return String(left.id).localeCompare(String(right.id)); }

/** Deliberately ignores optional scripts/titles and editing preferences. */
export function mediaReviewFingerprint(sessionId: string, scenes: MediaRow[], takes: MediaRow[]) {
  const source = {
    sessionId,
    scenes: [...scenes].sort(compareIds).map((scene) => ({
      id: scene.id, ownerId: scene.owner_id, sessionId: scene.session_id,
      position: scene.position, selectedTakeId: scene.selected_take_id ?? null,
    })),
    takes: [...takes].sort(compareIds).map((take) => ({
      id: take.id, ownerId: take.owner_id, sessionId: take.session_id, sceneId: take.scene_id,
      status: take.status, objectKey: take.object_key, durationMs: take.duration_ms,
      bytes: take.bytes, mimeType: take.mime_type,
    })),
  };
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

export function validateMediaReviewSubmission(
  input: unknown, ownerId: string, sessionId: string, scenes: MediaRow[], takes: MediaRow[],
) {
  const payload = record(input);
  if (!payload || !Array.isArray(payload.decisions) || !Array.isArray(payload.orderedTakeIds)) {
    throw new MediaReviewError("Revisa cada toma y confirma el orden de las aprobadas.", 400);
  }
  if (!takes.length || takes.length > 500 || payload.decisions.length !== takes.length) {
    throw new MediaReviewError("Debes clasificar todas las tomas actuales del proyecto. Actualiza la revisión.");
  }
  const sceneIds = new Set<string>();
  for (const scene of scenes) {
    if (typeof scene.id !== "string" || sceneIds.has(scene.id) || scene.owner_id !== ownerId || scene.session_id !== sessionId) {
      throw new MediaReviewError("Una escena no pertenece a esta producción.", 400);
    }
    sceneIds.add(scene.id);
  }
  const takeById = new Map<string, MediaRow>();
  for (const take of takes) {
    if (typeof take.id !== "string" || takeById.has(take.id) || take.owner_id !== ownerId || take.session_id !== sessionId || !sceneIds.has(String(take.scene_id))) {
      throw new MediaReviewError("Una toma no pertenece a esta producción.", 400);
    }
    takeById.set(take.id, take);
  }
  const classified = new Set<string>();
  const approvedScenes = new Set<string>();
  const approvedIds = new Set<string>();
  const decisions: MediaReviewDecision[] = payload.decisions.map((value: unknown) => {
    const decision = record(value);
    if (!decision || typeof decision.takeId !== "string" || !takeById.has(decision.takeId) || classified.has(decision.takeId)) {
      throw new MediaReviewError("Cada toma del proyecto debe aparecer una sola vez en la revisión.", 400);
    }
    if (decision.status !== "approved" && decision.status !== "rejected" && decision.status !== "blooper") {
      throw new MediaReviewError("Hay tomas sin decidir. Marca cada una como aprobada, descartada o blooper.", 400);
    }
    classified.add(decision.takeId);
    if (decision.status === "approved") {
      const sceneId = String(takeById.get(decision.takeId)!.scene_id);
      if (approvedScenes.has(sceneId)) throw new MediaReviewError("Elige una sola toma aprobada por escena; clasifica también las alternativas.", 400);
      approvedScenes.add(sceneId);
      approvedIds.add(decision.takeId);
    }
    return { takeId: decision.takeId, status: decision.status };
  });
  const orderedTakeIds = payload.orderedTakeIds;
  if (approvedIds.size > 12 || orderedTakeIds.length !== approvedIds.size ||
      orderedTakeIds.some((id: unknown) => typeof id !== "string" || !approvedIds.has(id)) || new Set(orderedTakeIds).size !== approvedIds.size) {
    throw new MediaReviewError("Ordena todas las tomas aprobadas, sin repetirlas. Se admiten hasta 12.", 400);
  }
  return { decisions, orderedTakeIds: orderedTakeIds as string[] };
}

/** The intended database state, used to detect concurrent or partial updates before confirming. */
export function reviewedMediaRows(scenes: MediaRow[], takes: MediaRow[], submission: { decisions: MediaReviewDecision[]; orderedTakeIds: string[] }) {
  const statuses = new Map(submission.decisions.map((item) => [item.takeId, item.status]));
  const takesById = new Map(takes.map((take) => [String(take.id), take]));
  const selectedByScene = new Map(submission.orderedTakeIds.map((id) => [String(takesById.get(id)!.scene_id), id]));
  const sceneOrder = submission.orderedTakeIds.map((id) => String(takesById.get(id)!.scene_id));
  const remaining = [...scenes].sort((a, b) => Number(a.position) - Number(b.position) || compareIds(a, b)).filter((scene) => !selectedByScene.has(String(scene.id)));
  sceneOrder.push(...remaining.map((scene) => String(scene.id)));
  const ranks = new Map(sceneOrder.map((id, index) => [id, index]));
  return {
    scenes: scenes.map((scene): MediaRow => ({ ...scene, position: ranks.get(String(scene.id))!, selected_take_id: selectedByScene.get(String(scene.id)) ?? null })),
    takes: takes.map((take): MediaRow => ({ ...take, status: statuses.get(String(take.id))! })),
  };
}

export function mediaReviewFromRow(row: MediaRow | null): MediaReviewReceipt | null {
  const contract = record(row?.contract);
  if (!row || row.status !== "media_review" || typeof row.id !== "string" || contract?.schema !== MEDIA_REVIEW_SCHEMA ||
      !Array.isArray(contract.orderedTakeIds) || !contract.orderedTakeIds.every((id) => typeof id === "string") ||
      !Array.isArray(contract.decisions) || !contract.decisions.every((value) => {
        const decision = record(value);
        return decision && typeof decision.takeId === "string" && ["approved", "rejected", "blooper"].includes(String(decision.status));
      }) || typeof contract.confirmedAt !== "string" || !Number.isFinite(Date.parse(contract.confirmedAt)) ||
      typeof contract.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(contract.fingerprint)) return null;
  return { id: row.id, orderedTakeIds: contract.orderedTakeIds as string[], decisions: contract.decisions as MediaReviewDecision[], confirmedAt: contract.confirmedAt, fingerprint: contract.fingerprint };
}

export function isMediaReviewCurrent(review: MediaReviewReceipt | null, ownerId: string, sessionId: string, scenes: MediaRow[], takes: MediaRow[]) {
  if (!review || review.fingerprint !== mediaReviewFingerprint(sessionId, scenes, takes)) return false;
  try {
    const submission = validateMediaReviewSubmission(review, ownerId, sessionId, scenes, takes);
    const intended = reviewedMediaRows(scenes, takes, submission);
    return mediaReviewFingerprint(sessionId, intended.scenes, intended.takes) === review.fingerprint;
  } catch { return false; }
}

export function requireCurrentMediaReview(state: { review: MediaReviewReceipt | null; valid: boolean }, plannedReview?: unknown) {
  if (!state.valid || !state.review) throw new MediaReviewError("Antes de editar, revisa todas las tomas y confirma su orden en «Revisar tomas».");
  if (!state.review.orderedTakeIds.length) throw new MediaReviewError("La revisión está guardada, pero no hay tomas aprobadas para editar. Aprueba al menos una y confirma su orden en «Revisar tomas».");
  if (plannedReview !== undefined) {
    const receipt = record(plannedReview);
    if (!receipt || receipt.id !== state.review.id || receipt.fingerprint !== state.review.fingerprint) {
      throw new MediaReviewError("La selección o el orden se revisaron después de crear este plan. Prepara de nuevo la edición.");
    }
  }
  return state.review;
}

/** Approving a retake never silently classifies any of its alternatives. */
export function assertTakeCanBeApproved(takeId: string, sceneId: string, sceneTakes: MediaRow[]) {
  if (sceneTakes.some((take) => take.scene_id === sceneId && take.id !== takeId && take.status === "approved")) {
    throw new MediaReviewError("Esta escena ya tiene una toma aprobada. Clasifica la anterior o cambia la selección en «Revisar tomas».");
  }
}
