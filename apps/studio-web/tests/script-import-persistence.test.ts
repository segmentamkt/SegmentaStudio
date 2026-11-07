import test from "node:test";
import assert from "node:assert/strict";
import { createImportedScriptProject, ScriptImportError, type ImportRow, type ScriptImportRepository } from "../lib/script-import-persistence";
import { readScriptRequestBody } from "../lib/script-import-http";

const owner = "owner-a";
const portfolioId = "217ea0b2-37d2-4092-b678-18238e352300";
const input = {
  portfolioId,
  importId: "42d6e138-4c9d-4bf4-96fc-b66df3bb9ac0",
  project: {
    id: "episode-01", title: "E01 · Despedida", script: "¿Le tocó organizar? Nosotros ponemos la comida. Escríbanos.",
    scenes: [
      { id: "hook", title: "HOOK", script: "¿Le tocó organizar?" },
      { id: "value", title: "VALOR", script: "Nosotros ponemos la comida." },
      { id: "cta", title: "CTA", script: "Escríbanos." },
    ],
  },
};

function memoryRepository() {
  const sessions = new Map<string, ImportRow>();
  const scenes = new Map<string, ImportRow>();
  const writes: string[] = [];
  let failScenes = false;
  let loseSceneResponse = false;
  const duplicate = () => Object.assign(new Error("duplicate primary key"), { code: "23505" });
  const repository: ScriptImportRepository = {
    async ownsPortfolio(ownerId, id) { return ownerId === owner && id === portfolioId; },
    async getSession(ownerId, id) {
      const row = sessions.get(id);
      return row?.owner_id === ownerId ? structuredClone(row) : null;
    },
    async insertSession(row) {
      if (sessions.has(String(row.id))) throw duplicate();
      sessions.set(String(row.id), structuredClone(row));
      writes.push("session");
      return structuredClone(row);
    },
    async listScenes(ownerId, sessionId) {
      return structuredClone([...scenes.values()].filter((row) => row.owner_id === ownerId && row.session_id === sessionId));
    },
    async insertScenes(rows) {
      if (failScenes) { failScenes = false; throw new Error("temporary database outage"); }
      if (rows.some((row) => scenes.has(String(row.id)))) throw duplicate();
      // A single PostgreSQL insert is atomic for the whole group.
      rows.forEach((row) => scenes.set(String(row.id), structuredClone(row)));
      writes.push(`scenes:${rows.length}`);
      if (loseSceneResponse) { loseSceneResponse = false; throw new Error("response lost after commit"); }
    },
  };
  return { repository, sessions, scenes, writes,
    failNextSceneInsert() { failScenes = true; },
    loseNextSceneResponse() { loseSceneResponse = true; },
  };
}

test("imports one cloud folder with chronological scenes, then reuses it without touching selected takes", async () => {
  const store = memoryRepository();
  const first = await createImportedScriptProject(store.repository, owner, input);
  assert.equal(first.reused, false);
  assert.deepEqual(first.scenes.map((row) => [row.position, row.title, row.script]), input.project.scenes.map((row, position) => [position, row.title, row.script]));
  assert.equal(first.session.portfolio_id, portfolioId);
  assert.match(String(first.session.id), /^[a-f0-9-]{36}$/);
  store.scenes.get(String(first.scenes[0].id))!.selected_take_id = "already-recorded-take";
  store.sessions.get(String(first.session.id))!.status = "ready_for_edit";
  const second = await createImportedScriptProject(store.repository, owner, structuredClone(input));
  assert.equal(second.reused, true);
  assert.equal(second.session.id, first.session.id);
  assert.equal(second.session.status, "ready_for_edit");
  assert.equal(second.scenes[0].selected_take_id, "already-recorded-take");
  assert.deepEqual(store.writes, ["session", "scenes:3"]);
});

test("concurrent identical submissions create exactly one folder and one set of scenes", async () => {
  const store = memoryRepository();
  const results = await Promise.all(Array.from({ length: 5 }, () => createImportedScriptProject(store.repository, owner, input)));
  assert.equal(new Set(results.map((result) => result.session.id)).size, 1);
  assert.equal(store.sessions.size, 1);
  assert.equal(store.scenes.size, 3);
  assert.deepEqual(store.writes, ["session", "scenes:3"]);
});

test("a failed scene insert resumes the existing folder on retry instead of deleting or duplicating it", async () => {
  const store = memoryRepository();
  store.failNextSceneInsert();
  await assert.rejects(createImportedScriptProject(store.repository, owner, input), /outage/);
  assert.equal(store.sessions.size, 1);
  assert.equal(store.scenes.size, 0);
  const recovered = await createImportedScriptProject(store.repository, owner, input);
  assert.equal(recovered.reused, true);
  assert.equal(recovered.scenes.length, 3);
  assert.equal(store.sessions.size, 1);
});

