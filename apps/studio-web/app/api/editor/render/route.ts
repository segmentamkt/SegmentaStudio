import { createClient } from "../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../lib/request-user";
import { verifyCloudRender } from "../../../../lib/cloud-video-renderer";
import { renderSequentialCloudEdit } from "../../../../lib/sequential-cloud-video-renderer";
import { normalizeRenderContract } from "../../../../lib/render-contract-security";
import { clean, toEditJob } from "../../../../lib/studio-data";
import { MediaReviewError, requireCurrentMediaReview } from "../../../../lib/media-review";
import { readMediaReview } from "../../../../lib/media-review-server";
import type { RenderPreview } from "../../../../lib/render-preview";

export const maxDuration = 300;

function safeErrorMessage(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "No se pudo renderizar el video.";
  return message.replace(/https?:\/\/\S+/gi, "[URL protegida]").replace(/Bearer\s+\S+/gi, "Bearer [oculto]").slice(0, 900);
}

function networkCode(error: unknown) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : null;
  const nested = cause && typeof cause === "object" && "causingError" in cause ? cause.causingError : cause;
  return nested && typeof nested === "object" && "code" in nested ? String(nested.code).slice(0, 40) : null;
}

async function executeRender(request: Request, onProgress: (progress: number, stage: string) => void = () => undefined, onPreview?: (preview: RenderPreview) => void) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  const supabase = await createClient();
  let jobId = "";
  let outputObjectKey = "";
  let phase = "leyendo el plan";
  try {
    const payload = await request.json() as Record<string, unknown>;
    jobId = clean(payload.jobId);
    const temporaryJob = payload.job && typeof payload.job === "object" ? payload.job as Record<string, unknown> : null;
    const ephemeral = temporaryJob?.ephemeral === true && temporaryJob.ownerId === user.userId && temporaryJob.id === jobId;
    const job = ephemeral ? null : await supabase.from("kiko_edit_jobs").select("*").eq("id", jobId).eq("owner_id", user.userId).maybeSingle();
    if (job?.error) throw job.error;
    if (!ephemeral && !job?.data) return Response.json({ error: "No encontramos ese trabajo de edición." }, { status: 404 });
    if (!ephemeral && ["preproduction", "media_review", "media_review_stale"].includes(String(job?.data?.status))) return Response.json({ error: "Selecciona un plan de edición para renderizar." }, { status: 400 });
    phase = "validando las tomas";
    const sessionId = clean(ephemeral ? temporaryJob?.sessionId : job?.data?.session_id);
    if (!sessionId) return Response.json({ error: "El plan no identifica una producción." }, { status: 400 });
    const [production, scenes, takes] = await Promise.all([
      supabase.from("kiko_recording_sessions").select("*").eq("id", sessionId).eq("owner_id", user.userId).maybeSingle(),
      supabase.from("kiko_scenes").select("*").eq("session_id", sessionId).eq("owner_id", user.userId).order("position"),
      supabase.from("kiko_takes").select("*").eq("session_id", sessionId).eq("owner_id", user.userId),
    ]);
    if (production.error || scenes.error || takes.error) throw production.error || scenes.error || takes.error;
    if (!production.data) return Response.json({ error: "La producción ya no existe." }, { status: 404 });
    const rawContract = (ephemeral ? temporaryJob?.contract : job?.data?.contract) as Record<string, unknown> | null;
    requireCurrentMediaReview(await readMediaReview(supabase, user.userId, sessionId, scenes.data || [], takes.data || []), rawContract?.media_review ?? null);
    const contract = normalizeRenderContract(rawContract, production.data, scenes.data, takes.data);
    const sourceBytes = new Map((takes.data || []).map((take) => [take.object_key, Number(take.bytes || 0)]));
    console.info("[cloud-render] input summary", {
      jobId,
      clipCount: contract.clips.length,
      clips: contract.clips.map((clip, index) => ({ index: index + 1, durationSeconds: clip.duration_seconds, bytes: sourceBytes.get(clip.object_key) || 0 })),
    });
    phase = "abriendo los videos originales";
    const objectKeys = contract.clips.map((clip) => clip.object_key);
    const signed = await supabase.storage.from("kiko-videos").createSignedUrls(objectKeys, 3600);
    if (signed.error) throw signed.error;
    const signedUrls = (signed.data || []).map((item) => item.signedUrl).filter((url): url is string => Boolean(url));
    if (signedUrls.length !== objectKeys.length) throw new Error("No pudimos abrir todas las tomas del proyecto.");
    let musicUrl: string | undefined;
    if (contract.music) {
      const song = await supabase.storage.from("kiko-videos").createSignedUrl(contract.music.object_key, 3600);
      if (song.error || !song.data?.signedUrl) throw new Error("No pudimos abrir la canción elegida. Vuelve a subirla en el panel Audio.");
      musicUrl = song.data.signedUrl;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return unauthorized();
    const update = async (progress: number, stage: string) => {
      if (!ephemeral) {
        const result = await supabase.from("kiko_edit_jobs").update({ status: "processing", progress, stage, error: null, updated_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", user.userId);
        if (result.error) throw result.error;
      }
      console.info("[cloud-render] progress", { jobId, progress, stage });
      onProgress(progress, stage);
    };
    outputObjectKey = `${user.userId}/renders/${jobId}.mp4`;
    phase = "renderizando y subiendo el MP4";
    console.info("[cloud-render] renderer selected", { jobId, mode: "sequential" });
    const evidence = await renderSequentialCloudEdit({
      contract,
      signedUrls,
      musicUrl,
      outputObjectKey,
      accessToken: session.access_token,
      projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      onProgress: update,
      onPreview,
    });
    if (!evidence.release_gate.passed) throw new Error("El control de calidad rechazó el render porque faltan elementos solicitados.");
    phase = "verificando el MP4 guardado";
    const link = await supabase.storage.from("kiko-videos").createSignedUrl(outputObjectKey, 3600);
    if (link.error) throw link.error;
    await update(96, "Comprobando video y audio del MP4");
    const verification = await verifyCloudRender(link.data.signedUrl);
    if (verification.width !== 1080 || verification.height !== 1920) throw new Error("El MP4 final no conserva el formato vertical 1080 × 1920.");
    const verifiedEvidence = { ...evidence, ...verification, release_gate: { passed: true } };
    console.info("[cloud-render] completed", {
      jobId, durationSeconds: verifiedEvidence.duration_seconds,
      captionCount: verifiedEvidence.caption_count, effectCount: verifiedEvidence.effect_count,
    });
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
    // Review failures happen before media work and must not overwrite a valid saved plan.
    if (error instanceof MediaReviewError) return Response.json({ error: error.message }, { status: error.status });
    const message = `Error durante ${phase}: ${safeErrorMessage(error)}`;
    console.error("cloud render failed", { phase, message: safeErrorMessage(error), code: networkCode(error), jobId });
    if (outputObjectKey) {
      try {
        const cleanup = await supabase.storage.from("kiko-videos").remove([outputObjectKey]);
        if (cleanup.error) console.error("cloud render cleanup failed", cleanup.error);
      } catch (cleanupError) {
        console.error("cloud render cleanup failed", cleanupError);
      }
    }
    if (jobId) {
      try {
        const failed = await supabase.from("kiko_edit_jobs").update({ status: "failed", stage: "Render detenido", error: message, updated_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", user.userId);
        if (failed.error) console.error("cloud render status update failed", { code: failed.error.code || null, jobId });
      } catch (updateError) {
        console.error("cloud render status update failed", { code: networkCode(updateError), jobId });
      }
    }
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) return executeRender(request);

  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (line: string) => {
        if (cancelled) return;
        try { controller.enqueue(encoder.encode(line)); }
        catch { cancelled = true; }
      };
      const send = (event: Record<string, unknown>) => {
        write(`${JSON.stringify(event)}\n`);
      };
      send({ type: "progress", progress: 1, stage: "Iniciando la edición" });
      // A blank line keeps the HTTP connection alive during long FFmpeg stages.
      heartbeat = setInterval(() => write("\n"), 15_000);
      void (async () => {
        try {
          const response = await executeRender(request,
            (progress, stage) => send({ type: "progress", progress, stage }),
            (preview) => send({ type: "preview", preview }));
          const payload = await response.json() as { job?: unknown; error?: string };
          if (response.ok && payload.job) send({ type: "done", job: payload.job });
          else send({ type: "error", error: payload.error || "No se pudo completar la edición.", status: response.status });
        } catch (error) {
          console.error("cloud render stream failed", { message: safeErrorMessage(error), code: networkCode(error) });
          send({ type: "error", error: `Error al transmitir el render: ${safeErrorMessage(error)}` });
        } finally {
          if (heartbeat) clearInterval(heartbeat);
          if (!cancelled) controller.close();
        }
      })();
    },
    cancel() { cancelled = true; if (heartbeat) clearInterval(heartbeat); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
