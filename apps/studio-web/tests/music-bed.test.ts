import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMusicMixArgs, buildMusicMixGraph, musicMimeType, musicObjectKey, normalizeMusicTrack } from "../lib/music-bed";

const owner = "user-1";
const session = "session-1";
const key = `${owner}/${session}/music/0f6c2a1e-9b7d-4c1a-8f00-123456789abc.mp3`;

test("only a song inside this production's music folder is accepted", () => {
  assert.equal(normalizeMusicTrack(null, owner, session), null);
  assert.deepEqual(normalizeMusicTrack({ object_key: key, name: " Mi\u0000canción " }, owner, session), {
    object_key: key, name: "Mi canción", volume: .2, ducking: true, fade_out_seconds: 2, start_seconds: 0,
  });
  assert.throws(() => normalizeMusicTrack({ object_key: `other/${session}/music/0f6c2a1e-9b7d.mp3` }, owner, session), /no pertenece/);
  assert.throws(() => normalizeMusicTrack({ object_key: `${owner}/${session}/scene-1/take.mp4` }, owner, session), /no pertenece/);
  assert.throws(() => normalizeMusicTrack({ object_key: `${owner}/${session}/music/../x.mp3` }, owner, session), /no pertenece/);
  assert.throws(() => normalizeMusicTrack({ object_key: key, volume: 3 }, owner, session), /volumen/);
  assert.throws(() => normalizeMusicTrack({ object_key: key, ducking: "yes" }, owner, session), /bajar la música/);
});

test("the upload type comes from the browser or, failing that, from the extension", () => {
  assert.equal(musicMimeType("tema.m4a", "audio/x-m4a"), "audio/mp4");
  assert.equal(musicMimeType("tema.mp3", ""), "audio/mpeg");
  assert.equal(musicMimeType("tema.wav", "audio/x-wav"), "audio/wav");
  assert.equal(musicMimeType("tema.ogg", "audio/ogg"), null);
  assert.equal(musicObjectKey(owner, session, "abc12345", "audio/mpeg"), `${owner}/${session}/music/abc12345.mp3`);
});

test("with ducking the voice drives a compressor on the song before both are mixed", () => {
  const graph = buildMusicMixGraph({ volume: .2, ducking: true, fade_out_seconds: 2 }, 30);
  assert.match(graph, /\[1:a\]atrim=0:30\.000,.*volume=0\.200,afade=t=in:st=0:d=0\.400,afade=t=out:st=28\.000:d=2\.000\[music\]/);
  assert.match(graph, /\[0:a\].*asplit=2\[voice\]\[key\]/);
  assert.match(graph, /\[music\]\[key\]sidechaincompress=/);
  assert.match(graph, /\[voice\]\[ducked\]amix=inputs=2:duration=first.*alimiter=limit=0\.891.*\[mix\]$/);
});

test("without ducking the song is only mixed; a short video halves the fade", () => {
  const graph = buildMusicMixGraph({ volume: .5, ducking: false, fade_out_seconds: 6 }, 4);
  assert.doesNotMatch(graph, /sidechaincompress/);
  assert.match(graph, /afade=t=out:st=2\.000:d=2\.000/);
  assert.doesNotMatch(buildMusicMixGraph({ volume: .5, ducking: false, fade_out_seconds: 0 }, 4), /afade=t=out/);
});

test("the final pass copies the picture and seeks the song before reading it", () => {
  const music = normalizeMusicTrack({ object_key: key, start_seconds: 12.5 }, owner, session)!;
  const args = buildMusicMixArgs({ video: "final.mp4", musicUrl: "https://signed", output: "mixed.mp4", videoSeconds: 20, music });
  assert.deepEqual(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4), ["-ss", "12.500", "-i", "https://signed"]);
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.equal(args.at(-1), "mixed.mp4");
});

test("real mix: the picture is copied, the length follows the voice and the song ducks under speech", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as string;
  assert.ok(ffmpeg);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-music-test-"));
  const run = (args: string[]) => {
    const result = spawnSync(ffmpeg, args, { encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr?.slice(-1200));
    return result.stderr;
  };
  // Band levels: the "voice" is a 300 Hz tone for the first 3 s; the "song" is an 880 Hz tone.
  const level = (file: string, start: number, frequency: number) => {
    const out = run(["-hide_banner", "-nostats", "-ss", String(start), "-t", "1.5", "-i", file,
      "-af", `bandpass=f=${frequency}:width_type=q:w=30,bandpass=f=${frequency}:width_type=q:w=30,volumedetect`, "-f", "null", "-"]);
    return Number(/mean_volume: (-?[\d.]+) dB/.exec(out)?.[1]);
  };
  try {
    const video = join(directory, "assembled.mp4");
    const song = join(directory, "song.m4a");
    run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=1080x1920:r=30:d=8",
      "-f", "lavfi", "-i", "sine=f=300:sample_rate=48000:d=8", "-filter_complex", "[1:a]volume='if(lt(t,3),1,0)':eval=frame,aformat=channel_layouts=stereo[a]",
      "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", video]);
    run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=880:sample_rate=44100:d=20", "-c:a", "aac", song]);
    const levels: Record<string, { songUnderVoice: number; songAlone: number; voice: number }> = {};
    for (const ducking of [true, false]) {
      const music = normalizeMusicTrack({ object_key: key, volume: .3, ducking, start_seconds: 2 }, owner, session)!;
      const output = join(directory, `mixed-${ducking}.mp4`);
      run(buildMusicMixArgs({ video, musicUrl: song, output, videoSeconds: 8, music }));
      const info = run(["-hide_banner", "-i", output, "-f", "null", "-"]);
      assert.match(info, /Video: h264[^\n]*1080x1920/);
      assert.match(info, /Audio: aac/);
      const seconds = Number(/Duration: 00:00:(\d+\.\d+)/.exec(info)?.[1]);
      assert.ok(Math.abs(seconds - 8) < .15, `expected ~8 s, got ${seconds}`);
      levels[String(ducking)] = { songUnderVoice: level(output, 1, 880), songAlone: level(output, 5, 880), voice: level(output, 1, 300) };
    }
    assert.ok(levels.false.songUnderVoice - levels.true.songUnderVoice > 6, `ducking should lower the song by >6 dB: ${JSON.stringify(levels)}`);
    assert.ok(Math.abs(levels.true.songAlone - levels.false.songAlone) < 1.5, "the song comes back in the silences");
    assert.ok(Math.abs(levels.true.voice - levels.false.voice) < 1, "the voice keeps its level");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
