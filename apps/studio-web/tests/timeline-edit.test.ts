import assert from "node:assert/strict";
import { test } from "node:test";
import { canSplitAt, dropEdgeLeft, layoutTimeline, outputSeconds, playheadX, reorderTarget, sourceSecondAt, timelineWidth, trimmedRange, type TimelineSpan } from "../lib/timeline-edit";

const take = (id: string, patch: Partial<TimelineSpan> = {}): TimelineSpan => ({ id, start: 0, end: 4, speed: 1, included: true, sourceDuration: 10, ...patch });

test("output time divides the cut by speed; excluded takes count for nothing", () => {
  assert.equal(outputSeconds(take("a", { start: 1, end: 5, speed: 2 })), 2);
  assert.equal(outputSeconds(take("b", { included: false })), 0);
});

test("layout places takes one after another and gives excluded takes a fixed width", () => {
  const boxes = layoutTimeline([take("a", { end: 2 }), take("b", { included: false }), take("c", { start: 1, end: 3, speed: 2 })], 40);
  assert.deepEqual(boxes, [
    { id: "a", left: 0, width: 80 },
    { id: "b", left: 80, width: 28 },
    { id: "c", left: 108, width: 40 },
  ]);
  assert.equal(timelineWidth(boxes), 148);
});

test("dragging the start edge trims from the front and never passes the end", () => {
  const span = take("a", { start: 2, end: 8 });
  assert.deepEqual(trimmedRange(span, "start", 80, 40), { start: 4, end: 8 });
  assert.deepEqual(trimmedRange(span, "start", -1000, 40), { start: 0, end: 8 });
  assert.deepEqual(trimmedRange(span, "start", 1000, 40), { start: 7.8, end: 8 });
});

test("dragging the end edge trims from the back, keeps 0.2 s and stops at the source length", () => {
  const span = take("a", { start: 2, end: 8, sourceDuration: 10 });
  assert.deepEqual(trimmedRange(span, "end", -40, 40), { start: 2, end: 7 });
  assert.deepEqual(trimmedRange(span, "end", 1000, 40), { start: 2, end: 10 });
  assert.deepEqual(trimmedRange(span, "end", -1000, 40), { start: 2, end: 2.2 });
});

test("a 2x take moves half as many source seconds per pixel", () => {
  assert.deepEqual(trimmedRange(take("a", { start: 0, end: 6, speed: 2 }), "end", 40, 40), { start: 0, end: 8 });
});

test("a click maps to the source second under the pointer", () => {
  assert.equal(sourceSecondAt(take("a", { start: 2, end: 8 }), 40, 40), 3);
  assert.equal(sourceSecondAt(take("a", { start: 2, end: 8 }), 9999, 40), 8);
});

test("reordering inserts the dragged take before the takes whose centers lie left of the pointer", () => {
  const boxes = layoutTimeline([take("a", { end: 2.5 }), take("b", { end: 2.5 }), take("c", { end: 2.5 })], 40);
  assert.equal(reorderTarget(boxes, "a", 50), 0);
  assert.equal(reorderTarget(boxes, "a", 160), 1, "past the center of b (150)");
  assert.equal(reorderTarget(boxes, "a", 150), 0, "exactly on b's center is not yet past it");
  assert.equal(reorderTarget(boxes, "a", 400), 2);
  assert.equal(dropEdgeLeft(boxes, "a", 0), 0);
  assert.equal(dropEdgeLeft(boxes, "a", 1), 200, "after b");
  assert.equal(dropEdgeLeft(boxes, "a", 2), 300, "after c");
});

test("the playhead follows the source time inside its take", () => {
  const span = take("a", { start: 2, end: 6, speed: 2 });
  const boxes = layoutTimeline([span], 40);
  assert.equal(playheadX(boxes[0], span, 4, 40), 40);
  assert.equal(playheadX(undefined, span, 4, 40), null);
  assert.equal(playheadX(boxes[0], take("b", { included: false }), 4, 40), null);
});

test("a split needs at least 0.2 s on both sides", () => {
  const span = take("a", { start: 0, end: 1 });
  assert.equal(canSplitAt(span, 0.1), false);
  assert.equal(canSplitAt(span, 0.5), true);
  assert.equal(canSplitAt(span, 0.85), false);
});
