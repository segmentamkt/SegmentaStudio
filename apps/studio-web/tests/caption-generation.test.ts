import assert from "node:assert/strict";
import test from "node:test";
import { getCaptionGenerationTargets, mergeCaptionGenerationResult, type CaptionGenerationClip } from "../lib/caption-generation";

function clip(segmentId: string, takeId: string, overrides: Partial<CaptionGenerationClip> = {}) {
  return {
    segmentId, takeId, included: true, duration: 10, trimStartSeconds: 0, trimEndSeconds: 10,
    transcript: "", captionCues: [], label: "Manual label", playbackSpeed: 1.2, ...overrides,
  };
}

test("automatic captions transcribe each source once and target only requested missing segments", () => {
  const timeline = [
    clip("a-first", "a", { trimEndSeconds: 4 }),
    clip("a-second", "a", { trimStartSeconds: 4 }),
    clip("a-corrected", "a", { transcript: "Corregido", captionCues: [{ startSeconds: 1, endSeconds: 2, text: "Corregido" }] }),
    clip("b-excluded", "b", { included: false }),
    clip("c", "c"),
  ];
  const targets = getCaptionGenerationTargets(timeline, { scope: "missing" });
  assert.deepEqual(targets.map((target) => [target.takeId, target.segments.map((segment) => segment.segmentId)]), [
    ["a", ["a-first", "a-second"]], ["c", ["c"]],
  ]);
  assert.equal(targets[0].durationSeconds, 10);
  assert.deepEqual(targets[0].ranges, [{ startSeconds: 0, endSeconds: 10 }]);
  assert.deepEqual(getCaptionGenerationTargets(timeline, { scope: "selected", selectedSegmentId: "a-corrected" })[0].segments.map((segment) => segment.segmentId), ["a-corrected"]);
  assert.deepEqual(getCaptionGenerationTargets(timeline, { scope: "selected", selectedSegmentId: "b-excluded" })[0].segments.map((segment) => segment.segmentId), ["b-excluded"]);
  assert.deepEqual(getCaptionGenerationTargets(timeline, { scope: "selected", selectedSegmentId: "absent" }), []);
});

test("long-source targets only transcribe the montage trims and preserve corrected gaps", () => {
  const timeline = [
    clip("intro", "long", { duration: 3600, trimStartSeconds: 300, trimEndSeconds: 315 }),
    clip("overlap", "long", { duration: 3600, trimStartSeconds: 310, trimEndSeconds: 325 }),
    clip("later", "long", { duration: 3600, trimStartSeconds: 900, trimEndSeconds: 920 }),
    clip("manual", "long", { duration: 3600, trimStartSeconds: 600, trimEndSeconds: 620, captionCues: [{ startSeconds: 601, endSeconds: 603, text: "Texto corregido" }] }),
  ];
  const [target] = getCaptionGenerationTargets(timeline, { scope: "missing" });
  assert.deepEqual(target.ranges, [{ startSeconds: 300, endSeconds: 325 }, { startSeconds: 900, endSeconds: 920 }]);
  const result = mergeCaptionGenerationResult(timeline, target, { captionCues: [{ startSeconds: 311, endSeconds: 312, text: "Primera parte" }, { startSeconds: 905, endSeconds: 907, text: "Otra parte" }] });
  assert.deepEqual(result.updatedSegmentIds, ["intro", "overlap", "later"]);
  assert.equal(result.timeline[3], timeline[3]);
  assert.equal(result.timeline[2].captionCues[0].startSeconds, 905);
});

test("a subtitle card crossing a cut does not copy neighbouring words into both clips", () => {
  const timeline = [clip("before", "a", { trimEndSeconds: 2 }), clip("after", "a", { trimStartSeconds: 2 })];
  const [target] = getCaptionGenerationTargets(timeline, { scope: "missing" });
  const result = mergeCaptionGenerationResult(timeline, target, {
    captionCues: [{ startSeconds: 1, endSeconds: 3, text: "Hola mundo" }],
    words: [{ text: "Hola", startInSeconds: 1, endInSeconds: 1.8 }, { text: "mundo", startInSeconds: 2.1, endInSeconds: 3 }], maxWords: 4,
  });
  assert.equal(result.timeline[0].transcript, "Hola");
  assert.equal(result.timeline[1].transcript, "mundo");
  assert.equal(result.timeline[1].captionCues[0].startSeconds, 2.1);
});

