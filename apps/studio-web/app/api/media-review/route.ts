import { createClient } from "../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../lib/request-user";
import { clean } from "../../../lib/studio-data";
import { MEDIA_REVIEW_SCHEMA, MediaReviewError, mediaReviewFingerprint, reviewedMediaRows, validateMediaReviewSubmission } from "../../../lib/media-review";
import { invalidateMediaReview, loadMediaReviewState } from "../../../lib/media-review-server";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof MediaReviewError ? error.message : "No pudimos guardar la revisión. Actualiza las tomas y vuelve a confirmarla." }, { status: error instanceof MediaReviewError ? error.status : 500, headers });
}

export async function GET(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const sessionId = new URL(request.url).searchParams.get("sessionId") || "";
    const state = await loadMediaReviewState(await createClient(), user.userId, sessionId);
    return Response.json({ review: state.review, valid: state.valid }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const sessionId = clean(payload.sessionId);
    const client = await createClient();
    const before = await loadMediaReviewState(client, user.userId, sessionId);
    const submission = validateMediaReviewSubmission(payload, user.userId, sessionId, before.scenes, before.takes);
    const intended = reviewedMediaRows(before.scenes, before.takes, submission);
    const fingerprint = mediaReviewFingerprint(sessionId, intended.scenes, intended.takes);

    await invalidateMediaReview(client, user.userId, sessionId);
    for (const status of ["approved", "rejected", "blooper"] as const) {
      const ids = submission.decisions.filter((decision) => decision.status === status).map((decision) => decision.takeId);
      if (!ids.length) continue;
      const result = await client.from("kiko_takes").update({ status }).eq("owner_id", user.userId).eq("session_id", sessionId).in("id", ids).select("id");
      if (result.error) throw result.error;
      if (result.data?.length !== ids.length) throw new MediaReviewError("El material cambió durante la revisión. Actualiza y confirma de nuevo.");
    }
    for (const scene of intended.scenes) {
      const result = await client.from("kiko_scenes").update({ position: scene.position, selected_take_id: scene.selected_take_id })
        .eq("owner_id", user.userId).eq("session_id", sessionId).eq("id", scene.id).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new MediaReviewError("Una escena cambió durante la revisión. Actualiza y confirma de nuevo.");
    }
    const current = await loadMediaReviewState(client, user.userId, sessionId);
    if (mediaReviewFingerprint(sessionId, current.scenes, current.takes) !== fingerprint) {
      throw new MediaReviewError("Las tomas cambiaron mientras guardabas. Revisa el material actual antes de editar.");
    }
    const ready = await client.from("kiko_recording_sessions").update({ status: submission.orderedTakeIds.length ? "ready_for_edit" : "review_required", updated_at: new Date().toISOString() })
      .eq("owner_id", user.userId).eq("id", sessionId).select("id").maybeSingle();
    if (ready.error) throw ready.error;
    if (!ready.data) throw new MediaReviewError("La producción ya no existe.", 404);
    const id = crypto.randomUUID();
    const confirmedAt = new Date().toISOString();
    const saved = await client.from("kiko_edit_jobs").insert({
      id, owner_id: user.userId, session_id: sessionId, style: "media_review", status: "media_review",
      objective: "Selección y cronología confirmadas por la persona", stage: "Tomas y orden confirmados", progress: 0,
      contract: { schema: MEDIA_REVIEW_SCHEMA, ...submission, fingerprint, confirmedAt },
    });
    if (saved.error) throw saved.error;
    const verified = await loadMediaReviewState(client, user.userId, sessionId);
    if (!verified.valid || verified.review?.id !== id) throw new MediaReviewError("La selección cambió durante la confirmación. Actualiza la revisión.");
    return Response.json({ review: verified.review, valid: true }, { status: 201, headers });
  } catch (error) { return failure(error); }
}
