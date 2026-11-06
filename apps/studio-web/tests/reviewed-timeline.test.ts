import assert from "node:assert/strict";
import test from "node:test";
import { alignReviewedTimeline } from "../lib/reviewed-timeline";

test("confirmed chronology replaces a stale local order and keeps manual splits and edits", () => {
  const original = [
    { takeId: "a", included: true, segment: "a1", trim: 1, text: "First half" },
    { takeId: "b", included: false, segment: "b1", trim: 2, text: "Hook" },
    { takeId: "a", included: true, segment: "a2", trim: 3, text: "Second half" },
    { takeId: "blooper", included: true, segment: "x", trim: 0, text: "Error" },
  ];
  const result = alignReviewedTimeline(original, ["b", "a"]);
  assert.deepEqual(result.map((clip) => clip.segment), ["b1", "a1", "a2"]);
  assert.deepEqual(result.map((clip) => clip.trim), [2, 1, 3]);
  assert.equal(result[0].text, "Hook");
  assert.ok(result.every((clip) => clip.included));
  assert.equal(original[1].included, false);
  assert.equal(original.length, 4);
});

test("reconfirming does not reactivate discarded portions of a split take", () => {
  const clips = [
    { takeId: "a", included: false, segment: "a-error" },
    { takeId: "a", included: true, segment: "a-good" },
    { takeId: "b", included: false, segment: "b-first" },
    { takeId: "b", included: false, segment: "b-second" },
  ];
  assert.deepEqual(alignReviewedTimeline(clips, ["b", "a"]).map((clip) => [clip.segment, clip.included]), [
    ["b-first", true], ["b-second", false], ["a-error", false], ["a-good", true],
  ]);
});
