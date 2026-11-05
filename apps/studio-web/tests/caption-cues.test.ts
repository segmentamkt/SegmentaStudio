import assert from "node:assert/strict";
import test from "node:test";
import { mapCaptionCues, parseCaptionCues } from "../lib/caption-cues";

test("parses SRT and keeps spoken time after an internal silence is removed", () => {
  const cues = parseCaptionCues("1\n00:00:00,500 --> 00:00:02,000\nPrimera idea\n\n2\n00:00:03,000 --> 00:00:04,000\nSegunda idea");
  assert.equal(cues.length, 2);
  assert.deepEqual(mapCaptionCues(cues, [{ start: .5, end: 2 }, { start: 3, end: 4 }]), [
    { startSeconds: 0, endSeconds: 1.5, text: "Primera idea" },
    { startSeconds: 1.5, endSeconds: 2.5, text: "Segunda idea" },
  ]);
});

test("parses WebVTT cues and drops captions outside the manual cut", () => {
  const cues = parseCaptionCues("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFuera\n\n00:00:02.000 --> 00:00:03.000\nDentro");
  assert.deepEqual(mapCaptionCues(cues, [{ start: 2, end: 3 }]), [{ startSeconds: 0, endSeconds: 1, text: "Dentro" }]);
});
