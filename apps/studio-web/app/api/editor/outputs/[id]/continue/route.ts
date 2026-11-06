import { createClient } from "../../../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../../../lib/request-user";
import { toSession } from "../../../../../../lib/studio-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID.test(id)) return Response.json({ error: "Resultado inválido." }, { status: 400 });

  let copiedKey = "";
  let createdSessionId = "";
  try {
    const payload = await request.json() as Record<string, unknown>;
    const portfolioId = String(payload.portfolioId || "");
    const sourceSessionId = payload.sourceSessionId == null ? null : String(payload.sourceSessionId);
    const durationSeconds = Number(payload.durationSeconds);
    if (!UUID.test(portfolioId) || (sourceSessionId && !UUID.test(sourceSessionId)) || !Number.isFinite(durationSeconds) || durationSeconds < .2 || durationSeconds > 120) {
      return Response.json({ error: "Selecciona un portafolio y un video de máximo 2 minutos para continuar la edición." }, { status: 400 });
    }
    const supabase = await createClient();
    const ownedPortfolio = await supabase.from("kiko_portfolios").select("id").eq("id", portfolioId).eq("owner_id", user.userId).maybeSingle();
    if (ownedPortfolio.error) throw ownedPortfolio.error;
    if (!ownedPortfolio.data) return Response.json({ error: "No encontramos ese portafolio." }, { status: 404 });

    let sourceTitle = "Edición guardada";
    let sourceScript = "";
    if (sourceSessionId) {
      const sourceSession = await supabase.from("kiko_recording_sessions").select("title,script").eq("id", sourceSessionId).eq("owner_id", user.userId).maybeSingle();
      if (sourceSession.error) throw sourceSession.error;
      if (!sourceSession.data) return Response.json({ error: "No encontramos el proyecto original." }, { status: 404 });
      sourceTitle = String(sourceSession.data.title || sourceTitle);
      sourceScript = String(sourceSession.data.script || "");
    }

    const bucket = supabase.storage.from("kiko-videos");
    const folder = `${user.userId}/renders${sourceSessionId ? `/${sourceSessionId}` : ""}`;
    const filename = `${id}.mp4`;
    const listed = await bucket.list(folder, { search: filename, limit: 100 });
    if (listed.error) throw listed.error;
    const file = listed.data?.find((item) => item.name === filename && item.id && Number(item.metadata?.size || 0) > 0);
    if (!file) return Response.json({ error: "El MP4 ya no está en la biblioteca." }, { status: 404 });

    const sessionId = crypto.randomUUID();
    const sceneId = crypto.randomUUID();
    const takeId = crypto.randomUUID();
    copiedKey = `${user.userId}/${sessionId}/${sceneId}/${takeId}.mp4`;
    const copied = await bucket.copy(`${folder}/${filename}`, copiedKey);
    if (copied.error) throw copied.error;

    const session = await supabase.from("kiko_recording_sessions").insert({
      id: sessionId, owner_id: user.userId, portfolio_id: portfolioId,
      title: `Copia del MP4 · ${sourceTitle}`.slice(0, 160),
      script: sourceScript.trim() || "Edición manual de un video ya exportado.",
      status: "review_required",
    }).select().single();
    if (session.error) throw session.error;
    createdSessionId = sessionId;
    const scene = await supabase.from("kiko_scenes").insert({ id: sceneId, owner_id: user.userId, session_id: sessionId, position: 0, title: "Video exportado", script: "" });
    if (scene.error) throw scene.error;
    const take = await supabase.from("kiko_takes").insert({ id: takeId, owner_id: user.userId, session_id: sessionId, scene_id: sceneId, object_key: copiedKey, mime_type: "video/mp4", bytes: Number(file.metadata?.size), duration_ms: Math.round(durationSeconds * 1000), status: "pending" });
    if (take.error) throw take.error;
    return Response.json({ session: toSession(session.data), mode: "flattened" }, { status: 201 });
  } catch (error) {
    console.error("continue render failed", error);
    if (createdSessionId || copiedKey) {
      const supabase = await createClient();
      if (createdSessionId) await supabase.from("kiko_recording_sessions").delete().eq("id", createdSessionId).eq("owner_id", user.userId);
      if (copiedKey) await supabase.storage.from("kiko-videos").remove([copiedKey]);
    }
    return Response.json({ error: "No pudimos abrir una copia editable de este MP4." }, { status: 500 });
  }
}
