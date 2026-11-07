/** The destination of one capture is fixed before its countdown starts. */
export type RecordingTarget = Readonly<{
  sessionId: string;
  sceneId: string;
  sessionTitle: string;
  sceneTitle: string;
}>;

type RecordingRow = Record<string, unknown>;

export function captureRecordingTarget(
  session: RecordingRow | null | undefined,
  scene: RecordingRow | null | undefined,
): RecordingTarget {
  if (!session || !scene || typeof session.id !== "string" || !session.id.trim() ||
      typeof scene.id !== "string" || !scene.id.trim() || scene.sessionId !== session.id) {
    throw new Error("Selecciona una escena de esta producción antes de grabar.");
  }
  return Object.freeze({
    sessionId: session.id,
    sceneId: scene.id,
    sessionTitle: typeof session.title === "string" ? session.title : "Producción",
    sceneTitle: typeof scene.title === "string" ? scene.title : "Escena",
  });
}

/**
 * Locate the next scene still needing an approved take, in this production's
 * chronology. Wrap once to earlier unfinished scenes; never reorder the input
 * or jump to a different production. The just-saved scene can be excluded even
 * before its selectedTakeId arrives from the server.
 */
export function nextPendingRecordingScene<T extends RecordingRow>(
  scenes: readonly T[],
  sessionId: string,
  afterSceneId?: string,
): T | null {
  const ordered = scenes.map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => scene.sessionId === sessionId && typeof scene.id === "string" && scene.id.trim())
    .sort((left, right) => {
      const leftPosition = typeof left.scene.position === "number" && Number.isFinite(left.scene.position) ? left.scene.position : Number.MAX_SAFE_INTEGER;
      const rightPosition = typeof right.scene.position === "number" && Number.isFinite(right.scene.position) ? right.scene.position : Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition || left.index - right.index;
    });
  const afterIndex = afterSceneId ? ordered.findIndex(({ scene }) => scene.id === afterSceneId) : -1;
  const candidates = afterIndex >= 0
    ? [...ordered.slice(afterIndex + 1), ...ordered.slice(0, afterIndex)]
    : ordered;
  return candidates.find(({ scene }) => scene.id !== afterSceneId && !scene.selectedTakeId)?.scene ?? null;
}