test("a lost response after the insert commits is safely retried", async () => {
  const store = memoryRepository();
  store.loseNextSceneResponse();
  await assert.rejects(createImportedScriptProject(store.repository, owner, input), /response lost/);
  const recovered = await createImportedScriptProject(store.repository, owner, input);
  assert.equal(recovered.reused, true);
  assert.equal(store.scenes.size, 3);
  assert.deepEqual(store.writes, ["session", "scenes:3"]);
});

test("partial scene recovery only fills missing rows and retains recorded scene selection", async () => {
  const store = memoryRepository();
  const first = await createImportedScriptProject(store.repository, owner, input);
  store.scenes.delete(String(first.scenes[2].id));
  store.scenes.get(String(first.scenes[0].id))!.selected_take_id = "keep-this-take";
  const recovered = await createImportedScriptProject(store.repository, owner, input);
  assert.equal(recovered.scenes.length, 3);
  assert.equal(recovered.scenes[0].selected_take_id, "keep-this-take");
  assert.deepEqual(store.writes, ["session", "scenes:3", "scenes:1"]);
});

test("foreign ownership and malformed or oversized payloads cannot write rows", async () => {
  const store = memoryRepository();
  await assert.rejects(createImportedScriptProject(store.repository, "other-user", input), (error: unknown) => error instanceof ScriptImportError && error.status === 404);
  const invalid = [null, {}, { ...input, importId: "random" }, { ...input, portfolioId: "foreign" },
    { ...input, project: { ...input.project, title: "x".repeat(161) } },
    { ...input, project: { ...input.project, script: "x".repeat(6001) } },
    { ...input, project: { ...input.project, script: "   " } },
    { ...input, project: { ...input.project, notes: "x".repeat(6000) } },
    { ...input, project: { ...input.project, scenes: [] } },
    { ...input, project: { ...input.project, scenes: Array.from({ length: 13 }, (_, i) => ({ id: String(i), title: "Scene", script: "" })) } },
    { ...input, project: { ...input.project, scenes: [{ id: "s", title: "Scene", script: "x".repeat(1001) }] } },
    { ...input, project: { ...input.project, scenes: [{ id: "s", title: "Scene", script: "  " }] } },
    { ...input, project: { ...input.project, scenes: [input.project.scenes[0], input.project.scenes[0]] } },
  ];
  for (const draft of invalid) {
    await assert.rejects(createImportedScriptProject(store.repository, owner, draft), ScriptImportError);
  }
  assert.deepEqual(store.writes, []);
});

test("production notes survive import without entering teleprompter scenes", async () => {
  const store = memoryRepository();
  const result = await createImportedScriptProject(store.repository, owner, { ...input, project: { ...input.project, notes: "Duración 30–35 segundos. Apoyo de la lechona." } });
  assert.match(String(result.session.script), /Indicaciones de producción\nDuración 30–35 segundos/);
  assert.deepEqual(result.scenes.map((scene) => scene.script), input.project.scenes.map((scene) => scene.script));
});

test("retries never overwrite a changed title, script, scene order or scene content", async () => {
  for (const edit of [
    (store: ReturnType<typeof memoryRepository>) => { [...store.sessions.values()][0].title = "Renamed by user"; },
    (store: ReturnType<typeof memoryRepository>) => { [...store.sessions.values()][0].script = "Revised script"; },
    (store: ReturnType<typeof memoryRepository>) => { [...store.scenes.values()][0].script = "Revised scene"; },
    (store: ReturnType<typeof memoryRepository>) => { [...store.scenes.values()][0].position = 2; },
  ]) {
    const store = memoryRepository();
    await createImportedScriptProject(store.repository, owner, input);
    edit(store);
    const before = structuredClone({ sessions: [...store.sessions.values()], scenes: [...store.scenes.values()] });
    await assert.rejects(createImportedScriptProject(store.repository, owner, input), (error: unknown) => error instanceof ScriptImportError && error.status === 409);
    assert.deepEqual({ sessions: [...store.sessions.values()], scenes: [...store.scenes.values()] }, before);
    assert.deepEqual(store.writes, ["session", "scenes:3"]);
  }
});

test("separate import/project identities produce separate folders", async () => {
  const store = memoryRepository();
  await createImportedScriptProject(store.repository, owner, input);
  await createImportedScriptProject(store.repository, owner, { ...input, project: { ...input.project, id: "episode-02" } });
  await createImportedScriptProject(store.repository, owner, { ...input, importId: "f54e6240-17cc-4ab1-8a49-787ab466f6ad" });
  assert.equal(store.sessions.size, 3);
  assert.equal(store.scenes.size, 9);
});

test("request body limit handles missing and misleading content-length as well as normal JSON", async () => {
  const small = new Request("https://studio.test/api/scripts", { method: "POST", body: "hello" });
  assert.equal(await (await readScriptRequestBody(small, 5)).text(), "hello");
  const cases: Record<string, string>[] = [{}, { "content-length": "1" }, { "content-length": "2000" }];
  for (const headers of cases) {
    const request = new Request("https://studio.test/api/scripts", { method: "POST", headers, body: "more than five" });
    await assert.rejects(readScriptRequestBody(request, 5), (error: unknown) => error instanceof ScriptImportError && error.status === 413);
  }
});
