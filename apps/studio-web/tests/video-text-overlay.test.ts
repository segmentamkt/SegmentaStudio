import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { renderTextOverlay } from "../lib/video-text-overlay";

test("layered captions render white words with a visible yellow emphasis", async () => {
  const png = await renderTextOverlay({
    text: "Y ESO LO CAMBIA",
    fontFile: join(process.cwd(), "assets", "fonts", "Inter.ttf"),
    fontSize: 76,
    textColor: "#FFFFFF",
    boxColor: "#09090B",
    boxOpacity: .34,
    highlightLastWord: true,
    highlightColor: "#FACC15",
  });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let white = 0;
  let yellow = 0;
  for (let pixel = 0; pixel < data.length; pixel += info.channels) {
    const [red, green, blue, alpha] = data.subarray(pixel, pixel + 4);
    if (alpha < 180) continue;
    if (red > 220 && green > 220 && blue > 220) white += 1;
    if (red > 180 && green > 130 && blue < 120) yellow += 1;
  }
  assert.ok(white > 100, "The base words should remain readable in white");
  assert.ok(yellow > 100, "The emphasized word should be yellow in the PNG used by FFmpeg");
});