test("split captions use their own source-time interval and preserve corrected or excluded duplicates", () => {
  const timeline = [
    clip("first", "a", { trimStartSeconds: 1, trimEndSeconds: 4 }),
    clip("second", "a", { trimStartSeconds: 4, trimEndSeconds: 8 }),
    clip("corrected", "a", { transcript: "Mi corrección", captionCues: [{ startSeconds: 1, endSeconds: 2, text: "Mi corrección" }] }),
    clip("excluded", "a", { included: false }),
  ];
  const [target] = getCaptionGenerationTargets(timeline, { scope: "missing" });
  const source = { captionCues: [
    { startSeconds: 0, endSeconds: .5, text: "Fuera" },
    { startSeconds: .8, endSeconds: 2, text: "Primera frase" },
    { startSeconds: 4.5, endSeconds: 9, text: "Segunda frase" },
  ] };
  const result = mergeCaptionGenerationResult(timeline, target, source);
  assert.deepEqual(result.updatedSegmentIds, ["first", "second"]);
  assert.deepEqual(result.failedSegments, []);
  assert.deepEqual(result.timeline[0].captionCues, [{ startSeconds: 1, endSeconds: 2, text: "Primera frase" }]);
  assert.deepEqual(result.timeline[1].captionCues, [{ startSeconds: 4.5, endSeconds: 8, text: "Segunda frase" }]);
  assert.equal(result.timeline[0].transcript, "Primera frase");
  assert.equal(result.timeline[1].transcript, "Segunda frase");
  assert.equal(result.timeline[0].label, "Manual label");
  assert.equal(result.timeline[1].playbackSpeed, 1.2);
  assert.equal(result.timeline[2], timeline[2]);
  assert.equal(result.timeline[3], timeline[3]);
  assert.deepEqual(timeline[0].captionCues, []);
  assert.equal(source.captionCues[2].endSeconds, 9);
});

test("late inference never overwrites a segment edited, replaced, excluded or deleted after starting", () => {
  const timeline = [clip("text", "a"), clip("trim", "a"), clip("source", "a"), clip("excluded", "a"), clip("deleted", "a"), clip("unchanged", "a")];
  const [target] = getCaptionGenerationTargets(timeline, { scope: "missing" });
  const current = timeline.filter((item) => item.segmentId !== "deleted").map((item) => item.segmentId === "text" ? { ...item, transcript: "Edición nueva" }
    : item.segmentId === "trim" ? { ...item, trimStartSeconds: 2 }
      : item.segmentId === "source" ? { ...item, takeId: "b" }
        : item.segmentId === "excluded" ? { ...item, included: false } : item);
  const result = mergeCaptionGenerationResult(current, target, { captionCues: [{ startSeconds: 1, endSeconds: 3, text: "Palabras reales" }] });
  assert.deepEqual(result.updatedSegmentIds, ["unchanged"]);
  assert.deepEqual(result.skippedSegmentIds, ["text", "trim", "source", "excluded", "deleted"]);
  assert.equal(result.timeline[0], current[0]);
  assert.equal(result.timeline[1], current[1]);
  assert.equal(result.timeline[2], current[2]);
  assert.equal(result.timeline[3], current[3]);
});

test("empty speech in a trim is reported without erasing existing captions or other successful splits", () => {
  const timeline = [clip("speech", "a", { trimEndSeconds: 3 }), clip("silent", "a", { trimStartSeconds: 5 })];
  const [target] = getCaptionGenerationTargets(timeline, { scope: "missing" });
  const result = mergeCaptionGenerationResult(timeline, target, { captionCues: [{ startSeconds: 1, endSeconds: 2, text: "Una frase" }] });
  assert.deepEqual(result.updatedSegmentIds, ["speech"]);
  assert.equal(result.failedSegments[0].segmentId, "silent");
  assert.match(result.failedSegments[0].message, /No se detectó voz/);
  assert.equal(result.timeline[1], timeline[1]);
  const old = [clip("old", "a", { transcript: "Ya corregido", captionCues: [{ startSeconds: 1, endSeconds: 2, text: "Ya corregido" }] })];
  const [regeneration] = getCaptionGenerationTargets(old, { scope: "selected", selectedSegmentId: "old" });
  const noSpeech = mergeCaptionGenerationResult(old, regeneration, { captionCues: [] });
  assert.equal(noSpeech.timeline, old);
  assert.equal(noSpeech.failedSegments.length, 1);
});

test("caption limits fail clearly without truncating words; splitting a long take can recover valid portions", () => {
  const timeline = [clip("full", "a")];
  const [target] = getCaptionGenerationTargets(timeline, { scope: "missing" });
  const source = { captionCues: Array.from({ length: 10 }, (_, index) => ({ startSeconds: index, endSeconds: index + .8, text: `Frase ${index} ${"palabra ".repeat(15).trim()}` })) };
  const full = mergeCaptionGenerationResult(timeline, target, source);
  assert.equal(full.timeline, timeline);
  assert.match(full.failedSegments[0].message, /Divídelo/);
  const split = [clip("half", "a", { trimEndSeconds: 4 })];
  const [splitTarget] = getCaptionGenerationTargets(split, { scope: "missing" });
  const result = mergeCaptionGenerationResult(split, splitTarget, source);
  assert.deepEqual(result.updatedSegmentIds, ["half"]);
  assert.equal(result.timeline[0].captionCues.length, 4);
  assert.ok(result.timeline[0].transcript.length < 1_000);
});
