import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ffmpegPath from "ffmpeg-static";
import { renderSequentialClip, trimSequentialAnalysis } from "../lib/sequential-cloud-video-renderer";

test("manual trim intersects voice ranges without moving source timestamps", () => {
  const analysis = { duration: 10, ranges: [{ start: 0, end: 3 }, { start: 5, end: 10 }], removed: 2, hasAudio: true };
  const result = trimSequentialAnalysis(analysis, { id: "one", name: "Toma", object_key: "one", duration_seconds: 10, transcript: "", trim_start_seconds: 1, trim_end_seconds: 7 });
  assert.deepEqual(result.ranges, [{ start: 1, end: 3 }, { start: 5, end: 7 }]);
  assert.equal(result.removed, 2);
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
        execution: { zoomPercent: 0, contrast: 1.04, saturation: 1.06, soundEffectVolume: .3, framing: "fill", titleCards: true },
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
