import assert from "node:assert/strict";
import test from "node:test";
import { repairUnknownTimelineDuration } from "../lib/editor-media-duration";

test("unknown-duration upload expands only its placeholder and preserves completed captions", () => {
  const completed = { takeId: "other", duration: 7, trimStartSeconds: 1, trimEndSeconds: 6, captionCues: [{ text: "Corrección manual" }] };
  const unknown = { takeId: "missing", duration: .2, trimStartSeconds: 0, trimEndSeconds: .2, captionCues: [] };
  const result = repairUnknownTimelineDuration([completed, unknown], "missing", 8.25);
  assert.equal(result[0], completed);
  assert.equal(result[1].duration, 8.25);
  assert.equal(result[1].trimEndSeconds, 8.25);
});

test("duration repair keeps deliberate trims and refuses invalid measurements", () => {
  const trim = { takeId: "missing", duration: 60, trimStartSeconds: 10, trimEndSeconds: 20, transcript: "Texto" };
  assert.deepEqual(repairUnknownTimelineDuration([trim], "missing", 61), [{ ...trim, duration: 61 }]);
  assert.throws(() => repairUnknownTimelineDuration([trim], "missing", NaN));
});
