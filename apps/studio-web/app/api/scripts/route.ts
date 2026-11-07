import { createClient } from "../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../lib/request-user";
import { toScene, toSession } from "../../../lib/studio-data";
import { createImportedScriptProject, ScriptImportError, type ScriptImportRepository } from "../../../lib/script-import-persistence";
import { readScriptRequestBody, SCRIPT_JSON_MAX_BYTES } from "../../../lib/script-import-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      throw new ScriptImportError("Envía la carpeta en formato JSON.", 415);
    }
    const body = await readScriptRequestBody(request, SCRIPT_JSON_MAX_BYTES);
    let input: unknown;
    try { input = JSON.parse(await body.text()); }
    catch { throw new ScriptImportError("No se pudo leer la carpeta. Reintenta la importación."); }
    const supabase = await createClient();
    const repository: ScriptImportRepository = {
      async ownsPortfolio(ownerId, portfolioId) {
        const { data, error } = await supabase.from("kiko_portfolios").select("id").eq("id", portfolioId).eq("owner_id", ownerId).maybeSingle();
        if (error) throw error;
        return !!data;
      },
      async getSession(ownerId, id) {
        const { data, error } = await supabase.from("kiko_recording_sessions").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle();
        if (error) throw error;
        return data;
      },
      async insertSession(row) {
        const { data, error } = await supabase.from("kiko_recording_sessions").insert(row).select().single();
        if (error) throw error;
        return data;
      },
      async listScenes(ownerId, sessionId) {
        const { data, error } = await supabase.from("kiko_scenes").select("*").eq("session_id", sessionId).eq("owner_id", ownerId).order("position");
        if (error) throw error;
        return data || [];
      },
      async insertScenes(rows) {
        const { error } = await supabase.from("kiko_scenes").insert(rows);
        if (error) throw error;
      },
    };
    const result = await createImportedScriptProject(repository, user.userId, input);
    return Response.json({ session: toSession(result.session), scenes: result.scenes.map(toScene), reused: result.reused }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof ScriptImportError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Script folder import failed", error instanceof Error ? error.name : "database_error");
    return Response.json({ error: "No se pudo completar la carpeta. Reintenta: se conservará lo guardado y no se duplicará." }, { status: 503 });
  }
}
