import type { SupabaseClient } from "@supabase/supabase-js";
import { isMediaReviewCurrent, mediaReviewFingerprint, mediaReviewFromRow, MEDIA_REVIEW_STATUSES, type MediaRow } from "./media-review";
import { shouldRepairSourceDuration } from "./speech-audio";

type Snapshot = { scenes: MediaRow[]; takes: MediaRow[]; reviewRow: MediaRow | null };
export interface DurationRepairRepository {
  read(ownerId: string, sessionId: string): Promise<Snapshot>;
  updateDuration(ownerId: string, sessionId: string, previous: MediaRow, durationMs: number): Promise<boolean>;
  compareAndSwapReview(ownerId: string, sessionId: string, previous: MediaRow, contract: MediaRow): Promise<boolean>;
}

/** Correct only missing measurement; preserve approval only when every other reviewed field is identical. */
export async function repairReviewedTakeDuration(repository: DurationRepairRepository, ownerId: string, sessionId: string, takeId: string, sourceDurationSeconds: number) {
  const before = await repository.read(ownerId, sessionId);
  const take = before.takes.find((row) => row.id === takeId && row.owner_id === ownerId && row.session_id === sessionId && row.status === "approved");
  if (!take || !shouldRepairSourceDuration(take.duration_ms, sourceDurationSeconds)) return { repaired: false, reviewPreserved: false };
  const durationMs = Math.round(sourceDurationSeconds * 1_000);
  const review = mediaReviewFromRow(before.reviewRow);
  const validBefore = isMediaReviewCurrent(review, ownerId, sessionId, before.scenes, before.takes);
  if (!await repository.updateDuration(ownerId, sessionId, take, durationMs)) return { repaired: false, reviewPreserved: false };
  if (!validBefore || !before.reviewRow || !review) return { repaired: true, reviewPreserved: false };
  const expectedTakes = before.takes.map((row) => row.id === takeId ? { ...row, duration_ms: durationMs } : row);
  const expectedFingerprint = mediaReviewFingerprint(sessionId, before.scenes, expectedTakes);
  const after = await repository.read(ownerId, sessionId);
  if (expectedFingerprint !== mediaReviewFingerprint(sessionId, after.scenes, after.takes)
      || after.reviewRow?.id !== before.reviewRow.id || after.reviewRow?.status !== "media_review") {
    return { repaired: true, reviewPreserved: false };
  }
  const oldContract = before.reviewRow.contract as MediaRow;
  const contract = { ...oldContract, fingerprint: expectedFingerprint };
  const reviewPreserved = await repository.compareAndSwapReview(ownerId, sessionId, before.reviewRow, contract);
  return { repaired: true, reviewPreserved };
}

export async function repairMeasuredTakeDuration(client: SupabaseClient, ownerId: string, sessionId: string, takeId: string, sourceDurationSeconds: number) {
  const repository: DurationRepairRepository = {
    async read(owner, session) {
      const [scenes, takes, review] = await Promise.all([
        client.from("kiko_scenes").select("*").eq("owner_id", owner).eq("session_id", session),
        client.from("kiko_takes").select("*").eq("owner_id", owner).eq("session_id", session),
        client.from("kiko_edit_jobs").select("*").eq("owner_id", owner).eq("session_id", session).in("status", MEDIA_REVIEW_STATUSES).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (scenes.error || takes.error || review.error) throw scenes.error || takes.error || review.error;
      return { scenes: scenes.data || [], takes: takes.data || [], reviewRow: review.data };
    },
    async updateDuration(owner, session, previous, durationMs) {
      let query = client.from("kiko_takes").update({ duration_ms: durationMs }).eq("id", previous.id).eq("owner_id", owner)
        .eq("session_id", session).eq("status", "approved").eq("object_key", previous.object_key);
      query = previous.duration_ms === null ? query.is("duration_ms", null) : query.eq("duration_ms", previous.duration_ms);
      const result = await query.select("id").maybeSingle();
      if (result.error) throw result.error;
      return !!result.data;
    },
    async compareAndSwapReview(owner, session, previous, contract) {
      const result = await client.from("kiko_edit_jobs").update({ contract }).eq("id", previous.id).eq("owner_id", owner)
        .eq("session_id", session).eq("status", "media_review").eq("contract", JSON.stringify(previous.contract)).select("id").maybeSingle();
      if (result.error) throw result.error;
      return !!result.data;
    },
  };
  return repairReviewedTakeDuration(repository, ownerId, sessionId, takeId, sourceDurationSeconds);
}
