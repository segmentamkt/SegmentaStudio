import assert from "node:assert/strict";
import { test } from "node:test";
import { capture } from "../lib/cloud-video-renderer";

test("FFmpeg stderr stays bounded while silence events are streamed", async () => {
  const lines: string[] = [];
  const script = [
    "process.stderr.write('Duration: 00:00:03.00\\n');",
    "process.stderr.write('silence_start: 0.5\\n');",
    "for (let i = 0; i < 12000; i++) process.stderr.write('warning ' + 'x'.repeat(1000) + '\\n');",
    "process.stderr.write('silence_end: 1.5 | silence_duration: 1.0\\n');",
  ].join("");
  const result = await capture(process.execPath, ["-e", script], { timeoutMs: 10_000, onStderrLine: (line) => {
    if (line.includes("silence_")) lines.push(line);
  } });
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.ok(result.stderr.length < 170_000, `diagnostics retained ${result.stderr.length} characters`);
  assert.match(result.stderr, /Duration: 00:00:03\.00/);
  assert.match(result.stderr, /silence_end: 1\.5/);
  assert.deepEqual(lines, ["silence_start: 0.5", "silence_end: 1.5 | silence_duration: 1.0"]);
});

test("a stalled FFmpeg process is terminated after the configured timeout", async () => {
  const started = Date.now();
  const result = await capture(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 150 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - started < 3000);
});
