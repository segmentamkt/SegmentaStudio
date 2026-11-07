import { createHash } from "node:crypto";
import { z } from "zod";
import { scriptWithProductionNotes } from "./script-import";

const sceneSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(80),
  script: z.string().trim().min(1).max(1_000),
});

export const scriptImportCreationSchema = z.object({
  portfolioId: z.string().uuid(),
  importId: z.string().uuid(),
  project: z.object({
    id: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(160),
    script: z.string().trim().min(1).max(6_000),
    notes: z.string().max(6_000).optional(),
    scenes: z.array(sceneSchema).min(1).max(12),
  }).superRefine((project, context) => {
    if (scriptWithProductionNotes(project).length > 6_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["script"], message: "El libreto y las indicaciones juntos admiten hasta 6.000 caracteres." });
    }
    if (new Set(project.scenes.map((scene) => scene.id)).size !== project.scenes.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenes"], message: "Cada escena debe tener un identificador distinto." });
    }
  }),
});

export type ScriptImportCreation = z.infer<typeof scriptImportCreationSchema>;
export type ImportRow = Record<string, unknown>;

export class ScriptImportError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

/** A narrowly scoped repository: imports never update or delete existing media. */
export interface ScriptImportRepository {
  ownsPortfolio(ownerId: string, portfolioId: string): Promise<boolean>;
  getSession(ownerId: string, id: string): Promise<ImportRow | null>;
  insertSession(row: ImportRow): Promise<ImportRow>;
  listScenes(ownerId: string, sessionId: string): Promise<ImportRow[]>;
  insertScenes(rows: ImportRow[]): Promise<void>;
}

function deterministicId(parts: string[]): string {
  const bytes = createHash("sha256").update(JSON.stringify(parts)).digest().subarray(0, 16);
  // RFC 9562 UUID version 8: application-defined deterministic SHA-256 namespace.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isDuplicate(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "23505";
}

function conflict(): never {
  throw new ScriptImportError("Esta carpeta ya se creó y su contenido cambió. Ábrela desde Grabaciones para conservar tus cambios y tus tomas.", 409);
}

function assertSame(row: ImportRow, expected: ImportRow, keys: string[]) {
  if (keys.some((key) => row[key] !== expected[key])) conflict();
}

function checkScenes(rows: ImportRow[], expected: ImportRow[]) {
  const expectedById = new Map(expected.map((row) => [row.id, row]));
  const seen = new Set<unknown>();
  for (const row of rows) {
    const draft = expectedById.get(row.id);
    if (!draft || seen.has(row.id)) conflict();
    seen.add(row.id);
    assertSame(row, draft, ["id", "owner_id", "session_id", "position", "title", "script"]);
  }
}

/** Retrying the same import resumes missing scenes without replacing recorded takes. */
export async function createImportedScriptProject(repository: ScriptImportRepository, ownerId: string, input: unknown) {
  const parsed = scriptImportCreationSchema.safeParse(input);
  if (!parsed.success) {
    throw new ScriptImportError("Revisa la carpeta: nombre de hasta 160 caracteres, 1–12 escenas de hasta 1.000 caracteres y libreto de hasta 6.000 caracteres.");
  }
  const { portfolioId, importId, project } = parsed.data;
  if (!await repository.ownsPortfolio(ownerId, portfolioId)) {
    throw new ScriptImportError("Ese portafolio no está disponible.", 404);
  }
  const id = deterministicId(["segmenta-script-import-v1", ownerId, portfolioId, importId, project.id]);
  const sessionValues = { id, owner_id: ownerId, portfolio_id: portfolioId, title: project.title, script: scriptWithProductionNotes(project), status: "recording" };
  let session = await repository.getSession(ownerId, id);
  let reused = !!session;
  if (!session) {
    try {
      session = await repository.insertSession(sessionValues);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      // Another click/request may have created the same project in the meantime.
      session = await repository.getSession(ownerId, id);
      if (!session) throw error;
      reused = true;
    }
  }
  assertSame(session, sessionValues, ["id", "owner_id", "portfolio_id", "title", "script"]);
  // Position-based IDs prevent concurrent revisions of the same draft from
  // creating two different sets of scenes. Database primary keys arbitrate.
  const expectedScenes = project.scenes.map((scene, position) => ({
    id: deterministicId(["segmenta-script-scene-v1", id, String(position)]),
    owner_id: ownerId, session_id: id, position, title: scene.title, script: scene.script,
  }));
  let scenes = await repository.listScenes(ownerId, id);
  checkScenes(scenes, expectedScenes);
  const existing = new Set(scenes.map((scene) => scene.id));
  const missing = expectedScenes.filter((scene) => !existing.has(scene.id));
  if (missing.length) {
    try {
      // One insert is atomic. No upsert: selected_take_id and every existing
      // scene stay untouched, even after timeouts or a concurrent retry.
      await repository.insertScenes(missing);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
    scenes = await repository.listScenes(ownerId, id);
    checkScenes(scenes, expectedScenes);
    if (scenes.length !== expectedScenes.length) {
      throw new ScriptImportError("La carpeta se guardó, pero faltan escenas. Reintenta para completar esta misma carpeta sin duplicarla.", 503);
    }
  }
  return { session, scenes: [...scenes].sort((a, b) => Number(a.position) - Number(b.position)), reused };
}
