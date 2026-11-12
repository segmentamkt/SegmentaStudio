import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSrt, srtTimestamp } from "../lib/srt";

test("SRT timestamps and blocks follow the standard format", () => {
  assert.equal(srtTimestamp(3725.4567), "01:02:05,457");
  assert.equal(srtTimestamp(-1), "00:00:00,000");
  assert.equal(buildSrt([
    { start: 2.5, end: 4, text: "segunda  línea" },
    { start: 0, end: 1.25, text: "Hola" },
    { start: 5, end: 5.01, text: "muy corto" },
    { start: 6, end: 7, text: "   " },
  ]), "1\n00:00:00,000 --> 00:00:01,250\nHola\n\n2\n00:00:02,500 --> 00:00:04,000\nsegunda línea\n");
});
