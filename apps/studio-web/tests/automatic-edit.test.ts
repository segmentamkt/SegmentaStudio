import assert from "node:assert/strict";
import test from "node:test";
import { runAutomaticEdit, type AutomaticEditStage, type AutomaticEditSteps } from "../lib/automatic-edit";

function setup(overrides: Partial<AutomaticEditSteps<{ captions: string[] }, { id: string }, { url: string }>> = {}) {
  const controller = new AbortController();
  const stages: AutomaticEditStage[] = [];
  const calls: string[] = [];
  const steps: AutomaticEditSteps<{ captions: string[] }, { id: string }, { url: string }> = {
    signal: controller.signal,
    captureDraft: () => { calls.push("capture"); return { captions: ["Hola"] }; },
    transcribe: async () => { calls.push("transcribe"); return true; },
    prepare: async () => { calls.push("prepare"); return { id: "fresh-job" }; },
    render: async () => { calls.push("render"); return { url: "/final.mp4" }; },
    onStage: (stage) => { stages.push(stage); },
    ...overrides,
  };
  return { controller, stages, calls, steps };
}

test("automatic edit captures new captions after transcription and renders the returned job", async () => {
  let draft = { captions: [] as string[] };
  const currentJob = { id: "new-job-with-captions" };
  const result = { url: "/verified-new.mp4" };
  const fixture = setup({
    transcribe: async () => { await Promise.resolve(); draft = { captions: ["Voz reconocida"] }; return true; },
    captureDraft: () => draft,
    prepare: async (snapshot) => { assert.deepEqual(snapshot.captions, ["Voz reconocida"]); return currentJob; },
    render: async (job) => { assert.equal(job, currentJob); return result; },
  });
  assert.equal(await runAutomaticEdit(fixture.steps), result);
  assert.deepEqual(fixture.stages, ["captions", "plan", "render", "done"]);
});

test("optional resources use completed captions and enter the captured draft before planning", async () => {
  const calls: string[] = [];
  const draft = { captions: [] as string[], imageCount: 0 };
  const fixture = setup({
    transcribe: async () => { calls.push("transcribe"); draft.captions = ["Hablemos de dinero"]; return true; },
    addResources: async () => {
      calls.push("resources");
      assert.deepEqual(draft.captions, ["Hablemos de dinero"]);
      await Promise.resolve();
      draft.imageCount = 1;
    },
    captureDraft: () => { calls.push("capture"); assert.equal(draft.imageCount, 1); return { ...draft }; },
    prepare: async (snapshot) => { calls.push("prepare"); assert.deepEqual(snapshot, draft); return { id: "with-image" }; },
    render: async (job) => { calls.push("render"); assert.equal(job.id, "with-image"); return { url: "/with-image.mp4" }; },
  });
  assert.deepEqual(await runAutomaticEdit(fixture.steps), { url: "/with-image.mp4" });
  assert.deepEqual(calls, ["transcribe", "resources", "capture", "prepare", "render"]);
  assert.deepEqual(fixture.stages, ["captions", "resources", "plan", "render", "done"]);
});

test("a synchronous resource callback is supported and missing captions never invoke it", async () => {
  let resourceCalls = 0;
  const fixture = setup({ addResources: () => { resourceCalls += 1; } });
  await runAutomaticEdit(fixture.steps);
  assert.equal(resourceCalls, 1);
  const missing = setup({ transcribe: async () => false, addResources: () => { resourceCalls += 1; } });
  await assert.rejects(runAutomaticEdit(missing.steps), /Faltan subtítulos/);
  assert.equal(resourceCalls, 1);
  assert.deepEqual(missing.stages, ["captions"]);
  assert.deepEqual(missing.calls, []);
});

test("missing captions stop the chain before draft capture, planning and rendering", async () => {
  const fixture = setup({ transcribe: async () => false });
  await assert.rejects(runAutomaticEdit(fixture.steps), /Faltan subtítulos/);
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.stages, ["captions"]);
});

