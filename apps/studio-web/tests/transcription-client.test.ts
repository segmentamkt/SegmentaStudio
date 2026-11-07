import assert from "node:assert/strict";
import test from "node:test";
import { clearSpeechTranscriptionCache, transcribeTakeInBrowser } from "../lib/browser-transcription";
import type { SpeechWorkerRequest } from "../lib/transcription.worker";

function speechWav(duration = 1, audible = true) {
  const size = Math.round(duration * 32_000);
  const buffer = new ArrayBuffer(44 + size);
  const view = new DataView(buffer);
  const tag = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, size, true);
  for (let index = 44; index < buffer.byteLength; index += 2) view.setInt16(index, audible ? 10_000 : 0, true);
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
    clearSpeechTranscriptionCache();
    globalThis.fetch = originalFetch;
    globalThis.Worker = originalWorker;
  }
});

async function withRecognizingWorker(run: (calls: SpeechWorkerRequest[]) => Promise<void>) {
  const originalFetch = globalThis.fetch, originalWorker = globalThis.Worker;
  const calls: SpeechWorkerRequest[] = [];
  class WorkerStub extends EventTarget {
    postMessage(request: SpeechWorkerRequest) {
      calls.push(request);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: {
        id: request.id, type: "result", result: {
          transcript: "Voz real", captionCues: [{ startSeconds: 1.2, endSeconds: 2, text: "Voz real" }],
          words: [{ text: "Voz", startInSeconds: 1.2, endInSeconds: 1.5 }, { text: "real", startInSeconds: 1.6, endInSeconds: 2 }],
        },
      } })));
    }
    terminate() {}
  }
  clearSpeechTranscriptionCache();
  globalThis.Worker = WorkerStub as unknown as typeof Worker;
  try { await run(calls); }
  finally { clearSpeechTranscriptionCache(); globalThis.fetch = originalFetch; globalThis.Worker = originalWorker; }
}

test("a trim after minute two requests bounded audio with absolute caption offsets", async () => withRecognizingWorker(async (calls) => {
  const requested: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://fixture"); requested.push(url);
    const duration = Number(url.searchParams.get("endSeconds")) - Number(url.searchParams.get("startSeconds"));
    return new Response(speechWav(duration), { headers: { "Content-Type": "audio/wav" } });
  };
  const result = await transcribeTakeInBrowser({ takeId: "long-fixture", durationSeconds: 3600, ranges: [{ startSeconds: 300, endSeconds: 320 }], maxWords: 4 });
  assert.equal(requested.length, 1);
  assert.equal(requested[0].searchParams.get("startSeconds"), "299");
  assert.equal(requested[0].searchParams.get("endSeconds"), "321");
  assert.equal(calls[0].waveform.length, 22 * 16_000);
  assert.equal(result.captionCues[0].startSeconds, 300.2);
  assert.equal(result.transcript, "Voz real");
}));

test("retry reuses successful chunks and does not download or recognize the source again", async () => withRecognizingWorker(async (calls) => {
  let failSecond = true;
  const requests: number[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://fixture");
    const start = Number(url.searchParams.get("startSeconds")), end = Number(url.searchParams.get("endSeconds")); requests.push(start);
    if (start > 0 && failSecond) { failSecond = false; return Response.json({ error: "Red interrumpida" }, { status: 503 }); }
    return new Response(speechWav(end - start));
  };
  const input = { takeId: "retry-fixture", durationSeconds: 180, maxWords: 4 };
  await assert.rejects(transcribeTakeInBrowser(input), /Tramo 2.*Red interrumpida/);
  const result = await transcribeTakeInBrowser(input);
  assert.deepEqual(requests, [0, 89, 89]);
  assert.equal(calls.length, 2);
  assert.ok(result.captionCues.some((cue) => cue.startSeconds > 90));
  assert.ok(calls.every((call) => call.waveform.length <= 92 * 16_000));
}));

test("silent chunks do not erase spoken chunks and oversized responses remain blocked", async () => withRecognizingWorker(async (calls) => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://fixture");
    const start = Number(url.searchParams.get("startSeconds")), end = Number(url.searchParams.get("endSeconds"));
    return new Response(speechWav(end - start, start > 0));
  };
  const result = await transcribeTakeInBrowser({ takeId: "silent-start", durationSeconds: 180, maxWords: 4 });
  assert.equal(calls.length, 1);
  assert.equal(result.captionCues[0].startSeconds, 90.2);
  globalThis.fetch = async () => new Response(new Uint8Array(4_500_001));
  await assert.rejects(transcribeTakeInBrowser({ takeId: "oversized", durationSeconds: 10, maxWords: 4 }), /demasiado grande/);
}));
