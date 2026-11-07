import assert from "node:assert/strict";
import test from "node:test";
import { repairReviewedTakeDuration, type DurationRepairRepository } from "../lib/media-duration-repair";
import { isMediaReviewCurrent, mediaReviewFingerprint, mediaReviewFromRow, MEDIA_REVIEW_SCHEMA, type MediaRow } from "../lib/media-review";

function store() {
  const scenes: MediaRow[] = [{ id: "scene", owner_id: "owner", session_id: "session", position: 0, selected_take_id: "take" }];
  const takes: MediaRow[] = [{ id: "take", owner_id: "owner", session_id: "session", scene_id: "scene", status: "approved", object_key: "owner/session/scene/video.mp4", duration_ms: 0, bytes: 1000, mime_type: "video/mp4" }];
  const receipt: MediaRow = { id: "review", owner_id: "owner", session_id: "session", status: "media_review", contract: {
    schema: MEDIA_REVIEW_SCHEMA, orderedTakeIds: ["take"], takeOrder: ["take"], decisions: [{ takeId: "take", status: "approved" }],
    confirmedAt: "2026-11-07T12:00:00.000Z", fingerprint: mediaReviewFingerprint("session", scenes, takes),
  } };
  const writes: string[] = [];
  let afterUpdate: (() => void) | undefined;
  let beforeCas: (() => void) | undefined;
  const repository: DurationRepairRepository = {
    async read(owner, session) {
      return structuredClone({ scenes: scenes.filter((row) => row.owner_id === owner && row.session_id === session), takes: takes.filter((row) => row.owner_id === owner && row.session_id === session), reviewRow: receipt.owner_id === owner && receipt.session_id === session ? receipt : null });
    },
    async updateDuration(owner, session, previous, durationMs) {
      const take = takes.find((row) => row.id === previous.id && row.owner_id === owner && row.session_id === session && row.duration_ms === previous.duration_ms && row.object_key === previous.object_key && row.status === "approved");
      if (!take) return false;
      take.duration_ms = durationMs; writes.push("duration"); afterUpdate?.(); return true;
    },
    async compareAndSwapReview(owner, session, previous, contract) {
      beforeCas?.();
      if (receipt.owner_id !== owner || receipt.session_id !== session || receipt.id !== previous.id || receipt.status !== "media_review" || JSON.stringify(receipt.contract) !== JSON.stringify(previous.contract)) return false;
      receipt.contract = structuredClone(contract); writes.push("fingerprint"); return true;
    },
  };
  return { repository, receipt, scenes, takes, writes, afterUpdate(action: () => void) { afterUpdate = action; }, beforeCas(action: () => void) { beforeCas = action; } };
}

test("metadata-only repair preserves the same valid review and every explicit decision", async () => {
  const state = store();
  const previous = structuredClone(state.receipt);
  const result = await repairReviewedTakeDuration(state.repository, "owner", "session", "take", 7.25);
  assert.deepEqual(result, { repaired: true, reviewPreserved: true });
  assert.equal(state.takes[0].duration_ms, 7250);
  assert.equal(state.receipt.id, previous.id);
  const oldContract = previous.contract as MediaRow;
  const current = state.receipt.contract as MediaRow;
  assert.deepEqual({ ...current, fingerprint: oldContract.fingerprint }, oldContract);
  assert.ok(isMediaReviewCurrent(mediaReviewFromRow(state.receipt), "owner", "session", state.scenes, state.takes));
  assert.deepEqual(state.writes, ["duration", "fingerprint"]);
});

test("stale review is never approved as a side effect of duration repair", async () => {
  const state = store();
  state.receipt.status = "media_review_stale";
  const previous = structuredClone(state.receipt);
  const result = await repairReviewedTakeDuration(state.repository, "owner", "session", "take", 7.25);
  assert.deepEqual(result, { repaired: true, reviewPreserved: false });
  assert.deepEqual(state.receipt, previous);
  assert.deepEqual(state.writes, ["duration"]);
});

test("concurrent changes to chronology, selection, classification, object or other source fields prevent fingerprint renewal", async () => {
  for (const change of [
    (state: ReturnType<typeof store>) => { state.scenes[0].position = 1; },
    (state: ReturnType<typeof store>) => { state.scenes[0].selected_take_id = null; },
    (state: ReturnType<typeof store>) => { state.takes[0].status = "blooper"; },
    (state: ReturnType<typeof store>) => { state.takes[0].object_key = "owner/session/scene/other.mp4"; },
    (state: ReturnType<typeof store>) => { state.takes[0].bytes = 2000; },
    (state: ReturnType<typeof store>) => { state.receipt.id = "new-review"; },
  ]) {
    const state = store();
    state.afterUpdate(() => change(state));
    const oldContract = structuredClone(state.receipt.contract);
    const result = await repairReviewedTakeDuration(state.repository, "owner", "session", "take", 7.25);
    assert.deepEqual(result, { repaired: true, reviewPreserved: false });
    assert.deepEqual(state.receipt.contract, oldContract);
    assert.deepEqual(state.writes, ["duration"]);
  }
});

test("compare-and-swap will not overwrite a concurrent review contract", async () => {
  const state = store();
  state.beforeCas(() => { (state.receipt.contract as MediaRow).confirmedAt = "2026-11-07T12:01:00.000Z"; });
  const result = await repairReviewedTakeDuration(state.repository, "owner", "session", "take", 7.25);
  assert.deepEqual(result, { repaired: true, reviewPreserved: false });
  assert.equal((state.receipt.contract as MediaRow).confirmedAt, "2026-11-07T12:01:00.000Z");
  assert.deepEqual(state.writes, ["duration"]);
});

test("known durations, unknown measurements and foreign ownership cannot modify data", async () => {
  const state = store();
  await repairReviewedTakeDuration(state.repository, "another-owner", "session", "take", 7.25);
  await repairReviewedTakeDuration(state.repository, "owner", "another-session", "take", 7.25);
  await repairReviewedTakeDuration(state.repository, "owner", "session", "take", NaN);
  state.takes[0].duration_ms = 6000;
  await repairReviewedTakeDuration(state.repository, "owner", "session", "take", 7.25);
  assert.deepEqual(state.writes, []);
  assert.equal(state.takes[0].duration_ms, 6000);
});
