import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTakeCanBeApproved, isMediaReviewCurrent, MEDIA_REVIEW_SCHEMA, mediaReviewFingerprint,
  mediaReviewFromRow, mediaReviewStateFromRow, requireCurrentMediaReview, reviewedMediaRows, validateMediaReviewSubmission,
  type MediaReviewReceipt, type MediaRow,
} from "../lib/media-review";

const owner = "owner-a";
const session = "session-a";
const scenes: MediaRow[] = [
  { id: "scene-1", owner_id: owner, session_id: session, position: 0, selected_take_id: null, script: "" },
  { id: "scene-2", owner_id: owner, session_id: session, position: 1, selected_take_id: null, script: "" },
];
const takes: MediaRow[] = [
  { id: "take-1", scene_id: "scene-1" }, { id: "take-2", scene_id: "scene-2" }, { id: "retake-1", scene_id: "scene-1" },
].map((row) => ({ ...row, owner_id: owner, session_id: session, status: "pending", object_key: `${owner}/${session}/${row.scene_id}/${row.id}.mp4`, duration_ms: 3000, bytes: 2000, mime_type: "video/mp4" }));
const submission = {
  orderedTakeIds: ["take-2", "take-1"],
  decisions: [{ takeId: "take-1", status: "approved" }, { takeId: "take-2", status: "approved" }, { takeId: "retake-1", status: "blooper" }],
};

function confirmed() {
  const valid = validateMediaReviewSubmission(submission, owner, session, scenes, takes);
  const rows = reviewedMediaRows(scenes, takes, valid);
  const review: MediaReviewReceipt = { id: "receipt-1", ...valid, confirmedAt: "2026-11-06T12:00:00.000Z", fingerprint: mediaReviewFingerprint(session, rows.scenes, rows.takes) };
  return { ...rows, review };
}

test("confirmation persists explicit decisions and the chosen chronology without mutating inputs", () => {
  const result = confirmed();
  assert.deepEqual(result.scenes.map((scene) => [scene.id, scene.position, scene.selected_take_id]), [["scene-1", 1, "take-1"], ["scene-2", 0, "take-2"]]);
  assert.deepEqual(result.takes.map((take) => take.status), ["approved", "approved", "blooper"]);
  assert.ok(takes.every((take) => take.status === "pending"));
  assert.ok(isMediaReviewCurrent(result.review, owner, session, result.scenes, result.takes));
});

test("the full review order survives receipt storage while only approved takes enter the montage", () => {
  const takeOrder = ["retake-1", "take-2", "take-1"];
  const valid = validateMediaReviewSubmission({ ...submission, takeOrder }, owner, session, scenes, takes);
  const rows = reviewedMediaRows(scenes, takes, valid);
  const review: MediaReviewReceipt = { id: "receipt-dragged", ...valid, confirmedAt: "2026-11-06T12:00:00.000Z", fingerprint: mediaReviewFingerprint(session, rows.scenes, rows.takes) };
  const restored = mediaReviewFromRow({ id: review.id, status: "media_review", contract: { schema: MEDIA_REVIEW_SCHEMA, ...review } });
  assert.deepEqual(restored?.takeOrder, takeOrder);
  assert.deepEqual(restored?.orderedTakeIds, ["take-2", "take-1"]);
  assert.deepEqual(restored?.decisions, submission.decisions);
  assert.ok(isMediaReviewCurrent(restored, owner, session, rows.scenes, rows.takes));
  assert.deepEqual(takes.map((take) => take.id), ["take-1", "take-2", "retake-1"]);
});

test("full review order rejects omitted, repeated, foreign, malformed and inconsistent montage IDs", () => {
  for (const takeOrder of [
    [], ["take-2", "take-1"], ["take-2", "take-1", "take-1"],
    ["take-2", "take-1", "foreign"], ["take-2", "take-1", 3],
    ["take-1", "retake-1", "take-2"], null, "take-2,take-1,retake-1",
  ]) assert.throws(() => validateMediaReviewSubmission({ ...submission, takeOrder }, owner, session, scenes, takes));
  const { review, scenes: reviewedScenes, takes: reviewedTakes } = confirmed();
  assert.equal(isMediaReviewCurrent({ ...review, takeOrder: ["take-1", "retake-1", "take-2"] }, owner, session, reviewedScenes, reviewedTakes), false);
  assert.equal(mediaReviewFromRow({ id: review.id, status: "media_review", contract: { schema: MEDIA_REVIEW_SCHEMA, ...review, takeOrder: [null] } }), null);
});

