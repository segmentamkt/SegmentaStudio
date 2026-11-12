import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { test } from "node:test";
import ffmpegPath from "ffmpeg-static";
import {
  COLOR_FILTERS, colorFilters, cssTransform, framingFilters, normalizeClipTransform, normalizeColorFilter,
  normalizeTextOverlays, orientationFilters, textOverlayPosition,
} from "../lib/clip-look";

const bounds = { durationSeconds: 10, trimStartSeconds: 2, trimEndSeconds: 8 };

test("texts are cleaned, kept inside the trim and limited per take", () => {
  const [item] = normalizeTextOverlays([{ id: "a1", text: "  Hola\u0000mundo ", startSeconds: 1, endSeconds: 9, x: 2, y: -1, size: 400, color: "#ff7a00", background: "brand" }], bounds);
  assert.deepEqual(item, { id: "a1", text: "Hola mundo", startSeconds: 2, endSeconds: 8, x: 1, y: 0, size: 100, color: "#FF7A00", background: "brand" });
  assert.deepEqual(normalizeTextOverlays(undefined, bounds), []);
  assert.throws(() => normalizeTextOverlays([{ text: "" }], bounds), /vacío/);
  assert.throws(() => normalizeTextOverlays([{ text: "x".repeat(121) }], bounds), /120/);
  assert.throws(() => normalizeTextOverlays(Array.from({ length: 7 }, () => ({ text: "a" })), bounds), /hasta 6/);
  assert.throws(() => normalizeTextOverlays([{ text: "tarde", startSeconds: 8, endSeconds: 9 }], bounds), /fuera del recorte/);
  assert.equal(normalizeTextOverlays([{ text: "a", color: "red", background: "neon" }], bounds)[0].color, "#FFFFFF");
});

test("transform and filter values fall back to safe defaults", () => {
  assert.deepEqual(normalizeClipTransform(undefined), { scale: 1, x: 0, y: 0, rotate: 0, flipH: false, flipV: false });
  assert.deepEqual(normalizeClipTransform({ scale: 9, x: -4, y: .25, rotate: 45, flipH: true }), { scale: 3, x: -1, y: .25, rotate: 0, flipH: true, flipV: false });
  assert.equal(normalizeClipTransform({ rotate: 270 }).rotate, 270);
  assert.equal(normalizeColorFilter("bn"), "bn");
  assert.equal(normalizeColorFilter("lsd"), "none");
});

test("orientation runs before framing; zoom crops and shrinking pads", () => {
  assert.deepEqual(orientationFilters(normalizeClipTransform({ rotate: 90, flipH: true })), ["transpose=1", "hflip"]);
  assert.deepEqual(orientationFilters(normalizeClipTransform({ rotate: 180 })), ["hflip", "vflip"]);
  assert.deepEqual(framingFilters(normalizeClipTransform({})), []);
  assert.match(framingFilters(normalizeClipTransform({ scale: 1.5, x: -1 })).join(","), /crop=1080:1920:x='\(iw-1080\)\/2\*\(1\+-1\)'/);
  assert.match(framingFilters(normalizeClipTransform({ scale: .6 })).join(","), /pad=1080:1920/);
  assert.equal(cssTransform(normalizeClipTransform({ scale: 2, x: -1 })), "translate(50.00%, 0.00%) rotate(0deg) scale(2, 2)");
  assert.deepEqual(textOverlayPosition({ x: .5, y: .25 }), { x: "'max(0,min(W-w,W*0.5000-w/2))'", y: "'max(0,min(H-h,H*0.2500-h/2))'" });
});

