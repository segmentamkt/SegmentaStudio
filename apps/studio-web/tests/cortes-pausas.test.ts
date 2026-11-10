import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ffmpegPath from "ffmpeg-static";
import { CUT_RULES, planCuts, sameWord, snapWordsToSilences, voiceActivityFromSamples, type PlanWord, type Range } from "../lib/skills/cortes-pausas";
import { analyzeClipForCutSkill, applyCutSkill, renderSequentialClip } from "../lib/sequential-cloud-video-renderer";
import { getEditorStyle } from "../lib/editor-presets";

/** Words separated by the given gaps, each lasting `length` seconds. */
function speak(start: number, items: Array<[string, number?]>, length = .3): PlanWord[] {
  let cursor = start;
  return items.map(([text, gapAfter = .05]) => {
    const word = { text, startSeconds: cursor, endSeconds: cursor + length };
    cursor += length + gapAfter;
    return word;
  });
}

/** Silences are the complement of the words (what silencedetect would report, ≥ 0.35 s). */
function silencesAround(words: PlanWord[], duration: number): Range[] {
  const silences: Range[] = [];
  let cursor = 0;
  for (const word of words) {
    if (word.startSeconds - cursor >= .35) silences.push({ start: cursor, end: word.startSeconds });
    cursor = Math.max(cursor, word.endSeconds);
  }
  if (duration - cursor >= .35) silences.push({ start: cursor, end: duration });
  return silences;
}

const kept = (ranges: Range[]) => ranges.reduce((sum, range) => sum + range.end - range.start, 0);
const covers = (ranges: Range[], word: PlanWord) => ranges.some((range) => range.start <= word.startSeconds && range.end >= word.endSeconds);

test("the countdown «3, 2, 1» is never heard and the first script word gets 0.15 s of lead", () => {
  const countdown = speak(.5, [["Tres,", .4], ["dos,", .4], ["uno.", .9]]);
  const script = speak(countdown[2].endSeconds + .9, [["Atención"], ["empresarios"], ["dueños"], ["de"], ["negocio"]]);
  const words = [...countdown, ...script];
  const plan = planCuts({ window: { start: 0, end: 8 }, silences: silencesAround(words, 8), hasAudio: true, words });
  assert.deepEqual(plan.droppedLead, ["Tres,", "dos,", "uno."]);
  assert.ok(plan.ranges[0].start > countdown[2].endSeconds, "the «uno» is cut out");
  assert.ok(Math.abs(plan.ranges[0].start - (script[0].startSeconds - CUT_RULES.preSeconds)) < 1e-9);
  assert.ok(script.every((word) => covers(plan.ranges, word)));
  assert.ok(Math.abs(plan.ranges[plan.ranges.length - 1].end - (script[4].endSeconds + CUT_RULES.postSeconds)) < 1e-9, "0.25 s after the last word");
});

test("a countdown said quickly into the script is still removed without touching the first word", () => {
  const words = speak(.2, [["3,", .15], ["2,", .15], ["1", .12], ["Hoy"], ["lanzamos"], ["algo"]], .25);
  const plan = planCuts({ window: { start: 0, end: 4 }, silences: [], hasAudio: true, words });
  assert.deepEqual(plan.droppedLead, ["3,", "2,", "1"]);
  assert.ok(plan.ranges[0].start >= words[2].endSeconds + CUT_RULES.droppedWordGuardSeconds - 1e-9);
  assert.ok(plan.ranges[0].start <= words[3].startSeconds);
});

test("with the scene script, «tres, dos, uno · Uno. OpenAI…» keeps the second «Uno»", () => {
  const words = speak(.3, [["Tres,", .3], ["dos,", .3], ["uno.", .8], ["Uno.", .5], ["OpenAI"], ["acaba"], ["de"], ["expandir"], ["ChatGPT"], ["Ads"]]);
  const plan = planCuts({ window: { start: 0, end: 9 }, silences: silencesAround(words, 9), hasAudio: true, words,
    script: "Uno. OpenAI acaba de expandir ChatGPT Ads a más de 26 nuevos países." });
  assert.equal(plan.boundary, "libreto");
  assert.deepEqual(plan.droppedLead, ["Tres,", "dos,", "uno."]);
  assert.ok(covers(plan.ranges, words[3]), "the script's «Uno» stays");
});

test("without a script a lone leading number is kept and flagged instead of guessed", () => {
  const words = speak(.3, [["Uno.", .6], ["OpenAI"], ["acaba"], ["de"], ["expandir"]]);
  const plan = planCuts({ window: { start: 0, end: 5 }, silences: silencesAround(words, 5), hasAudio: true, words });
  assert.deepEqual(plan.droppedLead, []);
  assert.ok(covers(plan.ranges, words[0]));
  assert.ok(plan.warnings.some((warning) => warning.includes("Uno")));
});

