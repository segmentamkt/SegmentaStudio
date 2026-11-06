import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RENDER_PREVIEW_BYTES, parseRenderPreview } from "../lib/render-preview";

const preview = {
  clipIndex: 0, totalClips: 2, takeId: "take-1", title: "Escena uno",
  videoDataUrl: "data:video/mp4;base64,AAAA", durationSeconds: 3,
  captionCount: 2, soundEffectCount: 1, removedSilenceSeconds: .5,
};

test("streamed scene previews accept bounded inline MP4 data and real scene indices", () => {
  assert.deepEqual(parseRenderPreview(preview), preview);
  for (const patch of [
    { videoDataUrl: "https://external.example/private.mp4" },
    { videoDataUrl: "data:text/html;base64,AAAA" },
    { videoDataUrl: "data:video/mp4;base64,bad body" },
    { videoDataUrl: `data:video/mp4;base64,${"A".repeat(Math.ceil(MAX_RENDER_PREVIEW_BYTES / 3) * 4 + 4)}` },
    { clipIndex: 2 }, { clipIndex: -1 }, { totalClips: 13 }, { durationSeconds: 4 },
    { removedSilenceSeconds: NaN }, { captionCount: -1 }, { soundEffectCount: Infinity },
  ]) assert.equal(parseRenderPreview({ ...preview, ...patch }), null);
});
