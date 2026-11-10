import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { clampCueWords, mapCaptionCues, retimeEditedCue, sanitizeCueWords, splitCueAt, type CaptionCue } from "../lib/caption-cues";
import { getEditorStyle } from "../lib/editor-presets";
import { renderSequentialClip } from "../lib/sequential-cloud-video-renderer";
import { buildKineticLayer, KINETIC_TIMING, planKineticCaptions, renderWordSprite, summarizeKineticPlan, wordFrames } from "../lib/skills/subtitulos-cineticos";
import { timedCaptionCards } from "../lib/transcription-core";

const fontDir = join(process.cwd(), "assets", "fonts");

function cue(text: string, timings: Array<[number, number]>): CaptionCue {
  const tokens = text.split(" ");
  return {
    startSeconds: timings[0][0], endSeconds: timings[timings.length - 1][1] + .08, text,
    words: tokens.map((token, index) => ({ text: token, startSeconds: timings[index][0], endSeconds: timings[index][1] })),
  };
}

test("shows exactly one word at a time, holds it across short gaps and hides it during real pauses", () => {
  const words = planKineticCaptions([
    cue("Esto cambia todo", [[0, .3], [.4, .8], [.85, 1.2]]),
    cue("pero escucha", [[2.2, 2.5], [2.55, 3]]),
  ]);
  assert.deepEqual(words.map((word) => word.text), ["Esto", "cambia", "todo", "pero", "escucha"]);
  for (let index = 1; index < words.length; index += 1) assert.ok(words[index].startSeconds >= words[index - 1].endSeconds, "two words never overlap");
  assert.equal(words[0].endSeconds, .4, "a 0.1 s gap keeps the word until the next one");
  assert.equal(words[2].endSeconds, 1.2 + KINETIC_TIMING.tailSeconds, "a 1 s pause hides the word after a short tail");
  const visibleDuringPause = words.some((word) => word.startSeconds < 1.8 && word.endSeconds > 1.4);
  assert.equal(visibleDuringPause, false, "no text during the pause");
  assert.ok(words.every((word) => !word.estimated));
});

test("numbers, brands and *marked* words go orange; short function words are light; brand spelling is exact", () => {
  const words = planKineticCaptions([
    cue("más de 100 mil anunciantes usan chatgpt y meta ads con *Segmenta* de verdad", [
      [0, .2], [.2, .3], [.3, .6], [.6, .8], [.8, 1.4], [1.4, 1.6], [1.6, 2], [2, 2.1], [2.1, 2.4], [2.4, 2.7], [2.7, 2.9], [2.9, 3.4], [3.4, 3.5], [3.5, 3.9],
    ]),
  ], { autoEmphasis: false });
  const byText = new Map(words.map((word) => [word.text, word.style]));
  assert.equal(byText.get("100"), "enfasis");
  assert.equal(byText.get("mil"), "enfasis");
  assert.equal(byText.get("ChatGPT"), "enfasis");
  assert.equal(byText.get("Meta"), "enfasis");
  assert.equal(byText.get("Ads"), "enfasis");
  assert.equal(byText.get("Segmenta"), "enfasis", "asterisks force emphasis and are not drawn");
  assert.equal(byText.get("de"), "ligera");
  assert.equal(byText.get("y"), "ligera");
  assert.equal(byText.get("anunciantes"), "normal");
  assert.ok(!words.some((word) => word.text.includes("*")));
});

test("«meta» as a common word is not treated as the brand", () => {
  const words = planKineticCaptions([cue("mi meta es crecer", [[0, .2], [.2, .5], [.5, .6], [.6, 1]])], { autoEmphasis: false });
  assert.equal(words[1].text, "meta");
  assert.equal(words[1].style, "normal");
});

test("automatic emphasis marks about one key word per 5–8 words, never everything", () => {
  const text = "En el restaurante preparamos esta deliciosa lechona tradicional perfecta para compartir con todo tu equipo de trabajo";
  const tokens = text.split(" ");
  const words = planKineticCaptions([cue(text, tokens.map((_, index) => [index * .4, index * .4 + .35] as [number, number]))]);
  const summary = summarizeKineticPlan(words);
  assert.ok(summary.emphasis >= 2 && summary.emphasis <= 4, `emphasis ${summary.emphasis}`);
  assert.ok(summary.emphasisRatio <= .25);
  const emphasized = words.filter((word) => word.style === "enfasis").map((word) => word.text);
  assert.ok(emphasized.includes("trabajo") || emphasized.includes("equipo"));
});

