import assert from "node:assert/strict";
import test from "node:test";
import { transcribeTakeInBrowser } from "../lib/browser-transcription";

function speechWav() {
  const buffer = new ArrayBuffer(44 + 32_000);
  const view = new DataView(buffer);
  const tag = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, 32_000, true);
  for (let index = 44; index < buffer.byteLength; index += 2) view.setInt16(index, 10_000, true);
  return buffer;
}

test("cancel terminates inference and a subsequent worker failure releases the engine for retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalWorker = globalThis.Worker;
  let notifyPosted: (() => void) | undefined;
  class WorkerStub extends EventTarget {
    static instances: WorkerStub[] = [];
    terminated = false;
    constructor() { super(); WorkerStub.instances.push(this); }
    postMessage() { notifyPosted?.(); }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker;
  globalThis.fetch = async () => new Response(speechWav(), { headers: { "Content-Type": "audio/wav" } });
  const controller = new AbortController();
  const nextController = new AbortController();
  try {
    let posted = new Promise<void>((resolve) => { notifyPosted = resolve; });
    const first = transcribeTakeInBrowser({ takeId: "fixture", durationSeconds: 1, maxWords: 4, signal: controller.signal });
    await posted;
    controller.abort();
    await assert.rejects(first, { name: "AbortError" });
    assert.equal(WorkerStub.instances[0].terminated, true);

    posted = new Promise<void>((resolve) => { notifyPosted = resolve; });
    const retry = transcribeTakeInBrowser({ takeId: "fixture", durationSeconds: 1, maxWords: 4, signal: nextController.signal });
    await posted;
    assert.equal(WorkerStub.instances.length, 2);
    WorkerStub.instances[1].dispatchEvent(new Event("error"));
    await assert.rejects(retry, /No pudimos iniciar/);
    assert.equal(WorkerStub.instances[1].terminated, true);
  } finally {
    controller.abort(); nextController.abort();
    globalThis.fetch = originalFetch;
    globalThis.Worker = originalWorker;
  }
});
