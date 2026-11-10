import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ffmpegPath from "ffmpeg-static";
import { LOUDNESS_TARGET_LUFS, analyzeSequentialClip, createRenderPreview, loudnessGainDb, parseLoudnormInput, renderSequentialClip, trimSequentialAnalysis } from "../lib/sequential-cloud-video-renderer";
import { mapCaptionCues } from "../lib/caption-cues";
import { MAX_RENDER_PREVIEW_BYTES, parseRenderPreview } from "../lib/render-preview";

test("manual trim intersects voice ranges without moving source timestamps", () => {
  const analysis = { duration: 10, ranges: [{ start: 0, end: 3 }, { start: 5, end: 10 }], removed: 2, hasAudio: true };
  const result = trimSequentialAnalysis(analysis, { id: "one", name: "Toma", object_key: "one", duration_seconds: 10, transcript: "", trim_start_seconds: 1, trim_end_seconds: 7 });
  assert.deepEqual(result.ranges, [{ start: 1, end: 3 }, { start: 5, end: 7 }]);
  assert.equal(result.removed, 2);
});

test("late intervals of a long source preserve manual trims, silence cuts, speech and timed captions", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-late-trim-test-"));
  const source = join(directory, "long.mp4");
  const output = join(directory, "late.mp4");
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegPath!, args, { encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr?.slice(-1800));
    return result.stderr;
  };
  try {
    // Red before 125s, blue afterwards; voice only at the two ends of the cut.
    run(["-y", "-hide_banner", "-loglevel", "error", "-threads", "1",
      "-f", "lavfi", "-i", "color=c=red:s=160x90:r=5:d=129",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=129",
      "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(t,125)'",
      "-af", "volume=0:enable='not(between(t,125,125.8)+between(t,127,128.5))'",
      "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-g", "5", "-c:a", "aac", "-b:a", "32k", "-shortest", source]);
    const clip = { id: "late", name: "Toma larga", object_key: "late", duration_seconds: 129, transcript: "PRIMERA SEGUNDA",
      trim_start_seconds: 125, trim_end_seconds: 128.5, caption_cues: [
        { startSeconds: 125.1, endSeconds: 125.6, text: "PRIMERA" },
        { startSeconds: 127.2, endSeconds: 128.2, text: "SEGUNDA" },
      ] };
    const analysis = await analyzeSequentialClip(ffmpegPath!, source, 129, true, 500, -30, { start: 125, end: 128.5 });
    assert.ok(Math.abs(analysis.duration - 129) < .15);
    assert.equal(analysis.ranges.length, 2, JSON.stringify(analysis));
    assert.ok(analysis.ranges.every((range) => range.start >= 125 && range.end <= 128.5));
    const trimmed = trimSequentialAnalysis(analysis, clip);
    assert.ok(trimmed.removed > .6 && trimmed.removed < 1.3, JSON.stringify(trimmed));
    const mapped = mapCaptionCues(clip.caption_cues, trimmed.ranges);
    assert.equal(mapped.length, 2);
    assert.ok(mapped[0].startSeconds >= 0 && mapped[0].startSeconds < .2);
    assert.ok(mapped[1].startSeconds > .8 && mapped[1].startSeconds < 1.6, JSON.stringify(mapped));
    const contract: Parameters<typeof renderSequentialClip>[0]["contract"] = {
      objective: "Recorte tardío", session: { title: "Edición de 1 video" }, clips: [clip],
      style_snapshot: { transition: "cut", subtitle: { text: "#FFFFFF", box: "#000000", size: 48, uppercase: false }, execution: { framing: "fill", titleCards: false } },
      captions: { enabled: true, max_words_per_card: 4 }, dead_air: { remove: true, threshold_ms: 500 },
      effects: { transitions: false, sound_effects: false, labels: false }, quality_gates: { timed_captions: true },
    };
    const rendered = await renderSequentialClip({ command: ffmpegPath!, contract, analysis: trimmed, url: source, index: 0,
      output, videoKbps: 1200, transitionSeconds: 0, deadline: Date.now() + 60_000 });
    assert.equal(rendered.captionCount, 2);
    assert.ok(rendered.duration > 2.2 && rendered.duration < 2.9);
    const inspection = run(["-hide_banner", "-i", output, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]);
    const peak = Number(inspection.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
    assert.ok(Number.isFinite(peak) && peak > -40, `Voice must survive source seeking: ${peak}`);
    // Sample the top-left area, away from subtitles: blue proves we sought to
    // the requested source interval instead of rendering its initial red frames.
    const pixel = spawnSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-ss", "0.2", "-i", output,
      "-vf", "crop=16:16:0:0,scale=1:1", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { timeout: 15_000 });
    assert.equal(pixel.status, 0, pixel.stderr?.toString());
    assert.ok(pixel.stdout[2] > 150 && pixel.stdout[0] < 100, `Expected blue source frame, received ${Array.from(pixel.stdout)}`);
    await assert.rejects(analyzeSequentialClip(ffmpegPath!, source, 129, false, 500, -30, { start: 128, end: 132 }), /supera el video disponible/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("analysis rejects unbounded source intervals before opening media", async () => {
  for (const window of [{ start: 0, end: 241 }, { start: -1, end: 2 }, { start: 2, end: 2.1 }, { start: 0, end: Infinity }]) {
    await assert.rejects(analyzeSequentialClip("unused", "unused", 900, true, 500, -30, window), /intervalo de análisis/);
  }
  await assert.rejects(analyzeSequentialClip("unused", "unused", 10, true, 500, -30, { start: 0, end: 2 }, Date.now() - 1), /tiempo seguro/);
});

test("sequential HEVC clips normalize to a playable joined portrait MP4 with text and sound", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-sequential-test-"));
  const source = join(directory, "phone.mov");
  const outputs = [join(directory, "one.mp4"), join(directory, "two.mp4")];
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegPath!, args, { encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr?.slice(-1200));
    return result.stderr;
  };
  try {
    run([
      "-y", "-hide_banner", "-loglevel", "error", "-threads", "1",
      "-f", "lavfi", "-i", "color=c=0x25104f:s=360x640:r=30:d=1.2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.2",
      "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "pools=1:log-level=error",
      "-tag:v", "hvc1", "-c:a", "aac", "-shortest", source,
    ]);
    const contract: Parameters<typeof renderSequentialClip>[0]["contract"] = {
      objective: "Prueba de edición en serie",
      session: { title: "Demo Segmenta" },
      clips: [
        { id: "1", name: "uno", object_key: "uno", duration_seconds: 1.2, transcript: "HOLA UNO", playback_speed: 2, audio_volume: .5, brightness: .08, contrast: 1.1, saturation: .8, caption_cues: [
          { startSeconds: .1, endSeconds: .5, text: "HOLA" },
          { startSeconds: .6, endSeconds: 1.1, text: "UNO" },
        ] },
        { id: "2", name: "dos", object_key: "dos", duration_seconds: 1.2, transcript: "HOLA DOS" },
      ],
      style_snapshot: {
        transition: "fade", transitionDuration: .12,
        subtitle: { text: "#FFFFFF", box: "#7C3AED", size: 48, uppercase: true, position: "bottom" },
        execution: { zoomPercent: 0, contrast: 1.04, saturation: 1.06, soundEffectVolume: .3, noiseReduction: "light", framing: "fill", titleCards: true },
      },
      captions: { enabled: true, max_words_per_card: 4 },
      dead_air: { remove: false, threshold_ms: 500 },
      effects: { transitions: true, sound_effects: true, labels: true },
    };
    for (let index = 0; index < 2; index += 1) {
      const ranges = index === 0 ? [{ start: 0, end: 1.2 }] : [{ start: 0, end: .45 }, { start: .7, end: 1.2 }];
      const result = await renderSequentialClip({
        command: ffmpegPath!, contract, analysis: { duration: 1.2, ranges, removed: index === 0 ? 0 : .25, hasAudio: true },
        url: source, index, output: outputs[index], videoKbps: 2500, transitionSeconds: .12,
        deadline: Date.now() + 60_000,
      });
      assert.equal(result.captionCount, index === 0 ? 2 : 1);
      if (index === 0) { assert.equal(result.labelCount, 1); assert.equal(result.duration, .6); }
      if (index === 1) assert.ok(result.cueCount > 0);
    }
    const layered = structuredClone(contract);
    layered.session.title = "El poder de la IA";
    layered.style_snapshot.id = "ia-en-capas";
    layered.style_snapshot.subtitle = { text: "#FFFFFF", box: "#09090B", size: 76, uppercase: true, position: "bottom" };
    layered.clips[0].caption_cues = [{ startSeconds: .1, endSeconds: .9, text: "Y ESO LO CAMBIA" }];
    const layeredOutput = join(directory, "layered.mp4");
    const layeredResult = await renderSequentialClip({
      command: ffmpegPath!, contract: layered,
      analysis: { duration: 1.2, ranges: [{ start: 0, end: 1.2 }], removed: 0, hasAudio: true },
      url: source, index: 0, output: layeredOutput, videoKbps: 2500, transitionSeconds: 0,
      deadline: Date.now() + 60_000,
    });
    assert.equal(layeredResult.captionCount, 1);
    assert.equal(layeredResult.labelCount, 1);
    assert.match(run(["-hide_banner", "-i", layeredOutput, "-map", "0:v:0", "-map", "0:a:0", "-t", "0.3", "-f", "null", "-"]), /Video:[^\n]*\b1080x1920\b/);
    const sample = await createRenderPreview({
      command: ffmpegPath!, source: layeredOutput, output: join(directory, "sample.mp4"),
      durationSeconds: layeredResult.duration, deadline: Date.now() + 2_000,
    });
    const preview = parseRenderPreview({ ...sample, clipIndex: 0, totalClips: 2, takeId: "1", title: "Primera escena",
      captionCount: layeredResult.captionCount, soundEffectCount: layeredResult.cueCount, removedSilenceSeconds: 0 });
    assert.ok(preview, "A real encoded scene sample must satisfy the streamed preview contract");
    const sampleBytes = Buffer.from(preview.videoDataUrl.split(",")[1], "base64");
    assert.ok(sampleBytes.length < MAX_RENDER_PREVIEW_BYTES);
    const decodedSample = join(directory, "sample-from-stream.mp4");
    await writeFile(decodedSample, sampleBytes);
    const sampleInspection = run(["-hide_banner", "-i", decodedSample, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"]);
    assert.match(sampleInspection, /Video:[^\n]*\b360x640\b/);
    assert.match(sampleInspection, /Audio:/);
    const spedUpInspection = run(["-hide_banner", "-i", outputs[0], "-f", "null", "-"]);
    const spedUpDuration = spedUpInspection.match(/Duration: 00:00:(\d+(?:\.\d+)?)/);
    assert.ok(spedUpDuration, "FFmpeg should report the encoded clip duration");
    assert.ok(Number(spedUpDuration[1]) > .5 && Number(spedUpDuration[1]) < .75, `Expected a ~0.6 second video, got ${spedUpDuration[1]}`);
    const list = join(directory, "concat.txt");
    await writeFile(list, outputs.map((path) => `file '${path}'`).join("\n"));
    const final = join(directory, "final.mp4");
    run(["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", final]);
    const inspection = run(["-hide_banner", "-i", final, "-map", "0:v:0", "-map", "0:a:0", "-t", "1", "-f", "null", "-"]);
    assert.match(inspection, /Video:[^\n]*\b1080x1920\b/);
    assert.match(inspection, /Audio:/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("delivery loudness: gain is read from loudnorm and bounded", () => {
  const report = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-24.80",\n\t"input_tp" : "-6.10",\n\t"input_lra" : "3.80"\n}`;
  assert.equal(parseLoudnormInput(report), -24.8);
  assert.equal(parseLoudnormInput(`{ "input_i" : "-inf" }`), null, "a silent take is not boosted");
  assert.equal(parseLoudnormInput("no report"), null);
  assert.equal(loudnessGainDb(-24.8), 10.8);
  assert.equal(loudnessGainDb(-60), 18, "very quiet takes get at most +18 dB");
  assert.equal(loudnessGainDb(-1), -12, "very loud takes get at most −12 dB");
  assert.equal(loudnessGainDb(null), 0);
});

test("quiet and loud takes both leave the render at −14 LUFS without clipping", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-loudness-test-"));
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegPath!, args, { encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr?.slice(-1200));
    return result.stderr;
  };
  try {
    for (const [name, gain] of [["quiet", .4], ["loud", 7]] as const) {
      const source = join(directory, `${name}.mp4`);
      // A speech-like signal: a tone that rises and falls four times per second.
      run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x202020:s=360x640:r=30:d=4",
        "-f", "lavfi", "-i", `sine=frequency=220:sample_rate=48000:duration=4,volume=${gain},tremolo=f=4:d=0.8`,
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "192k", "-shortest", source]);
      const output = join(directory, `${name}-out.mp4`);
      const result = await renderSequentialClip({
        command: ffmpegPath!, url: source, index: 0, output, videoKbps: 1500, transitionSeconds: 0, deadline: Date.now() + 60_000,
        analysis: { duration: 4, ranges: [{ start: 0, end: 4 }], removed: 0, hasAudio: true },
        contract: {
          objective: "Volumen", session: { title: "" }, clips: [{ id: "1", name: name, object_key: name, duration_seconds: 4, transcript: "" }],
          style_snapshot: { transition: "cut", subtitle: { text: "#FFFFFF", box: "#000000", size: 48, uppercase: false, position: "bottom" }, execution: { contrast: 1, saturation: 1, framing: "fill" } },
          captions: { enabled: false, max_words_per_card: 4 }, dead_air: { remove: false, threshold_ms: 500 }, effects: { transitions: false, sound_effects: false, labels: false },
        },
      });
      assert.ok(result.loudness && result.loudness.measuredLufs !== null, "the mix was measured");
      const stats = run(["-hide_banner", "-nostats", "-i", output, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]);
      const integrated = Number(stats.match(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)!.pop()!.match(/-?\d+(?:\.\d+)?/)![0]);
      const peak = Number(stats.match(/Peak:\s+(-?\d+(?:\.\d+)?) dBFS/g)!.pop()!.match(/-?\d+(?:\.\d+)?/)![0]);
      assert.ok(Math.abs(integrated - LOUDNESS_TARGET_LUFS) <= 1.5, `${name}: ${integrated} LUFS (gain ${result.loudness!.gainDb} dB)`);
      assert.ok(peak <= 0, `${name}: true peak ${peak} dBFS must not clip`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