test("an edited cue keeps real timing when the word count matches and is estimated otherwise", () => {
  const original = cue("en el elección", [[0, .2], [.2, .4], [.4, 1]]);
  const fixed = retimeEditedCue(original, "en El Lechón");
  assert.deepEqual(fixed.words?.map((word) => word.text), ["en", "El", "Lechón"]);
  assert.equal(planKineticCaptions([fixed])[2].startSeconds, .4);
  const rewritten = retimeEditedCue(original, "en El Lechón del Tolima");
  assert.equal(rewritten.words, undefined);
  const estimated = planKineticCaptions([rewritten]);
  assert.equal(estimated.length, 5);
  assert.ok(estimated.every((word) => word.estimated));
  assert.ok(estimated[0].startSeconds >= rewritten.startSeconds && estimated[4].endSeconds <= rewritten.endSeconds + KINETIC_TIMING.tailSeconds + 1e-9);
});

test("word timings survive silence removal and speed, and words inside a removed pause disappear", () => {
  const source = cue("hola pausa mundo", [[0, .4], [1.1, 1.3], [2, 2.5]]);
  const mapped = mapCaptionCues([source], [{ start: 0, end: .5 }, { start: 1.9, end: 2.6 }]);
  assert.deepEqual(mapped[0].words?.map((word) => [word.text, Number(word.startSeconds.toFixed(2))]), [["hola", 0], ["pausa", .5], ["mundo", .6]]);
  const words = planKineticCaptions(mapped);
  assert.deepEqual(words.map((word) => word.text), ["hola", "mundo"], "the removed word is not shown");
});

test("caption cards from the recognizer keep per-word timing, and edits split words honestly", () => {
  const cards = timedCaptionCards([
    { text: "Uno", startInSeconds: 0, endInSeconds: .3 },
    { text: "dos", startInSeconds: .35, endInSeconds: .6 },
    { text: "tres", startInSeconds: .65, endInSeconds: .9 },
  ], 5, 4);
  assert.deepEqual(cards[0].words?.map((word) => word.text), ["Uno", "dos", "tres"]);
  const left = splitCueAt(cards[0], .62, "left");
  const right = splitCueAt(cards[0], .62, "right");
  assert.equal(left.text, "Uno dos");
  assert.equal(right.text, "tres");
  assert.deepEqual(clampCueWords(cards[0].words, .25, .7)?.map((word) => word.text), ["Uno", "dos", "tres"]);
  assert.deepEqual(clampCueWords(cards[0].words, .3, .7)?.map((word) => word.text), ["dos", "tres"], "a word that ends at the cut stays on its side");
  assert.equal(sanitizeCueWords([{ text: "x", startSeconds: 9, endSeconds: 10 }], { startSeconds: 0, endSeconds: 1 }), undefined);
  assert.equal(sanitizeCueWords(Array.from({ length: 17 }, () => ({ text: "x", startSeconds: 0, endSeconds: .1 })), { startSeconds: 0, endSeconds: 1 }), undefined);
});

test("words are drawn with Montserrat: orange glow for emphasis, white for the rest", async () => {
  const emphasis = await renderWordSprite("Ventas", "enfasis", { fontDir });
  const normal = await renderWordSprite("Ventas", "normal", { fontDir });
  const light = await renderWordSprite("Ventas", "ligera", { fontDir });
  assert.ok(emphasis.fontSize > normal.fontSize && normal.fontSize > light.fontSize);
  const count = (sprite: typeof normal, matcher: (r: number, g: number, b: number) => boolean) => {
    let total = 0;
    for (let index = 0; index < sprite.data.length; index += 4) {
      const [r, g, b, a] = sprite.data.subarray(index, index + 4);
      if (a > 200 && matcher(r, g, b)) total += 1;
    }
    return total;
  };
  assert.ok(count(emphasis, (r, g, b) => r > 230 && g > 90 && g < 150 && b < 40) > 2_000, "orange #FF7A00 fill");
  assert.ok(count(normal, (r, g, b) => r > 245 && g > 245 && b > 245) > 2_000, "white fill");
  assert.equal(count(normal, (r, g, b) => r > 230 && g < 150 && b < 40), 0, "no orange on normal words");
  // Bold vs light strokes really come from different font files (no silent fallback).
  assert.ok(count(normal, (r, g, b) => r > 245 && g > 245 && b > 245) > count(light, (r, g, b) => r > 245 && g > 245 && b > 245) * 1.8);
  const tooLong = await renderWordSprite("Supercalifragilísticoespialidoso", "enfasis", { fontDir });
  assert.ok(tooLong.width <= 1080, "long words shrink to fit the frame");
});

