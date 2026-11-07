import { assertTakeCanBeApproved, type MediaRow } from "./media-review";

export type RegisteredTake = MediaRow & {
  id: string; owner_id: string; session_id: string; scene_id: string; object_key: string; status: string;
};

export interface TakeRegistrationRepository {
  getScene(ownerId: string, sessionId: string, sceneId: string): Promise<MediaRow | null>;
  getTake(ownerId: string, id: string): Promise<RegisteredTake | null>;
  listSceneTakes(ownerId: string, sceneId: string): Promise<MediaRow[]>;
  insertTake(row: RegisteredTake): Promise<RegisteredTake>;
  invalidateReview(ownerId: string, sessionId: string): Promise<void>;
  selectTakeIfEmpty(ownerId: string, sessionId: string, sceneId: string, takeId: string): Promise<void>;
}

export class TakeRegistrationError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}

function checkIdentity(existing: RegisteredTake, requested: RegisteredTake) {
  if (["id", "owner_id", "session_id", "scene_id", "object_key"].some((key) => existing[key] !== requested[key])) {
    throw new TakeRegistrationError("Esa toma ya está vinculada a otro video. Conserva la grabación e intenta guardarla de nuevo.");
  }
}

/** Stable IDs let a camera retry registration after the upload already finished. */
export async function registerUploadedTake(repository: TakeRegistrationRepository, requested: RegisteredTake) {
  const { owner_id: ownerId, session_id: sessionId, scene_id: sceneId, id } = requested;
  const scene = await repository.getScene(ownerId, sessionId, sceneId);
  if (!scene) throw new TakeRegistrationError("La escena no pertenece a este proyecto.", 404);
  let take = await repository.getTake(ownerId, id);
  let reused = !!take;
  let invalidated = false;
  if (take) checkIdentity(take, requested);
  else {
    if (requested.status === "approved") assertTakeCanBeApproved(id, sceneId, await repository.listSceneTakes(ownerId, sceneId));
    await repository.invalidateReview(ownerId, sessionId);
    invalidated = true;
    try { take = await repository.insertTake(requested); }
    catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "23505") throw error;
      // A concurrent retry can win the insert. Never upsert: the user may have
      // classified this take after the first request committed.
      take = await repository.getTake(ownerId, id);
      if (!take) throw new TakeRegistrationError("Este archivo ya está registrado con otra toma. Recarga las grabaciones para verlo.");
      checkIdentity(take, requested);
      reused = true;
    }
  }
  // Repair an insert that committed before scene selection failed. Only an
  // empty selection may be repaired; a later manual selection is preserved.
  if (take.status === "approved") {
    const current = await repository.getScene(ownerId, sessionId, sceneId);
    if (current && !current.selected_take_id) {
      assertTakeCanBeApproved(id, sceneId, await repository.listSceneTakes(ownerId, sceneId));
      if (!invalidated) await repository.invalidateReview(ownerId, sessionId);
      await repository.selectTakeIfEmpty(ownerId, sessionId, sceneId, id);
    }
  }
  return { take, reused };
}
