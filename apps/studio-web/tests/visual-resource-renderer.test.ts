import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { mapVisualResourceToOutput, renderSequentialClip } from "../lib/sequential-cloud-video-renderer";
import { renderVisualResourceImage } from "../lib/visual-resource-image";
import { parseRenderPreview } from "../lib/render-preview";
import { BUILTIN_VISUAL_RESOURCE_IDS, VISUAL_RESOURCE_LAYOUTS, type VisualResource } from "../lib/visual-resources";

async function greenImage(): Promise<string> {
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#00ff00" } }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function resource(dataUrl: string, overrides: Partial<VisualResource> = {}): VisualResource {
  return { id: "ideas-1", keyword: "ideas", startSeconds: 1.5, endSeconds: 2.5, layout: "corner",
    image: { kind: "upload", title: "Mi imagen", dataUrl }, ...overrides };
}

test("source image intervals cross removed pauses once and retain brief resources", () => {
  const ranges = [{ start: 10, end: 12 }, { start: 14, end: 18 }];
  assert.deepEqual(mapVisualResourceToOutput({ startSeconds: 11, endSeconds: 16 }, ranges, 2), { startSeconds: .5, endSeconds: 2 });
  assert.equal(mapVisualResourceToOutput({ startSeconds: 12, endSeconds: 14 }, ranges, 1), null);
  assert.equal(mapVisualResourceToOutput({ startSeconds: 0, endSeconds: 10 }, ranges, 1), null);
  const short = mapVisualResourceToOutput({ startSeconds: 14, endSeconds: 14.1 }, ranges, 2);
  assert.equal(short?.startSeconds, 1);
  assert.ok(Math.abs(short!.endSeconds - 1.05) < .0001);
});

test("every shipped library image exists and renders within the production byte/pixel bounds", async () => {
  for (const assetId of BUILTIN_VISUAL_RESOURCE_IDS) {
    const bytes = await readFile(join(process.cwd(), "public", "visual-resources", `${assetId}.png`));
    assert.ok(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024, `${assetId} fits the builtin byte limit`);
    const source = await sharp(bytes).metadata();
    assert.equal(source.format, "png");
    assert.ok(source.width! <= 768 && source.height! <= 768);
    for (const layout of ["corner", "wide"] as const) {
      const rendered = await renderVisualResourceImage(resource("", { image: { kind: "builtin", assetId }, layout }));
      const output = await sharp(rendered).metadata();
      assert.equal(output.width, VISUAL_RESOURCE_LAYOUTS[layout].width);
      assert.equal(output.height, VISUAL_RESOURCE_LAYOUTS[layout].height);
    }
  }
});

