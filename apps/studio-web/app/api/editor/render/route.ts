import { createClient } from "../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../lib/request-user";
import { renderCloudEdit } from "../../../../lib/cloud-video-renderer";
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
    const job = await supabase.from("kiko_edit_jobs").select("*").eq("id", jobId).eq("owner_id", user.userId).maybeSingle();
    if (job.error) throw job.error;
    if (!job.data) return Response.json({ error: "No encontramos ese trabajo de edición." }, { status: 404 });
    const contract = job.data.contract as { clips?: Array<{ object_key: string }> };
    const objectKeys = (contract.clips || []).map((clip) => clip.object_key);
    if (!objectKeys.length) return Response.json({ error: "El trabajo no tiene tomas aprobadas." }, { status: 400 });
    const signed = await supabase.storage.from("kiko-videos").createSignedUrls(objectKeys, 3600);
    if (signed.error) throw signed.error;
    const signedUrls = (signed.data || []).map((item) => item.signedUrl).filter((url): url is string => Boolean(url));
    if (signedUrls.length !== objectKeys.length) throw new Error("No pudimos abrir todas las tomas del proyecto.");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return unauthorized();
    const update = async (progress: number, stage: string) => {
      const result = await supabase.from("kiko_edit_jobs").update({ status: "processing", progress, stage, error: null, updated_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", user.userId);
      if (result.error) throw result.error;
    };
    const outputObjectKey = `${user.userId}/renders/${jobId}.mp4`;
    const evidence = await renderCloudEdit({
      contract: job.data.contract,
      signedUrls,
      outputObjectKey,
      accessToken: session.access_token,
      projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      onProgress: update,
    });
    if (!evidence.release_gate.passed) throw new Error("El control de calidad rechazó el render porque faltan elementos solicitados.");
    const completed = await supabase.from("kiko_edit_jobs").update({
      status: "ready", stage: "Edición verificada", progress: 100,
      result_object_key: outputObjectKey, result_metadata: evidence, error: null,
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
