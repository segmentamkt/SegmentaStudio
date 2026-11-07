import test from "node:test";
import assert from "node:assert/strict";
import { registerUploadedTake, TakeRegistrationError, type RegisteredTake, type TakeRegistrationRepository } from "../lib/take-registration";
import type { MediaRow } from "../lib/media-review";

const input: RegisteredTake = {
  id: "stable-client-take", owner_id: "owner", session_id: "session", scene_id: "scene",
  object_key: "owner/session/scene/upload.webm", status: "approved", mime_type: "video/webm", bytes: 1234, duration_ms: 3000,
};

function memoryRepository() {
  const takes = new Map<string, RegisteredTake>();
  const scene: MediaRow = { id: "scene", selected_take_id: null };
  const writes: string[] = [];
  let failSelection = false;
  let loseInsertResponse = false;
  const repository: TakeRegistrationRepository = {
    async getScene(ownerId, sessionId, sceneId) { return ownerId === "owner" && sessionId === "session" && sceneId === "scene" ? structuredClone(scene) : null; },
    async getTake(ownerId, id) { const row = takes.get(id); return row?.owner_id === ownerId ? structuredClone(row) : null; },
    async listSceneTakes(ownerId, sceneId) { return structuredClone([...takes.values()].filter((row) => row.owner_id === ownerId && row.scene_id === sceneId)); },
    async insertTake(row) {
      if (takes.has(row.id)) throw Object.assign(new Error("duplicate"), { code: "23505" });
      takes.set(row.id, structuredClone(row));
      writes.push("insert");
      if (loseInsertResponse) { loseInsertResponse = false; throw new Error("response lost"); }
      return structuredClone(row);
    },
    async invalidateReview() { writes.push("invalidate"); },
    async selectTakeIfEmpty(_ownerId, _sessionId, _sceneId, takeId) {
      if (failSelection) { failSelection = false; throw new Error("selection failed"); }
      if (!scene.selected_take_id) { scene.selected_take_id = takeId; writes.push("select"); }
    },
  };
  return { repository, scene, takes, writes,
    failNextSelection() { failSelection = true; },
    loseNextInsertResponse() { loseInsertResponse = true; },
  };
}

test("registering a camera upload again returns its take and does not reset a later classification", async () => {
  const store = memoryRepository();
  const first = await registerUploadedTake(store.repository, input);
  assert.equal(first.reused, false);
  assert.equal(store.scene.selected_take_id, input.id);
  store.takes.get(input.id)!.status = "blooper";
  store.scene.selected_take_id = null;
  const before = [...store.writes];
  const retry = await registerUploadedTake(store.repository, input);
  assert.equal(retry.reused, true);
  assert.equal(retry.take.status, "blooper");
  assert.equal(store.scene.selected_take_id, null);
  assert.deepEqual(store.writes, before);
});

test("registration retries repair an approved take after scene selection failed", async () => {
  const store = memoryRepository();
  store.failNextSelection();
  await assert.rejects(registerUploadedTake(store.repository, input), /selection failed/);
  assert.equal(store.takes.size, 1);
  assert.equal(store.scene.selected_take_id, null);
  const retry = await registerUploadedTake(store.repository, input);
  assert.equal(retry.reused, true);
  assert.equal(store.scene.selected_take_id, input.id);
  assert.equal(store.writes.filter((write) => write === "insert").length, 1);
});

test("lost insert responses and concurrent retries create one take", async () => {
  const store = memoryRepository();
  store.loseNextInsertResponse();
  await assert.rejects(registerUploadedTake(store.repository, input), /response lost/);
  const retried = await Promise.all(Array.from({ length: 3 }, () => registerUploadedTake(store.repository, input)));
  assert.ok(retried.every((result) => result.take.id === input.id));
  assert.equal(store.takes.size, 1);
  assert.equal(store.scene.selected_take_id, input.id);
  assert.equal(store.writes.filter((write) => write === "insert").length, 1);
});

test("simultaneous initial registrations handle the database primary-key race", async () => {
  const store = memoryRepository();
  const results = await Promise.all(Array.from({ length: 4 }, () => registerUploadedTake(store.repository, input)));
  assert.equal(results.filter((result) => !result.reused).length, 1);
  assert.equal(store.takes.size, 1);
  assert.equal(store.writes.filter((write) => write === "insert").length, 1);
});

test("an existing manual selection is preserved on registration retry", async () => {
  const store = memoryRepository();
  await registerUploadedTake(store.repository, input);
  store.scene.selected_take_id = "manually-chosen-take";
  const before = [...store.writes];
  const retry = await registerUploadedTake(store.repository, input);
  assert.equal(retry.reused, true);
  assert.equal(store.scene.selected_take_id, "manually-chosen-take");
  assert.deepEqual(store.writes, before);
});

test("a stable take ID cannot be reused for another owner, scene, session or object", async () => {
  const store = memoryRepository();
  await registerUploadedTake(store.repository, input);
  const before = [...store.writes];
  for (const field of ["owner_id", "scene_id", "session_id", "object_key"]) {
    await assert.rejects(registerUploadedTake(store.repository, { ...input, [field]: "other" }), TakeRegistrationError);
  }
  assert.equal(store.takes.size, 1);
  assert.deepEqual(store.writes, before);
});

test("pending uploads remain pending and do not select themselves", async () => {
  const store = memoryRepository();
  await registerUploadedTake(store.repository, { ...input, status: "pending" });
  const retry = await registerUploadedTake(store.repository, { ...input, status: "approved" });
  assert.equal(retry.take.status, "pending");
  assert.equal(store.scene.selected_take_id, null);
});
