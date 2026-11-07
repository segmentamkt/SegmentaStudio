import assert from "node:assert/strict";
import test from "node:test";
import { captureRecordingTarget, nextPendingRecordingScene } from "../lib/recording-session";

test("a capture retains its destination and labels after the visible project changes", () => {
  const session = { id: "production-a", title: "E01 — Despedida" };
  const scene = { id: "hook-a", sessionId: session.id, title: "Hook" };
  const target = captureRecordingTarget(session, scene);
  session.id = "production-b";
  session.title = "E02";
  scene.id = "cta-b";
  scene.sessionId = session.id;
  scene.title = "CTA";
  assert.deepEqual(target, { sessionId: "production-a", sceneId: "hook-a", sessionTitle: "E01 — Despedida", sceneTitle: "Hook" });
  assert.equal(Object.isFrozen(target), true);
});

test("capture refuses a missing destination or a scene from another production", () => {
  const session = { id: "production-a" };
  for (const scene of [undefined, null, {}, { id: "hook-a" }, { id: " ", sessionId: session.id }, { id: "hook-a", sessionId: "production-b" }]) {
    assert.throws(() => captureRecordingTarget(session, scene), /Selecciona una escena/);
  }
  assert.throws(() => captureRecordingTarget(undefined, { id: "hook-a", sessionId: session.id }));
  assert.throws(() => captureRecordingTarget({ id: "" }, { id: "hook-a", sessionId: "" }));
});

const scenes = [
  { id: "value", sessionId: "a", position: 2, selectedTakeId: null },
  { id: "foreign", sessionId: "b", position: 0, selectedTakeId: null },
  { id: "hook", sessionId: "a", position: 0, selectedTakeId: null },
  { id: "pain", sessionId: "a", position: 1, selectedTakeId: "approved-pain" },
  { id: "cta", sessionId: "a", position: 3, selectedTakeId: null },
];

test("opening a production selects its first pending scene in chronological order without mutating data", () => {
  const original = JSON.stringify(scenes);
  assert.equal(nextPendingRecordingScene(scenes, "a"), scenes[2]);
  assert.equal(nextPendingRecordingScene(scenes, "b"), scenes[1]);
  assert.equal(nextPendingRecordingScene(scenes, "missing"), null);
  assert.equal(JSON.stringify(scenes), original);
});

test("after approval, advance skips approved scenes and the saved scene even before refresh", () => {
  assert.equal(nextPendingRecordingScene(scenes, "a", "hook")?.id, "value");
  assert.equal(nextPendingRecordingScene(scenes, "a", "value")?.id, "cta");
});

test("after the last scene, return to an earlier unfinished scene rather than another project", () => {
  assert.equal(nextPendingRecordingScene(scenes, "a", "cta")?.id, "hook");
  assert.equal(nextPendingRecordingScene(scenes, "a", "foreign")?.id, "hook");
});

test("a finished production and a just-saved only scene have no next destination", () => {
  assert.equal(nextPendingRecordingScene(scenes.map((scene) => ({ ...scene, selectedTakeId: "approved" })), "a"), null);
  assert.equal(nextPendingRecordingScene([scenes[2]], "a", "hook"), null);
  assert.equal(nextPendingRecordingScene([], "a"), null);
});

test("ties preserve original order and missing positions follow numbered scenes", () => {
  const unordered = [
    { id: "unpositioned", sessionId: "a" },
    { id: "first", sessionId: "a", position: 0 },
    { id: "same-position", sessionId: "a", position: 0 },
    { id: "invalid-position", sessionId: "a", position: Number.NaN },
  ];
  assert.equal(nextPendingRecordingScene(unordered, "a")?.id, "first");
  assert.equal(nextPendingRecordingScene(unordered, "a", "first")?.id, "same-position");
  assert.equal(nextPendingRecordingScene(unordered, "a", "same-position")?.id, "unpositioned");
});