test("regression «Y sí, ya existe un administrador»: the 0.31 s island and its 0.54 s pause stay intact", () => {
  const words: PlanWord[] = [
    { text: "Y", startSeconds: .60, endSeconds: .72 }, { text: "sí,", startSeconds: .72, endSeconds: .91 },
    ...speak(1.45, [["ya"], ["existe"], ["un"], ["administrador"], ["disponible"]], .32),
  ];
  const plan = planCuts({ window: { start: 0, end: 5 }, silences: silencesAround(words, 5), hasAudio: true, words });
  assert.deepEqual(plan.droppedLead, []);
  assert.equal(plan.ranges.length, 1, "no internal cut");
  assert.ok(plan.ranges[0].start <= .45 + 1e-9 && covers(plan.ranges, words[0]));
  assert.equal(plan.shortenedPauses, 0);
});

test("pauses up to 0.7 s are untouched; longer ones become exactly 0.45 s", () => {
  const first = speak(.2, [["Primera"], ["idea", .65]]);
  const second = speak(first[1].endSeconds + .65, [["segunda"], ["idea", 2]]);
  const third = speak(second[1].endSeconds + 2, [["tercera"], ["idea"]]);
  const words = [...first, ...second, ...third];
  const plan = planCuts({ window: { start: 0, end: 7 }, silences: silencesAround(words, 7), hasAudio: true, words });
  assert.equal(plan.shortenedPauses, 1);
  assert.ok(words.every((word) => covers(plan.ranges, word)), "no word is ever cut");
  const outputGap = (from: PlanWord, to: PlanWord) => {
    let gap = 0;
    for (const range of plan.ranges) gap += Math.max(0, Math.min(range.end, to.startSeconds) - Math.max(range.start, from.endSeconds));
    return gap;
  };
  assert.ok(Math.abs(outputGap(first[1], second[0]) - .65) < 1e-6, "0.65 s pause intact");
  assert.ok(Math.abs(outputGap(second[1], third[0]) - CUT_RULES.targetPauseSeconds) < 1e-6, "2 s pause shortened to 0.45 s");
});

test("a word the recognizer places inside a measured silence is never cut", () => {
  const words = speak(.2, [["Hola", 2.2], ["mundo"]]);
  const breath = { text: "eh", startSeconds: 1.3, endSeconds: 1.45 };
  const plan = planCuts({ window: { start: 0, end: 4 }, silences: [{ start: .5, end: 2.7 }], hasAudio: true, words: [...words, breath].sort((a, b) => a.startSeconds - b.startSeconds) });
  assert.ok(covers(plan.ranges, breath));
});

test("trailing «corta» after a pause is removed; a closing «¿quedó?» too, but not the script's last word", () => {
  const words = speak(.2, [["Síguenos"], ["para"], ["más", .8], ["¿Quedó?", .5], ["corta"]]);
  const plan = planCuts({ window: { start: 0, end: 5 }, silences: silencesAround(words, 5), hasAudio: true, words });
  assert.deepEqual(plan.droppedTail, ["¿Quedó?", "corta"]);
  assert.ok(covers(plan.ranges, words[2]));
  assert.ok(plan.ranges[plan.ranges.length - 1].end < words[3].startSeconds);
});

test("without recognized words the audio decides: lead silence, long pauses and tail", () => {
  const plan = planCuts({ window: { start: 0, end: 10 }, hasAudio: true,
    silences: [{ start: 0, end: 1 }, { start: 3, end: 5 }, { start: 6, end: 10 }] });
  assert.equal(plan.boundary, "audio");
  assert.ok(Math.abs(plan.ranges[0].start - .85) < 1e-9);
  assert.ok(Math.abs(plan.ranges[plan.ranges.length - 1].end - 6.25) < 1e-9);
  assert.ok(Math.abs(kept(plan.ranges) - (2 + .15 + 1 + .25 + .45)) < 1e-6);
});

test("manual trims always win and silent footage stays untouched", () => {
  const words = speak(1, [["Hola"], ["equipo"]]);
  const plan = planCuts({ window: { start: 1.2, end: 3 }, silences: silencesAround(words, 4), hasAudio: true, words });
  assert.ok(plan.ranges[0].start >= 1.2 && plan.ranges[plan.ranges.length - 1].end <= 3);
  const silent = planCuts({ window: { start: 0, end: 3 }, silences: [], hasAudio: false });
  assert.deepEqual(silent.ranges, [{ start: 0, end: 3 }]);
});

test("recognition errors still match the script", () => {
  assert.ok(sameWord("lechon", "lechona"));
  assert.ok(sameWord("expandir", "expandi"));
  assert.ok(!sameWord("uno", "dos"));
});

test("the renderer helper applies the skill with words from the cues and the scene script", () => {
  const words = speak(.5, [["tres,", .3], ["dos,", .3], ["uno", .9], ["Hola"], ["equipo"]]);
  const { analysis, plan } = applyCutSkill(
    { duration: 6, ranges: [{ start: 0, end: 6 }], removed: 0, hasAudio: true, silences: silencesAround(words, 6) },
    { id: "a", name: "Toma", object_key: "a", duration_seconds: 6, transcript: "", script: "Hola equipo",
      caption_cues: [{ startSeconds: .5, endSeconds: words[4].endSeconds, text: words.map((word) => word.text).join(" "), words: words.map((word) => ({ ...word })) }] },
  );
  assert.equal(plan.boundary, "libreto");
  assert.ok(analysis.ranges[0].start > words[2].endSeconds);
  assert.equal(analysis.removed, plan.removedSeconds);
});