test("preparation failure never starts render and render failure never announces done", async () => {
  const planFailure = setup({ prepare: async () => null });
  await assert.rejects(runAutomaticEdit(planFailure.steps), /No se pudo preparar/);
  assert.equal(planFailure.calls.includes("render"), false);
  assert.deepEqual(planFailure.stages, ["captions", "plan"]);

  const renderFailure = setup({ render: async () => null });
  await assert.rejects(runAutomaticEdit(renderFailure.steps), /No se pudo confirmar/);
  assert.deepEqual(renderFailure.stages, ["captions", "plan", "render"]);
});

test("a cancelled run starts no operation, including when cancellation happens in a stage callback", async () => {
  const cancelled = setup();
  cancelled.controller.abort();
  await assert.rejects(runAutomaticEdit(cancelled.steps), { name: "AbortError" });
  assert.deepEqual(cancelled.stages, []);
  assert.deepEqual(cancelled.calls, []);

  const fromCallback = setup();
  fromCallback.steps.onStage = () => fromCallback.controller.abort();
  await assert.rejects(runAutomaticEdit(fromCallback.steps), { name: "AbortError" });
  assert.deepEqual(fromCallback.calls, []);
});

test("late completion after cancellation cannot move to the next step or announce done", async () => {
  for (const cancelledStep of ["transcribe", "addResources", "prepare", "render"] as const) {
    const fixture = setup();
    let complete: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { complete = resolve; });
    let entered: (() => void) | undefined;
    const didEnter = new Promise<void>((resolve) => { entered = resolve; });
    if (cancelledStep === "transcribe") fixture.steps.transcribe = async () => { entered!(); await waiting; return true; };
    if (cancelledStep === "addResources") fixture.steps.addResources = async () => { entered!(); await waiting; };
    if (cancelledStep === "prepare") fixture.steps.prepare = async () => { entered!(); await waiting; return { id: "late-job" }; };
    if (cancelledStep === "render") fixture.steps.render = async () => { entered!(); await waiting; return { url: "/late.mp4" }; };
    const running = runAutomaticEdit(fixture.steps);
    await didEnter;
    fixture.controller.abort();
    complete!();
    await assert.rejects(running, { name: "AbortError" });
    assert.equal(fixture.stages.includes("done"), false);
    if (cancelledStep !== "render") assert.equal(fixture.stages.includes("render"), false);
    if (cancelledStep === "transcribe" || cancelledStep === "addResources") {
      assert.equal(fixture.stages.includes("plan"), false);
      assert.equal(fixture.calls.includes("capture"), false);
    }
  }
});

test("cancellation when entering the resources stage starts no resource operation", async () => {
  const fixture = setup();
  fixture.steps.addResources = () => { fixture.calls.push("resources"); };
  fixture.steps.onStage = (stage) => {
    fixture.stages.push(stage);
    if (stage === "resources") fixture.controller.abort();
  };
  await assert.rejects(runAutomaticEdit(fixture.steps), { name: "AbortError" });
  assert.deepEqual(fixture.calls, ["transcribe"]);
  assert.deepEqual(fixture.stages, ["captions", "resources"]);
});

test("resource failures keep their cause and never capture, plan or render an incomplete draft", async () => {
  for (const asynchronous of [false, true]) {
    const error = new Error("La imagen de apoyo no se pudo preparar.");
    const fixture = setup({ addResources: asynchronous ? async () => { throw error; } : () => { throw error; } });
    await assert.rejects(runAutomaticEdit(fixture.steps), (reason) => reason === error);
    assert.deepEqual(fixture.calls, ["transcribe"]);
    assert.deepEqual(fixture.stages, ["captions", "resources"]);
  }
});

test("underlying failures retain their cause and stop subsequent operations", async () => {
  const error = new Error("La toma no contiene una pista de voz.");
  const fixture = setup({ transcribe: async () => { throw error; } });
  await assert.rejects(runAutomaticEdit(fixture.steps), (reason) => reason === error);
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.stages, ["captions"]);
});
