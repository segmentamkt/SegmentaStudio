import assert from "node:assert/strict";
import test from "node:test";
import { reorderReviewTakes } from "../lib/review-order";

test("dropping a take inserts before or after its target without losing any takes", () => {
  const order = ["a", "pending", "b", "blooper", "c"];
  assert.deepEqual(reorderReviewTakes(order, order, "a", "c", "after"), ["pending", "b", "blooper", "c", "a"]);
  assert.deepEqual(reorderReviewTakes(order, order, "c", "a", "before"), ["c", "a", "pending", "b", "blooper"]);
  assert.deepEqual(reorderReviewTakes(order, order, "a", "a", "before"), order);
  assert.deepEqual(reorderReviewTakes(order, order, "foreign", "b", "after"), order);
  assert.deepEqual(order, ["a", "pending", "b", "blooper", "c"]);
});

test("reordering the approved montage preserves the slots of excluded and pending takes", () => {
  const order = ["a", "pending", "b", "blooper", "c"];
  const moved = reorderReviewTakes(order, ["a", "b", "c"], "c", "a", "before");
  assert.deepEqual(moved, ["c", "pending", "a", "blooper", "b"]);
  assert.deepEqual(moved.filter((id) => ["a", "b", "c"].includes(id)), ["c", "a", "b"]);
});
