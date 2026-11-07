import assert from "node:assert/strict";
import test from "node:test";
import { createQuickRecording, QuickRecordingError, readQuickRecordingInput, type QuickRecordingRepository, type QuickRecordingRow } from "../lib/quick-recording";

const owner = "owner-a";
const portfolioId = "217ea0b2-37d2-4092-b678-18238e352300";
const anotherPortfolioId = "7ff14c43-6356-43c1-900d-b08b68701676";
const foreignPortfolioId = "aab433cd-24bc-4cb0-a990-b08b68701676";
const requestId = "42d6e138-4c9d-4bf4-96fc-b66df3bb9ac0";
const input = { portfolioId, requestId };
const now = new Date("2026-11-08T01:17:00.000Z");
const hasStatus = (status: number) => (error: unknown) => error instanceof QuickRecordingError && error.status === status;

function memoryRepository() {
  const sessions = new Map<string, QuickRecordingRow>();
  const scenes = new Map<string, QuickRecordingRow>();
  const writes: string[] = [];
  const portfolios = new Map([[portfolioId, owner], [anotherPortfolioId, owner], [foreignPortfolioId, "owner-b"]]);
  let failScene = false;
  let loseResponse: "session" | "scene" | undefined;
  const duplicate = () => Object.assign(new Error("duplicate key with private row details"), { code: "23505" });
  const repository: QuickRecordingRepository = {
    async ownsPortfolio(ownerId, id) { return portfolios.get(id) === ownerId; },
    async getSession(ownerId, id) {
      const row = sessions.get(id);
      return row?.owner_id === ownerId ? structuredClone(row) : null;
    },
    async insertSession(row) {
      if (sessions.has(String(row.id))) throw duplicate();
      sessions.set(String(row.id), structuredClone(row));
      writes.push("session");
      if (loseResponse === "session") { loseResponse = undefined; throw new Error("session response lost"); }
      return structuredClone(row);
    },
    async listScenes(ownerId, sessionId) {
      return structuredClone([...scenes.values()].filter((row) => row.owner_id === ownerId && row.session_id === sessionId));
    },
    async insertScene(row) {
      if (failScene) { failScene = false; throw new Error("temporary scene outage"); }
      if (scenes.has(String(row.id))) throw duplicate();
      scenes.set(String(row.id), structuredClone(row));
      writes.push("scene");
      if (loseResponse === "scene") { loseResponse = undefined; throw new Error("scene response lost"); }
    },
  };
  return { repository, sessions, scenes, writes,
    failNextSceneInsert() { failScene = true; },
    loseNextResponse(kind: "session" | "scene") { loseResponse = kind; },
  };
}

test("quick camera destination needs no script or title and uses Bogotá calendar time", async () => {
  const store = memoryRepository();
  const result = await createQuickRecording(store.repository, owner, input, now);
  assert.equal(result.reused, false);
  assert.equal(result.session.portfolio_id, portfolioId);
  assert.equal(result.session.owner_id, owner);
  assert.equal(result.session.script, "");
  assert.equal(result.session.status, "recording");
  assert.match(String(result.session.title), /^Grabación · .*07.*11.*2026.*20:17/);
  assert.equal(result.scenes.length, 1);
  assert.deepEqual([result.scenes[0].position, result.scenes[0].script, result.scenes[0].session_id], [0, "", result.session.id]);
  assert.notEqual(result.scenes[0].id, result.session.id);
  assert.deepEqual(store.writes, ["session", "scene"]);
});

test("retries return the same destination without overwriting titles, scripts, status or selected takes", async () => {
  const store = memoryRepository();
  const first = await createQuickRecording(store.repository, owner, { ...input, title: "  Antes de grabar  " }, now);
  assert.equal(first.session.title, "Antes de grabar");
  const session = store.sessions.get(String(first.session.id))!;
  const scene = store.scenes.get(String(first.scenes[0].id))!;
  Object.assign(session, { title: "Renombrada", script: "Libreto corregido", status: "ready_for_edit" });
  Object.assign(scene, { title: "Escena elegida", script: "Voz nueva", position: 4, selected_take_id: "keep-recorded-take" });
  const before = structuredClone({ session, scene });
  const again = await createQuickRecording(store.repository, owner, { ...input, title: "No reemplazar" }, new Date("2027-01-01"));
  assert.equal(again.reused, true);
  assert.deepEqual(again.session, before.session);
  assert.deepEqual(again.scenes, [before.scene]);
  assert.deepEqual(store.writes, ["session", "scene"]);
});

test("concurrent identical requests create one project and one scene", async () => {
  const store = memoryRepository();
  const results = await Promise.all(Array.from({ length: 8 }, () => createQuickRecording(store.repository, owner, input, now)));
  assert.equal(new Set(results.map((item) => item.session.id)).size, 1);
  assert.equal(new Set(results.map((item) => item.scenes[0].id)).size, 1);
  assert.equal(store.sessions.size, 1);
  assert.equal(store.scenes.size, 1);
  assert.deepEqual(store.writes, ["session", "scene"]);
});

test("a partial scene failure repairs the existing project on retry", async () => {
  const store = memoryRepository();
  store.failNextSceneInsert();
  await assert.rejects(createQuickRecording(store.repository, owner, input, now), /scene outage/);
  assert.equal(store.sessions.size, 1);
  assert.equal(store.scenes.size, 0);
  const original = structuredClone([...store.sessions.values()][0]);
  const recovered = await createQuickRecording(store.repository, owner, input, new Date("2027-01-01"));
  assert.equal(recovered.reused, true);
  assert.deepEqual(recovered.session, original);
  assert.equal(recovered.scenes.length, 1);
  assert.deepEqual(store.writes, ["session", "scene"]);
});