/** Mono 8 kHz signal: a noise floor plus tone segments at the given dBFS levels. */
function signal(duration: number, parts: Array<[number, number, number]>, floorDb = -70) {
  const rate = 8_000;
  const samples = new Float32Array(Math.round(duration * rate));
  const floor = 10 ** (floorDb / 20);
  let seed = 7;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (seed * 16807) % 2147483647;
    samples[index] = floor * ((seed / 2147483647) * 2 - 1);
  }
  for (const [start, end, levelDb] of parts) {
    const amplitude = 10 ** (levelDb / 20) * Math.SQRT2;
    for (let index = Math.round(start * rate); index < Math.round(end * rate); index += 1) samples[index] += amplitude * Math.sin(2 * Math.PI * 220 * index / rate);
  }
  return { samples, rate };
}

test("adaptive voice detection keeps soft syllables that a fixed −30 dB threshold would call silence", () => {
  const { samples, rate } = signal(4, [[.5, 1.5, -20], [1.5, 1.8, -45], [3, 3.5, -22]]);
  const voice = voiceActivityFromSamples(samples, rate);
  assert.ok(voice.thresholdDb < -45, `threshold ${voice.thresholdDb}`);
  assert.equal(voice.islands.length, 2);
  assert.ok(Math.abs(voice.islands[0].start - .5) < .02 && Math.abs(voice.islands[0].end - 1.8) < .02, "the soft tail belongs to the word");
  const pause = voice.silences.find((silence) => silence.start > 1 && silence.end < 3.1)!;
  assert.ok(Math.abs(pause.start - 1.8) < .02 && Math.abs(pause.end - 3) < .02);
});

test("a short «Y sí» island survives voice detection", () => {
  const { samples, rate } = signal(3, [[.6, .91, -24], [1.45, 2.6, -20]], -60);
  const voice = voiceActivityFromSamples(samples, rate, 10);
  assert.equal(voice.islands.length, 2);
  assert.ok(Math.abs(voice.islands[0].start - 10.6) < .02, "offsets are reported in source seconds");
});

test("recognizer timings are snapped to the audio: a word cannot sound inside a measured silence", () => {
  const snapped = snapWordsToSilences([
    { text: "talentos.", startSeconds: 4.36, endSeconds: 5.18 },
    { text: "El", startSeconds: 5.2, endSeconds: 5.6 },
    { text: "bajito", startSeconds: 6.2, endSeconds: 6.4 },
  ], [{ start: 4.66, end: 5.31 }, { start: 6, end: 7 }]);
  assert.deepEqual(snapped.map((word) => [word.startSeconds, word.endSeconds]), [[4.36, 4.66], [5.31, 5.6], [6.2, 6.4]]);
});

test("natural cuts in the real renderer: the countdown-free take keeps a 0.45 s pause instead of a 2 s one", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "segmenta-natural-cuts-"));
  const source = join(directory, "source.mp4");
  const output = join(directory, "out.mp4");
  try {
    // Voice 0.5–1.5 s and 3.5–4.5 s, silence elsewhere.
    const made = spawnSync(ffmpegPath!, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x568:r=30:d=5.5",
      "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=5.5",
      "-af", "volume=0:enable='not(between(t,0.5,1.5)+between(t,3.5,4.5))'", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", source], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    const clip = { id: "a", name: "Toma", object_key: "a", duration_seconds: 5.5, transcript: "" };
    const measured = await analyzeClipForCutSkill(ffmpegPath!, source, clip, Date.now() + 60_000);
    const { analysis, plan } = applyCutSkill(measured, clip);
    assert.equal(plan.shortenedPauses, 1);
    const expected = .15 + 1 + .45 + 1 + .25;
    const kept = analysis.ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    assert.ok(Math.abs(kept - expected) < .06, `kept ${kept}`);
    const style = getEditorStyle("segmenta-cinetico");
    const contract = {
      objective: "Prueba", session: { title: "" }, clips: [clip],
      style_snapshot: { ...style, subtitle: { ...style.subtitle }, execution: { ...style.execution } },
      captions: { enabled: false, max_words_per_card: 4 },
      dead_air: { remove: true, threshold_ms: 700, mode: "natural" },
      effects: { transitions: false, sound_effects: false, labels: false },
    };
    const rendered = await renderSequentialClip({ command: ffmpegPath!, contract: contract as never, analysis, url: source, index: 0, output, videoKbps: 1500, transitionSeconds: 0, deadline: Date.now() + 60_000 });
    assert.ok(Math.abs(rendered.duration - expected) < .1, `rendered ${rendered.duration}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
