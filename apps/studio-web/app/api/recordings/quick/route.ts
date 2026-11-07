import { createClient } from "../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../lib/request-user";
import { toScene, toSession } from "../../../../lib/studio-data";
import { createQuickRecording, QuickRecordingError, readQuickRecordingInput, type QuickRecordingRepository } from "../../../../lib/quick-recording";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const input = await readQuickRecordingInput(request);
    const supabase = await createClient();
    const repository: QuickRecordingRepository = {
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
      async insertScene(row) {
        const { error } = await supabase.from("kiko_scenes").insert(row);
        if (error) throw error;
      },
    };
    const result = await createQuickRecording(repository, user.userId, input);
    return Response.json({ session: toSession(result.session), scenes: result.scenes.map(toScene), reused: result.reused }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof QuickRecordingError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Quick recording destination failed", error instanceof Error ? error.name : "database_error");
    return Response.json({ error: "No se pudo preparar la grabación. Reintenta: se conservará lo guardado y no se duplicará." }, { status: 503 });
  }
}