test("legacy receipts without full review order remain usable", () => {
  const { review, scenes: reviewedScenes, takes: reviewedTakes } = confirmed();
  const restored = mediaReviewFromRow({ id: review.id, status: "media_review", contract: { schema: MEDIA_REVIEW_SCHEMA, ...review } });
  assert.equal(restored?.takeOrder, undefined);
  assert.ok(isMediaReviewCurrent(restored, owner, session, reviewedScenes, reviewedTakes));
});

test("stale receipts restore the full list order without authorizing editing, even if the source is unchanged", () => {
  const current = confirmed();
  const takeOrder = ["retake-1", "take-2", "take-1"];
  const row = { id: current.review.id, status: "media_review_stale", contract: { schema: MEDIA_REVIEW_SCHEMA, ...current.review, takeOrder } };
  const state = mediaReviewStateFromRow(row, owner, session, current.scenes, current.takes);
  assert.deepEqual(state.review?.takeOrder, takeOrder);
  assert.deepEqual(state.review?.decisions, current.review.decisions);
  assert.equal(state.valid, false);
  assert.throws(() => requireCurrentMediaReview(state));
  assert.throws(() => requireCurrentMediaReview(state, { id: current.review.id, fingerprint: current.review.fingerprint }));
  assert.equal(mediaReviewStateFromRow({ ...row, status: "media_review" }, owner, session, current.scenes, current.takes).valid, true);
  assert.deepEqual(mediaReviewStateFromRow({ ...row, status: "planned" }, owner, session, current.scenes, current.takes), { review: null, valid: false });
  assert.equal(row.status, "media_review_stale");
});

test("all takes must have exactly one explicit decision, with only approved takes in the order", () => {
  const invalid = [
    { ...submission, decisions: submission.decisions.slice(0, 2) },
    { ...submission, decisions: [submission.decisions[0], submission.decisions[0], submission.decisions[2]] },
    { ...submission, decisions: [...submission.decisions.slice(0, 2), { takeId: "foreign", status: "rejected" }] },
    { ...submission, decisions: [...submission.decisions.slice(0, 2), { takeId: "retake-1", status: "pending" }] },
    { ...submission, orderedTakeIds: ["take-1", "take-1"] },
    { ...submission, orderedTakeIds: ["take-1", "retake-1"] },
    { ...submission, orderedTakeIds: [] },
    { ...submission, orderedTakeIds: ["take-2", "take-1", "retake-1"], decisions: submission.decisions.map((item) => ({ ...item, status: "approved" })) },
  ];
  for (const input of invalid) assert.throws(() => validateMediaReviewSubmission(input, owner, session, scenes, takes));
});

test("a review can save only rejected and blooper takes, but cannot start editing", () => {
  const rejected = { orderedTakeIds: [], decisions: submission.decisions.map((item, index) => ({ ...item, status: index === 0 ? "blooper" : "rejected" })) };
  const valid = validateMediaReviewSubmission(rejected, owner, session, scenes, takes);
  const rows = reviewedMediaRows(scenes, takes, valid);
  const review: MediaReviewReceipt = { id: "review-no-approved", ...valid, confirmedAt: "2026-11-06T12:00:00.000Z", fingerprint: mediaReviewFingerprint(session, rows.scenes, rows.takes) };
  assert.ok(rows.scenes.every((scene) => scene.selected_take_id === null));
  assert.ok(isMediaReviewCurrent(review, owner, session, rows.scenes, rows.takes));
  assert.throws(() => requireCurrentMediaReview({ review, valid: true }), /no hay tomas aprobadas/);
  assert.throws(() => requireCurrentMediaReview({ review, valid: true }, { id: review.id, fingerprint: review.fingerprint }), /no hay tomas aprobadas/);
  assert.throws(() => validateMediaReviewSubmission({ ...rejected, orderedTakeIds: ["take-1"] }, owner, session, scenes, takes));
});