test("image rasterization enforces type/pixel limits and creates identical bounded preview geometry", async () => {
  const dataUrl = await greenImage();
  for (const [layout, width, height] of [["corner", 300, 300], ["wide", 920, 520]] as const) {
    const png = await renderVisualResourceImage(resource(dataUrl, { layout }));
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.width, width); assert.equal(metadata.height, height);
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, "Rounded corner remains transparent");
    const center = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
    assert.ok(data[center + 1] > 240 && data[center] < 10);
  }
  const svg = `data:image/png;base64,${Buffer.from('<svg width="10" height="10"></svg>').toString("base64")}`;
  await assert.rejects(renderVisualResourceImage(resource(svg)), /imagen estática compatible/);
  await assert.rejects(renderVisualResourceImage(resource("https://example.com/image.png")), /PNG, JPEG o WebP/);
  await assert.rejects(renderVisualResourceImage(resource(`data:image/png;base64,${Buffer.alloc(201 * 1024).toString("base64")}`)), /200 KB/);
  const tooManyPixels = await sharp({ create: { width: 2001, height: 2000, channels: 3, background: "#000" } }).png().toBuffer();
  await assert.rejects(renderVisualResourceImage(resource(`data:image/png;base64,${tooManyPixels.toString("base64")}`)), /pixel limit/i);
  await assert.rejects(renderVisualResourceImage(resource(dataUrl, { image: { kind: "builtin", assetId: "../../private" } as unknown as VisualResource["image"] })), /biblioteca/);

  const directory = await mkdtemp(join(tmpdir(), "segmenta-builtin-image-"));
  try {
    await writeFile(join(directory, "ideas.png"), Buffer.from(dataUrl.split(",")[1], "base64"));
    const png = await renderVisualResourceImage(resource(dataUrl, { image: { kind: "builtin", assetId: "ideas" } }), directory);
    assert.equal((await sharp(png).metadata()).width, 300);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("FFmpeg shows images only at source-word times after trim, silence removal and speed; speech and captions survive", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-context-images-"));
  const source = join(directory, "source.mp4");
  const output = join(directory, "edited.mp4");
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegPath!, args, { encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr?.slice(-1400));
    return result.stderr;
  };
  const pixel = (second: number, x: number, y: number) => {
    const result = spawnSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-ss", String(second), "-i", output,
      "-vf", `crop=16:16:${x}:${y},scale=1:1`, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr?.toString());
    return result.stdout;
  };
  try {
    run(["-y", "-hide_banner", "-loglevel", "error", "-threads", "1", "-f", "lavfi", "-i", "color=c=blue:s=180x320:r=30:d=9",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=9",
      "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-c:a", "aac", "-shortest", source]);
    const image = await greenImage();
    const contract: Parameters<typeof renderSequentialClip>[0]["contract"] = {
      objective: "Imágenes con palabras", session: { title: "Edición de 1 video" },
      clips: [{ id: "one", name: "Toma", object_key: "one", duration_seconds: 9, transcript: "IDEAS CRECIMIENTO",
        trim_start_seconds: 1, trim_end_seconds: 9, playback_speed: 2,
        caption_cues: [{ startSeconds: 1.5, endSeconds: 2.5, text: "IDEAS" }, { startSeconds: 6, endSeconds: 8, text: "CRECIMIENTO" }],
        visual_resources: [resource(image), resource(image, { id: "growth-1", keyword: "crecimiento", startSeconds: 6, endSeconds: 8, layout: "wide" })] }],
      style_snapshot: { transition: "cut", subtitle: { text: "#FFFFFF", box: "#000000", size: 48, uppercase: false, position: "bottom" }, execution: { framing: "fill", titleCards: false } },
      captions: { enabled: true, max_words_per_card: 4 }, dead_air: { remove: true, threshold_ms: 500 },
      effects: { transitions: false, sound_effects: false, labels: false, images_or_broll: true }, quality_gates: { timed_captions: true },
    };
    const analysis = { duration: 9, ranges: [{ start: 1, end: 3 }, { start: 5, end: 9 }], removed: 2, hasAudio: true };
    const rendered = await renderSequentialClip({ command: ffmpegPath!, contract, analysis, url: source, index: 0,
      output, videoKbps: 1200, transitionSeconds: 0, deadline: Date.now() + 60_000 });
    assert.equal(rendered.duration, 3);
    assert.equal(rendered.imageCount, 2);
    assert.equal(rendered.captionCount, 2);
    for (const [at, x, y, visible] of [
      [.1, 800, 350, false], [.5, 800, 350, true], [1, 800, 350, false],
      [1.3, 500, 750, false], [2, 500, 750, true], [2.8, 500, 750, false],
    ] as const) {
      const rgb = pixel(at, x, y);
      assert.ok(visible ? rgb[1] > 180 && rgb[2] < 80 : rgb[2] > 150 && rgb[1] < 80,
        `At ${at}s resource ${visible ? "must show" : "must not show"}; received ${Array.from(rgb)}`);
    }
    const inspection = run(["-hide_banner", "-i", output, "-map", "0:v:0", "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]);
    assert.match(inspection, /Video:[^\n]*1080x1920/);
    assert.ok(Number(inspection.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]) > -40, "Voice remains audible");
    const captionFrame = spawnSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", output,
      "-vf", "crop=1080:300:0:1450", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(captionFrame.status, 0, captionFrame.stderr?.toString());
    let captionPixels = 0;
    for (let pixelIndex = 0; pixelIndex < captionFrame.stdout.length; pixelIndex += 3) {
      if (captionFrame.stdout[pixelIndex] > 210 && captionFrame.stdout[pixelIndex + 1] > 210 && captionFrame.stdout[pixelIndex + 2] > 210) captionPixels++;
    }
    assert.ok(captionPixels > 50, "The spoken caption remains visibly burned into the MP4 below the image");

    // An image entirely inside a removed pause must not be loaded or rendered.
    contract.clips[0].visual_resources = [resource("not-an-image", { startSeconds: 3.5, endSeconds: 4.5 })];
    const ignored = await renderSequentialClip({ command: ffmpegPath!, contract, analysis, url: source, index: 0,
      output: join(directory, "gap.mp4"), videoKbps: 800, transitionSeconds: 0, deadline: Date.now() + 60_000 });
    assert.equal(ignored.imageCount, 0);
    contract.effects.images_or_broll = false;
    contract.clips[0].visual_resources = [resource("not-an-image")];
    const disabled = await renderSequentialClip({ command: ffmpegPath!, contract, analysis, url: source, index: 0,
      output: join(directory, "disabled.mp4"), videoKbps: 800, transitionSeconds: 0, deadline: Date.now() + 60_000 });
    assert.equal(disabled.imageCount, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("image counts are optional in old scene previews and strictly bounded in new previews", () => {
  const old = { clipIndex: 0, totalClips: 1, takeId: "one", title: "Toma", videoDataUrl: "data:video/mp4;base64,AAAA", durationSeconds: 1,
    captionCount: 2, soundEffectCount: 1, removedSilenceSeconds: 0 };
  assert.ok(parseRenderPreview(old));
  assert.equal(parseRenderPreview({ ...old, imageCount: 2 })?.imageCount, 2);
  assert.equal(parseRenderPreview({ ...old, imageCount: 3 }), null);
  assert.equal(parseRenderPreview({ ...old, imageCount: "1" }), null);
});