test("lost responses after session and scene commits are safely retried", async () => {
  for (const kind of ["session", "scene"] as const) {
    const store = memoryRepository();
    store.loseNextResponse(kind);
    await assert.rejects(createQuickRecording(store.repository, owner, input, now), /response lost/);
    const recovered = await createQuickRecording(store.repository, owner, input, now);
    assert.equal(recovered.reused, true);
    assert.equal(store.sessions.size, 1);
    assert.equal(store.scenes.size, 1);
    assert.deepEqual(store.writes, ["session", "scene"]);
  }
});

test("ownership checks and hidden cross-owner key collisions disclose no existing content", async () => {
  const store = memoryRepository();
  await assert.rejects(createQuickRecording(store.repository, "owner-b", input, now), hasStatus(404));
  assert.deepEqual(store.writes, []);
  await createQuickRecording(store.repository, owner, { ...input, title: "Private title" }, now);
  const before = structuredClone({ sessions: [...store.sessions.values()], scenes: [...store.scenes.values()] });
  await assert.rejects(createQuickRecording(store.repository, "owner-b", { ...input, portfolioId: foreignPortfolioId }, now), (error) => {
    assert.ok(error instanceof QuickRecordingError);
    assert.equal(error.status, 409);
    assert.doesNotMatch(error.message, /Private|owner-a|private row/);
    return true;
  });
  await assert.rejects(createQuickRecording(store.repository, owner, { ...input, portfolioId: anotherPortfolioId }, now), hasStatus(409));
  assert.deepEqual({ sessions: [...store.sessions.values()], scenes: [...store.scenes.values()] }, before);
  assert.deepEqual(store.writes, ["session", "scene"]);
});

test("a hidden scene collision cannot be mistaken for a usable recording destination", async () => {
  const store = memoryRepository();
  const first = await createQuickRecording(store.repository, owner, input, now);
  const existing = store.scenes.get(String(first.scenes[0].id))!;
  Object.assign(existing, { owner_id: "owner-b", session_id: "another-session", title: "Private scene" });
  const before = structuredClone(existing);
  await assert.rejects(createQuickRecording(store.repository, owner, input, now), hasStatus(409));
  assert.deepEqual(existing, before);
  assert.deepEqual(store.writes, ["session", "scene"]);
});

test("retry does not append a blank scene if someone replaced the original scene", async () => {
  const store = memoryRepository();
  const first = await createQuickRecording(store.repository, owner, input, now);
  store.scenes.clear();
  store.scenes.set("manual-scene", { id: "manual-scene", owner_id: owner, session_id: first.session.id, position: 0, title: "Conservar", selected_take_id: "my-take" });
  await assert.rejects(createQuickRecording(store.repository, owner, input, now), hasStatus(409));
  assert.equal(store.scenes.size, 1);
  assert.equal(store.scenes.get("manual-scene")!.selected_take_id, "my-take");
  assert.deepEqual(store.writes, ["session", "scene"]);
});

test("new request IDs create new recordings while UUID letter casing does not duplicate retries", async () => {
  const store = memoryRepository();
  const first = await createQuickRecording(store.repository, owner, input, now);
  const repeated = await createQuickRecording(store.repository, owner, { portfolioId: portfolioId.toUpperCase(), requestId: requestId.toUpperCase() }, now);
  assert.equal(repeated.session.id, first.session.id);
  const next = await createQuickRecording(store.repository, owner, { ...input, requestId: "f54e6240-17cc-4ab1-8a49-787ab466f6ad" }, now);
  assert.notEqual(next.session.id, first.session.id);
  assert.equal(store.sessions.size, 2);
  assert.equal(store.scenes.size, 2);
});

test("invalid input cannot write records or spoof ownership", async () => {
  const store = memoryRepository();
  for (const invalid of [null, {}, { ...input, requestId: "random" }, { ...input, portfolioId: "foreign" },
    { ...input, title: "x".repeat(161) }, { ...input, title: "bad\u0000title" }, { ...input, title: 42 }, { ...input, ownerId: "owner-b" }]) {
    await assert.rejects(createQuickRecording(store.repository, owner, invalid, now), hasStatus(400));
  }
  assert.deepEqual(store.writes, []);
});

test("quick request JSON parsing bounds actual streamed bytes and rejects malformed input", async () => {
  const request = (body: string, extra: Record<string, string> = {}) => new Request("https://studio.test/api/recordings/quick", { method: "POST", headers: { "content-type": "application/json", ...extra }, body });
  assert.deepEqual(await readQuickRecordingInput(request(JSON.stringify(input))), input);
  await assert.rejects(readQuickRecordingInput(request("{broken")), hasStatus(400));
  await assert.rejects(readQuickRecordingInput(request("{}", { "content-type": "text/plain" })), hasStatus(415));
  const headerCases: Record<string, string>[] = [{}, { "content-length": "1" }, { "content-length": "9000" }];
  for (const headers of headerCases) {
    await assert.rejects(readQuickRecordingInput(request(JSON.stringify({ title: "ñ".repeat(2200) }), headers)), hasStatus(413));
  }
});