test("foreign owner, session, or scene rows cannot be confirmed", () => {
  for (const change of [{ owner_id: "another-owner" }, { session_id: "another-session" }, { scene_id: "foreign-scene" }]) {
    assert.throws(() => validateMediaReviewSubmission(submission, owner, session, scenes, [{ ...takes[0], ...change }, ...takes.slice(1)]));
  }
  assert.throws(() => validateMediaReviewSubmission(submission, owner, session, [{ ...scenes[0], owner_id: "another-owner" }, scenes[1]], takes));
});

test("adding, deleting, reclassifying or replacing any take invalidates the receipt, including rejected material", () => {
  const current = confirmed();
  const mutations = [
    [...current.takes, { ...current.takes[2], id: "new-take" }],
    current.takes.slice(0, 2),
    ...[{ status: "rejected" }, { object_key: "new-file.mp4" }, { duration_ms: 4500 }, { bytes: 2001 }].map((change) => [current.takes[0], current.takes[1], { ...current.takes[2], ...change }]),
  ];
  for (const changed of mutations) assert.equal(isMediaReviewCurrent(current.review, owner, session, current.scenes, changed), false);
  assert.equal(isMediaReviewCurrent(current.review, owner, session, [{ ...current.scenes[0], position: 0 }, { ...current.scenes[1], position: 1 }], current.takes), false);
  assert.equal(isMediaReviewCurrent(current.review, owner, session, [{ ...current.scenes[0], selected_take_id: "retake-1" }, current.scenes[1]], current.takes), false);
});

test("optional script and title changes preserve confirmation; database row order does not matter", () => {
  const current = confirmed();
  const updated = current.scenes.map((scene) => ({ ...scene, script: "Nuevo libreto opcional", title: "Escena actualizada" })).reverse();
  assert.ok(isMediaReviewCurrent(current.review, owner, session, updated, [...current.takes].reverse()));
});

test("receipt payload must match actual classifications and scene selections even with a valid source hash", () => {
  const current = confirmed();
  assert.equal(isMediaReviewCurrent({ ...current.review, orderedTakeIds: ["take-1", "take-2"] }, owner, session, current.scenes, current.takes), false);
  assert.equal(isMediaReviewCurrent({ ...current.review, decisions: current.review.decisions.map((item) => item.takeId === "retake-1" ? { ...item, status: "rejected" } : item) }, owner, session, current.scenes, current.takes), false);
  assert.equal(isMediaReviewCurrent(null, owner, session, current.scenes, current.takes), false);
});

test("stale or malformed receipt metadata cannot become a usable review", () => {
  const { review } = confirmed();
  const row = { id: review.id, status: "media_review", contract: { schema: MEDIA_REVIEW_SCHEMA, ...review } };
  assert.deepEqual(mediaReviewFromRow(row), review);
  assert.equal(mediaReviewFromRow({ ...row, status: "media_review_stale" }), null);
  assert.equal(mediaReviewFromRow({ ...row, contract: { ...row.contract, fingerprint: "invalid" } }), null);
});

test("planning requires current review; rendering also requires the exact receipt version in its contract", () => {
  const { review } = confirmed();
  assert.equal(requireCurrentMediaReview({ review, valid: true }), review);
  assert.equal(requireCurrentMediaReview({ review, valid: true }, { id: review.id, fingerprint: review.fingerprint }), review);
  for (const reference of [null, {}, { id: "old-receipt", fingerprint: review.fingerprint }, { id: review.id, fingerprint: "old-fingerprint" }]) {
    assert.throws(() => requireCurrentMediaReview({ review, valid: true }, reference));
  }
  assert.throws(() => requireCurrentMediaReview({ review, valid: false }));
  assert.throws(() => requireCurrentMediaReview({ review: null, valid: true }));
});

test("approving a take never silently rejects pending alternatives", () => {
  const alternatives = structuredClone(takes);
  assert.doesNotThrow(() => assertTakeCanBeApproved("take-1", "scene-1", alternatives));
  assert.deepEqual(alternatives, takes);
  assert.throws(() => assertTakeCanBeApproved("retake-1", "scene-1", [{ ...takes[0], status: "approved" }, ...takes.slice(1)]));
  assert.doesNotThrow(() => assertTakeCanBeApproved("take-1", "scene-1", [{ ...takes[0], status: "approved" }, ...takes.slice(1)]));
});
