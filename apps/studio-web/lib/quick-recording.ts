import { createHash } from "node:crypto";
import { z } from "zod";

const creationSchema = z.object({
  portfolioId: z.string().uuid().transform((value) => value.toLowerCase()),
  requestId: z.string().uuid().transform((value) => value.toLowerCase()),
  title: z.string().trim().max(160).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).optional(),
}).strict();

export class QuickRecordingError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export type QuickRecordingRow = Record<string, unknown>;
/** Insert-only operations ensure retries cannot reset scripts or selected takes. */
export interface QuickRecordingRepository {
  ownsPortfolio(ownerId: string, portfolioId: string): Promise<boolean>;
  getSession(ownerId: string, id: string): Promise<QuickRecordingRow | null>;
  insertSession(row: QuickRecordingRow): Promise<QuickRecordingRow>;
  listScenes(ownerId: string, sessionId: string): Promise<QuickRecordingRow[]>;
  insertScene(row: QuickRecordingRow): Promise<void>;
}

function deterministicId(namespace: string, requestId: string) {
  const bytes = createHash("sha256").update(JSON.stringify([namespace, requestId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function duplicate(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "23505";
}

function unavailable(): never {
  throw new QuickRecordingError("No se pudo preparar esta grabación. Abre una nueva desde la cámara.", 409);
}

function defaultTitle(now: Date) {
  return `Grabación · ${new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now)}`;
}

/** One durable camera destination for one request, even if the response was lost. */
export async function createQuickRecording(repository: QuickRecordingRepository, ownerId: string, input: unknown, now = new Date()) {
  const parsed = creationSchema.safeParse(input);
  if (!parsed.success) throw new QuickRecordingError("Revisa el portafolio y vuelve a abrir la cámara. El título admite hasta 160 caracteres.");
  const { portfolioId, requestId, title } = parsed.data;
  if (!await repository.ownsPortfolio(ownerId, portfolioId)) throw new QuickRecordingError("Ese portafolio no está disponible.", 404);
  // The request namespace is independent of owner and portfolio so accidental
  // cross-account/key reuse is rejected instead of creating two destinations.
  const id = deterministicId("segmenta-quick-recording-v1", requestId);
  const sceneId = deterministicId("segmenta-quick-recording-scene-v1", requestId);
  let session = await repository.getSession(ownerId, id);
  let reused = !!session;
  if (!session) {
    try {
      session = await repository.insertSession({ id, owner_id: ownerId, portfolio_id: portfolioId, title: title || defaultTitle(now), script: "", status: "recording" });
    } catch (error) {
      if (!duplicate(error)) throw error;
      session = await repository.getSession(ownerId, id);
      if (!session) unavailable();
      reused = true;
    }
  }
  if (session.id !== id || session.owner_id !== ownerId || session.portfolio_id !== portfolioId) unavailable();

  const findDestination = (scenes: QuickRecordingRow[]) => {
    if (scenes.some((scene) => scene.owner_id !== ownerId || scene.session_id !== id)) unavailable();
    const matches = scenes.filter((scene) => scene.id === sceneId);
    if (matches.length > 1) unavailable();
    return matches[0];
  };
  let scenes = await repository.listScenes(ownerId, id);
  let destination = findDestination(scenes);
  if (!destination) {
    // Only repair an incomplete creation. If a person has replaced the scene,
    // leave the edited project intact rather than adding a new blank scene.
    if (scenes.length) unavailable();
    try {
      await repository.insertScene({ id: sceneId, owner_id: ownerId, session_id: id, position: 0, title: "Grabación", script: "" });
    } catch (error) {
      if (!duplicate(error)) throw error;
    }
    scenes = await repository.listScenes(ownerId, id);
    destination = findDestination(scenes);
    // A hidden foreign primary-key collision is never exposed in this response.
    if (!destination) unavailable();
  }
  return { session, scenes: [destination], reused };
}

/** Bound streamed bodies too; Content-Length alone is not trustworthy. */
export async function readQuickRecordingInput(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new QuickRecordingError("Envía la grabación en formato JSON.", 415);
  const maximum = 4096;
  if (Number(request.headers.get("content-length") || 0) > maximum) throw new QuickRecordingError("La solicitud de grabación es demasiado grande.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new QuickRecordingError("La solicitud de grabación está vacía.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new QuickRecordingError("La solicitud de grabación es demasiado grande.", 413);
      }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(await new Blob(chunks).text()); }
  catch { throw new QuickRecordingError("No se pudo leer la grabación. Vuelve a intentarlo."); }
}
