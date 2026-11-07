import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import {
  extractSpeechWindow, MAX_SPEECH_WAV_BYTES, shouldRepairSourceDuration,
  sourceDurationFromDiagnostic, speechAudioWindow, SpeechAudioError, speechWavDuration,
} from "../lib/speech-audio";

test("bounded absolute intervals work with zero, absent, stale, and long source duration metadata", () => {
  for (const hint of [0, null, undefined, NaN, 10_000, 600_000]) {
    assert.deepEqual(speechAudioWindow(new URLSearchParams("startSeconds=151.25&endSeconds=153.75"), hint), { startSeconds: 151.25, endSeconds: 153.75 });
  }
  assert.deepEqual(speechAudioWindow(new URLSearchParams(), 0), { startSeconds: 0, endSeconds: 120 });
  assert.deepEqual(speechAudioWindow(new URLSearchParams(), 300_000), { startSeconds: 0, endSeconds: 120 });
  assert.deepEqual(speechAudioWindow(new URLSearchParams(), 8500), { startSeconds: 0, endSeconds: 8.5 });
  for (const query of ["startSeconds=1", "endSeconds=4", "startSeconds=&endSeconds=4", "startSeconds=NaN&endSeconds=4", "startSeconds=-1&endSeconds=4", "startSeconds=5&endSeconds=4", "startSeconds=1&endSeconds=1", "startSeconds=1&endSeconds=121.1", "startSeconds=1&endSeconds=Infinity", "startSeconds=0&startSeconds=1&endSeconds=4"]) {
    assert.throws(() => speechAudioWindow(new URLSearchParams(query), 4000), (error: unknown) => error instanceof SpeechAudioError && error.status === 400);
  }
});

test("only trustworthy container durations repair missing metadata", () => {
  assert.equal(sourceDurationFromDiagnostic("Duration: 01:02:03.25, start: 0.000000, bitrate: 64 kb/s"), 3723.25);
  assert.equal(sourceDurationFromDiagnostic("Duration: N/A, start: 0.000000"), null);
  assert.equal(sourceDurationFromDiagnostic("Duration: 00:00:00.00"), null);
  assert.equal(shouldRepairSourceDuration(0, 7.25), true);
  assert.equal(shouldRepairSourceDuration(null, 7.25), true);
  assert.equal(shouldRepairSourceDuration(8000, 7.25), false);
  assert.equal(shouldRepairSourceDuration(0, null), false);
  assert.equal(shouldRepairSourceDuration(0, Infinity), false);
});

function run(args: string[]) {
  assert.ok(ffmpegPath);
  const result = spawnSync(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-threads", "1", ...args], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr?.slice(-1500));
}

function frequency(bytes: Uint8Array, seconds: number) {
  const buffer = Buffer.from(bytes);
  let dataOffset = 0, dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    if (buffer.toString("ascii", offset, offset + 4) === "data") { dataOffset = offset + 8; dataSize = size; break; }
    offset += 8 + size + size % 2;
  }
  let positiveCrossings = 0;
  for (let index = dataOffset + 2; index < dataOffset + dataSize; index += 2) {
    if (buffer.readInt16LE(index - 2) <= 0 && buffer.readInt16LE(index) > 0) positiveCrossings++;
  }
  return positiveCrossings / seconds;
}

test("FFmpeg seeks past two minutes and returns the requested sound while each WAV stays below Vercel payload limit", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-audio-window-test-"));
  try {
    const source = join(directory, "long-source.wav");
    run(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=16000:duration=150", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=16000:duration=5", "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[voice]", "-map", "[voice]", "-c:a", "pcm_s16le", source]);
    const late = await extractSpeechWindow(ffmpegPath, source, join(directory, "late.wav"), { startSeconds: 151, endSeconds: 153 });
    assert.equal(late.sourceDurationSeconds, 155);
    assert.equal(late.durationSeconds, 2);
    assert.ok(Math.abs(frequency(late.bytes, 2) - 880) < 2, "late trim must contain the 880 Hz section, not the opening 220 Hz");
    const bounded = await extractSpeechWindow(ffmpegPath, source, join(directory, "bounded.wav"), { startSeconds: 0, endSeconds: 120 });
    assert.equal(bounded.durationSeconds, 120);
    assert.ok(bounded.bytes.byteLength < MAX_SPEECH_WAV_BYTES);
    assert.ok(bounded.bytes.byteLength < 4_500_000);
    const eof = await extractSpeechWindow(ffmpegPath, source, join(directory, "eof.wav"), { startSeconds: 154, endSeconds: 160 });
    assert.equal(eof.durationSeconds, 1);
    assert.equal(eof.sourceDurationSeconds, 155);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("short unknown-duration takes are measured from WAV and silent audio remains extractable", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-audio-zero-test-"));
  try {
    const source = join(directory, "silent.wav");
    run(["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1.25", "-c:a", "pcm_s16le", source]);
    const audio = await extractSpeechWindow(ffmpegPath, source, join(directory, "out.wav"), speechAudioWindow(new URLSearchParams(), 0));
    assert.equal(audio.durationSeconds, 1.25);
    assert.equal(audio.sourceDurationSeconds, 1.25);
    assert.equal(speechWavDuration(audio.bytes), 1.25);
    await assert.rejects(extractSpeechWindow(ffmpegPath, source, join(directory, "past-end.wav"), { startSeconds: 2, endSeconds: 3 }), (error: unknown) => error instanceof SpeechAudioError && error.code === "empty_audio_window");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing audio and unreadable source errors are distinct and do not expose source paths", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-audio-error-test-"));
  try {
    const source = join(directory, "no-audio.mp4");
    run(["-f", "lavfi", "-i", "color=c=black:s=32x32:d=0.5:r=10", "-an", "-c:v", "libx264", "-threads", "1", source]);
    for (const [path, code] of [[source, "no_audio_track"], [join(directory, "secret-token-not-a-file"), "audio_extraction_failed"]]) {
      await assert.rejects(extractSpeechWindow(ffmpegPath, path, join(directory, "out.wav"), { startSeconds: 0, endSeconds: 1 }), (error: unknown) => error instanceof SpeechAudioError && error.code === code && !error.message.includes(directory) && !error.message.includes("secret-token"));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
