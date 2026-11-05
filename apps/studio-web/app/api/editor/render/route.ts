import { createClient } from "../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../lib/request-user";
import { renderCloudEdit, verifyCloudRender } from "../../../../lib/cloud-video-renderer";
import { normalizeRenderContract } from "../../../../lib/render-contract-security";
import { clean, toEditJob } from "../../../../lib/studio-data";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  const supabase = await createClient();
  let jobId = "";
  try {
    const payload = await request.json() as Record<string, unknown>;
    jobId = clean(payload.jobId);
    const temporaryJob = payload.job && typeof payload.job === "object" ? payload.job as Record<string, unknown> : null;
    const ephemeral = temporaryJob?.ephemeral === true && temporaryJob.ownerId === user.userId && temporaryJob.id === jobId;
    const job = ephemeral ? null : await supabase.from("kiko_edit_jobs").select("*").eq("id", jobId).eq("owner_id", user.userId).maybeSingle();
    if (job?.error) throw job.error;
    if (!ephemeral && !job?.data) return Response.json({ error: "No encontramos ese trabajo de edición." }, { status: 404 });
    const sessionId = clean(ephemeral ? temporaryJob?.sessionId : job?.data?.session_id);
    if (!sessionId) return Response.json({ error: "El plan no identifica una producción." }, { status: 400 });
    const [production, scenes, takes] = await Promise.all([
      supabase.from("kiko_recording_sessions").select("*").eq("id", sessionId).eq("owner_id", user.userId).maybeSingle(),
      supabase.from("kiko_scenes").select("*").eq("session_id", sessionId).eq("owner_id", user.userId).order("position"),
      supabase.from("kiko_takes").select("*").eq("session_id", sessionId).eq("owner_id", user.userId).eq("status", "approved"),
    ]);
    if (production.error || scenes.error || takes.error) throw production.error || scenes.error || takes.error;
    if (!production.data) return Response.json({ error: "La producción ya no existe." }, { status: 404 });
    const contract = normalizeRenderContract(ephemeral ? temporaryJob?.contract : job?.data?.contract, production.data, scenes.data, takes.data);
    const objectKeys = contract.clips.map((clip) => clip.object_key);
    const signed = await supabase.storage.from("kiko-videos").createSignedUrls(objectKeys, 3600);
    if (signed.error) throw signed.error;
    const signedUrls = (signed.data || []).map((item) => item.signedUrl).filter((url): url is string => Boolean(url));
    if (signedUrls.length !== objectKeys.length) throw new Error("No pudimos abrir todas las tomas del proyecto.");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return unauthorized();
    const update = async (progress: number, stage: string) => {
      if (ephemeral) return;
      const result = await supabase.from("kiko_edit_jobs").update({ status: "processing", progress, stage, error: null, updated_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", user.userId);
      if (result.error) throw result.error;
    };
    const outputObjectKey = `${user.userId}/renders/${jobId}.mp4`;
    const evidence = await renderCloudEdit({
      contract,
      signedUrls,
      outputObjectKey,
      accessToken: session.access_token,
      projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      onProgress: update,
    });
    if (!evidence.release_gate.passed) throw new Error("El control de calidad rechazó el render porque faltan elementos solicitados.");
    const link = await supabase.storage.from("kiko-videos").createSignedUrl(outputObjectKey, 3600);
    if (link.error) throw link.error;
    await update(96, "Comprobando video y audio del MP4");
    const verification = await verifyCloudRender(link.data.signedUrl);
    if (verification.width !== 1080 || verification.height !== 1920) throw new Error("El MP4 final no conserva el formato vertical 1080 × 1920.");
    const verifiedEvidence = { ...evidence, ...verification, release_gate: { passed: true } };
    if (ephemeral) {
      return Response.json({ job: { ...temporaryJob, status: "ready", stage: "Edición verificada", progress: 100, resultObjectKey: outputObjectKey, resultMetadata: verifiedEvidence, resultUrl: link.data.signedUrl, error: null } });
    }
    const completed = await supabase.from("kiko_edit_jobs").update({
      status: "ready", stage: "Edición verificada", progress: 100,
      result_object_key: outputObjectKey, result_metadata: verifiedEvidence, error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId).eq("owner_id", user.userId).select().single();
    if (completed.error) throw completed.error;
    return Response.json({ job: toEditJob(completed.data) });
  } catch (error) {
    console.error("cloud render failed", error);
    if (jobId) await supabase.from("kiko_edit_jobs").update({ status: "failed", stage: "Render detenido", error: error instanceof Error ? error.message : "Error de render", updated_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", user.userId);
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo renderizar el video." }, { status: 500 });
  }
}