test("animation frames add up to the visible time and end fully opaque before the exit", () => {
  for (const visible of [.05, .2, .5, 2]) {
    for (const style of ["normal", "enfasis", "ligera"] as const) {
      const frames = wordFrames(style, visible);
      const total = frames.reduce((sum, frame) => sum + frame.seconds, 0);
      assert.ok(Math.abs(total - visible) < 1e-6, `${style} ${visible}`);
      assert.ok(frames.every((frame) => frame.alpha >= 0 && frame.alpha <= 1 && frame.scale > .5 && frame.scale < 1.4));
    }
  }
  const frames = wordFrames("enfasis", 1);
  assert.ok(frames[0].scale > 1.2, "emphasis enters from a larger scale");
  assert.ok(frames.some((frame) => frame.scale === 1 && frame.alpha === 1 && frame.seconds > .5));
});

test("the layer is one concat input with exact cumulative timing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "segmenta-kinetic-layer-"));
  try {
    const words = planKineticCaptions([cue("Hola equipo", [[.5, .8], [.85, 1.3]])]);
    const layer = await buildKineticLayer(words, { directory, fontDir, durationSeconds: 3 });
    assert.ok(layer);
    const list = await readFile(layer!.listFile, "utf8");
    const total = [...list.matchAll(/^duration (\S+)$/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
    assert.ok(Math.abs(total - 3) < 1e-4, `layer covers the whole take: ${total}`);
    assert.ok(layer!.bandY > 1920 * .5 && layer!.bandY + layer!.bandHeight < 1920, "chest zone, inside the frame");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the production renderer burns one word at a time with the Segmenta style", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-kinetic-render-"));
  const source = join(directory, "source.mp4");
  const output = join(directory, "out.mp4");
  try {
    const made = spawnSync(ffmpegPath!, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x203040:s=540x960:r=30:d=3",
      "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:duration=3", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", source], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    const style = getEditorStyle("segmenta-cinetico");
    const cues = [cue("Vendemos 300 lechonas", [[.3, .7], [.8, 1.2], [1.25, 1.7]])];
    const contract = {
      objective: "Prueba", session: { title: "" },
      clips: [{ id: "a", name: "Toma", object_key: "a", duration_seconds: 3, transcript: cues[0].text, caption_cues: cues }],
      style_snapshot: { ...style, subtitle: { ...style.subtitle }, execution: { ...style.execution } },
      captions: { enabled: true, max_words_per_card: 4 },
      dead_air: { remove: false, threshold_ms: 700 },
      effects: { transitions: false, sound_effects: false, labels: false },
    };
    const rendered = await renderSequentialClip({
      command: ffmpegPath!, contract: contract as never, analysis: { duration: 3, ranges: [{ start: 0, end: 3 }], removed: 0, hasAudio: true },
      url: source, index: 0, output, videoKbps: 2000, transitionSeconds: 0, deadline: Date.now() + 120_000,
    });
    assert.equal(rendered.captionCount, 3);
    assert.equal(rendered.captionMode, "palabra");
    assert.equal(rendered.estimatedCaptionWords, 0);
    const frameAt = async (seconds: number) => {
      const result = spawnSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", output, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"], { maxBuffer: 64 * 1024 * 1024 });
      assert.equal(result.status, 0);
      const { data, info } = await sharp(result.stdout).raw().toBuffer({ resolveWithObject: true });
      let orange = 0;
      let white = 0;
      for (let pixel = 0; pixel < data.length; pixel += info.channels) {
        const [r, g, b] = data.subarray(pixel, pixel + 3);
        if (r > 220 && g > 90 && g < 160 && b < 70) orange += 1;
        if (r > 235 && g > 235 && b > 235) white += 1;
      }
      return { orange, white, width: info.width, height: info.height };
    };
    const number = await frameAt(1.05);
    assert.equal(number.width, 1080);
    assert.equal(number.height, 1920);
    assert.ok(number.orange > 3_000, `«300» is orange: ${number.orange}`);
    const word = await frameAt(.55);
    assert.ok(word.white > 2_000 && word.orange < 500, "«Vendemos» is white");
    const pause = await frameAt(2.5);
    assert.ok(pause.white < 50 && pause.orange < 50, "no text after the last word");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