test("real FFmpeg accepts every filter and transform and keeps 1080x1920", () => {
  assert.ok(ffmpegPath);
  const cover = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  const cases: string[][] = [
    ...COLOR_FILTERS.map((item) => [cover, ...colorFilters(item.id)]),
    [...orientationFilters(normalizeClipTransform({ rotate: 90, flipV: true })), cover, ...framingFilters(normalizeClipTransform({ scale: 1.6, x: .5, y: -.3 }))],
    [...orientationFilters(normalizeClipTransform({ rotate: 270 })), cover, ...framingFilters(normalizeClipTransform({ scale: .6, x: -1, y: 1 }))],
  ];
  for (const chain of cases) {
    const result: SpawnSyncReturns<string> = spawnSync(ffmpegPath!, ["-hide_banner", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=0.2", "-vf", [...chain, "format=yuv420p"].join(","), "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `${chain.join(",")}\n${result.stderr.slice(-600)}`);
    assert.match(result.stderr, /1080x1920/, chain.join(","));
  }
});

test("a rendered take carries its text box, zoom, rotation and color filter", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { renderSequentialClip } = await import("../lib/sequential-cloud-video-renderer");
  const directory = await mkdtemp(join(tmpdir(), "segmenta-look-test-"));
  try {
    const source = join(directory, "take.mp4");
    const make = spawnSync(ffmpegPath!, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=2",
      "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000:d=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source], { encoding: "utf8" });
    assert.equal(make.status, 0, make.stderr);
    const contract: Parameters<typeof renderSequentialClip>[0]["contract"] = {
      objective: "Prueba", session: { title: "Edición de 1 video" },
      clips: [{
        id: "1", name: "uno", object_key: "uno", duration_seconds: 2, transcript: "",
        text_overlays: normalizeTextOverlays([{ id: "t1", text: "OFERTA HOY", startSeconds: .3, endSeconds: 1.5, x: .5, y: .2, size: 80, color: "#FFFFFF", background: "brand" }], { durationSeconds: 2, trimStartSeconds: 0, trimEndSeconds: 2 }),
        transform: normalizeClipTransform({ rotate: 90, scale: 1.4, x: .3 }),
        color_filter: "calido",
      }],
      style_snapshot: { transition: "cut", subtitle: { text: "#FFFFFF", box: "#000000", size: 60, uppercase: false }, execution: { framing: "fill", titleCards: false } },
      captions: { enabled: false, max_words_per_card: 4 },
      dead_air: { remove: false, threshold_ms: 500 },
      effects: { transitions: false, sound_effects: false, labels: false },
    };
    const output = join(directory, "out.mp4");
    const result = await renderSequentialClip({
      command: ffmpegPath!, contract, analysis: { duration: 2, ranges: [{ start: 0, end: 2 }], removed: 0, hasAudio: true },
      url: source, index: 0, output, videoKbps: 2000, transitionSeconds: 0, deadline: Date.now() + 60_000,
    });
    assert.equal(result.textCount, 1);
    const probe = spawnSync(ffmpegPath!, ["-hide_banner", "-i", output, "-f", "null", "-"], { encoding: "utf8" });
    assert.match(probe.stderr, /Video: h264[^\n]*1080x1920/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("texts follow trims and splits, and damaged drafts keep the valid ones", async () => {
  const { fitTextOverlays, newTextOverlay, restoreTextOverlays } = await import("../lib/clip-look");
  const item = newTextOverlay("n1", 7.5, 2, 8);
  assert.deepEqual([item.startSeconds, item.endSeconds], [7.5, 8]);
  const texts = normalizeTextOverlays([{ id: "a", text: "uno", startSeconds: 2, endSeconds: 4 }, { id: "b", text: "dos", startSeconds: 5, endSeconds: 7 }], bounds);
  assert.deepEqual(fitTextOverlays(texts, 2, 5).map((text) => [text.id, text.startSeconds, text.endSeconds]), [["a", 2, 4]]);
  assert.deepEqual(fitTextOverlays(texts, 3, 8).map((text) => [text.id, text.startSeconds, text.endSeconds]), [["a", 3, 4], ["b", 5, 7]]);
  assert.deepEqual(restoreTextOverlays([{ text: "" }, { id: "ok", text: "bien" }], bounds).map((text) => text.id), ["ok"]);
});

test("voice effects keep the take length; freeze is bounded", async () => {
  const { VOICE_EFFECTS, normalizeFreezeSeconds, normalizeVoiceEffect, voiceEffectFilters } = await import("../lib/clip-look");
  assert.equal(normalizeVoiceEffect("robot"), "robot");
  assert.equal(normalizeVoiceEffect("helio"), "none");
  assert.equal(normalizeFreezeSeconds(9), 3);
  assert.equal(normalizeFreezeSeconds(-1), 0);
  assert.equal(normalizeFreezeSeconds("2"), 0);
  for (const effect of VOICE_EFFECTS) {
    const chain = ["aformat=sample_fmts=fltp:channel_layouts=stereo", ...voiceEffectFilters(effect.id)].join(",");
    const result: SpawnSyncReturns<string> = spawnSync(ffmpegPath!, ["-hide_banner", "-f", "lavfi", "-i", "sine=f=300:sample_rate=48000:d=2", "-af", chain, "-f", "null", "-"], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `${effect.id}: ${result.stderr.slice(-400)}`);
    const seconds = [...result.stderr.matchAll(/time=00:00:(\d+\.\d+)/g)].map((match) => Number(match[1])).pop() ?? 0;
    // Echo tails may run a little longer; the render cuts every take at its exact length.
    assert.ok(seconds > 1.9 && seconds < 3.1, `${effect.id} changed the length to ${seconds}`);
  }
});

test("a frozen ending lengthens the take; voice effect and SRT timings come out of the render", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { renderSequentialClip } = await import("../lib/sequential-cloud-video-renderer");
  const directory = await mkdtemp(join(tmpdir(), "segmenta-freeze-test-"));
  try {
    const source = join(directory, "take.mp4");
    const make = spawnSync(ffmpegPath!, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=2",
      "-f", "lavfi", "-i", "sine=f=300:sample_rate=48000:d=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source], { encoding: "utf8" });
    assert.equal(make.status, 0, make.stderr);
    const contract: Parameters<typeof renderSequentialClip>[0]["contract"] = {
      objective: "Prueba", session: { title: "Edición de 1 video" },
      clips: [{ id: "1", name: "uno", object_key: "uno", duration_seconds: 2, transcript: "", playback_speed: 2, voice_effect: "ardilla", freeze_end_seconds: 1,
        caption_cues: [{ startSeconds: .4, endSeconds: 1.2, text: "hola" }] }],
      style_snapshot: { transition: "cut", subtitle: { text: "#FFFFFF", box: "#000000", size: 60, uppercase: false }, execution: { framing: "fill", titleCards: false } },
      captions: { enabled: false, max_words_per_card: 4 },
      dead_air: { remove: false, threshold_ms: 500 },
      effects: { transitions: false, sound_effects: false, labels: false },
    };
    const output = join(directory, "out.mp4");
    const result = await renderSequentialClip({
      command: ffmpegPath!, contract, analysis: { duration: 2, ranges: [{ start: 0, end: 2 }], removed: 0, hasAudio: true },
      url: source, index: 0, output, videoKbps: 2000, transitionSeconds: 0, deadline: Date.now() + 60_000,
    });
    assert.equal(result.duration, 2);
    assert.deepEqual(result.srtCues, [{ start: .2, end: .6, text: "hola" }]);
    const probe = spawnSync(ffmpegPath!, ["-hide_banner", "-i", output, "-f", "null", "-"], { encoding: "utf8" });
    const seconds = Number(/Duration: 00:00:(\d+\.\d+)/.exec(probe.stderr)?.[1]);
    assert.ok(Math.abs(seconds - 2) < .1, `1 s at 2x plus 1 s frozen, got ${seconds}`);
    assert.match(probe.stderr, /Audio: aac/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audio fades are bounded and never overlap", async () => {
  const { audioFadeFilters } = await import("../lib/clip-look");
  assert.deepEqual(audioFadeFilters(0, 0, 4), []);
  assert.deepEqual(audioFadeFilters(1, 2, 10), ["afade=t=in:st=0:d=1.000", "afade=t=out:st=8.000:d=2.000"]);
  assert.deepEqual(audioFadeFilters(3, 3, 2), ["afade=t=in:st=0:d=1.000", "afade=t=out:st=1.000:d=1.000"]);
});
