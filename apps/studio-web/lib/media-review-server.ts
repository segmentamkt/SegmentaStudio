import type { SupabaseClient } from "@supabase/supabase-js";
import { isMediaReviewCurrent, MEDIA_REVIEW_STATUSES, mediaReviewFromRow, MediaReviewError, type MediaRow } from "./media-review";

export async function readMediaReview(client: SupabaseClient, ownerId: string, sessionId: string, scenes: MediaRow[], takes: MediaRow[]) {
  const result = await client.from("kiko_edit_jobs").select("*").eq("owner_id", ownerId).eq("session_id", sessionId)
    .in("status", MEDIA_REVIEW_STATUSES).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  const review = mediaReviewFromRow(result.data);
  return { review, valid: isMediaReviewCurrent(review, ownerId, sessionId, scenes, takes) };
}

export async function loadMediaReviewState(client: SupabaseClient, ownerId: string, sessionId: string) {
  const [session, scenes, takes] = await Promise.all([
    client.from("kiko_recording_sessions").select("*").eq("owner_id", ownerId).eq("id", sessionId).maybeSingle(),
    client.from("kiko_scenes").select("*").eq("owner_id", ownerId).eq("session_id", sessionId).order("position"),
    client.from("kiko_takes").select("*").eq("owner_id", ownerId).eq("session_id", sessionId).order("created_at"),
  ]);
  if (session.error || scenes.error || takes.error) throw session.error || scenes.error || takes.error;
  if (!session.data) throw new MediaReviewError("No encontramos esa producción.", 404);
  const sceneRows = (scenes.data || []) as MediaRow[];
  const takeRows = (takes.data || []) as MediaRow[];
  return { session: session.data as MediaRow, scenes: sceneRows, takes: takeRows, ...await readMediaReview(client, ownerId, sessionId, sceneRows, takeRows) };
}

/** Invalidate first: a failed mutation must never retain a usable approval receipt. */
export async function invalidateMediaReview(client: SupabaseClient, ownerId: string, sessionId: string) {
  const stale = await client.from("kiko_edit_jobs").update({ status: "media_review_stale", stage: "Revisión pendiente", updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId).eq("session_id", sessionId).eq("status", "media_review");
  if (stale.error) throw stale.error;
  const session = await client.from("kiko_recording_sessions").update({ status: "review_required", updated_at: new Date().toISOString() }).eq("owner_id", ownerId).eq("id", sessionId);
  if (session.error) throw session.error;
}
