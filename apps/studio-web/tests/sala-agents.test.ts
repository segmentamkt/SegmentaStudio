import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaptionCue } from "../lib/caption-cues";
import { AGENT_ORDER, buildSalaScript, planSalaClip, type SalaClipInput } from "../lib/sala/agents";
import { planCuts } from "../lib/skills/cortes-pausas/plan";

function clip(id: string, words: Array<[string, number, number]>, silences: Array<[number, number]>, duration: number, script?: string): SalaClipInput {
  const cue: CaptionCue = { startSeconds: words[0][1], endSeconds: words[words.length - 1][2], text: words.map(([text]) => text).join(" "),
    words: words.map(([text, startSeconds, endSeconds]) => ({ text, startSeconds, endSeconds })) };
  return { id, title: id, window: { start: 0, end: duration }, cues: [cue], script, silences: silences.map(([start, end]) => ({ start, end })), hasAudio: true };
}

const take = clip("Toma A", [["tres", .3, .5], ["dos", .8, 1], ["uno", 1.3, 1.5], ["Hoy", 2.4, 2.6], ["lanzamos", 2.65, 3.1], ["Segmenta", 4.4, 5]],
  [[0, .3], [.5, .8], [1, 1.3], [1.5, 2.4], [3.1, 4.4], [5, 6]], 6);
const second = clip("Toma B", [["Síguenos", .4, 1], ["ya", 1.05, 1.3]], [[0, .4], [1.3, 2]], 2);

test("the agents' actions are exactly the skills' real plans", () => {
  const plan = planSalaClip(take);
  const direct = planCuts({ window: take.window, silences: take.silences, hasAudio: true, words: take.cues[0].words });
  assert.deepEqual(plan.cut.ranges, direct.ranges, "same cuts as the render skill");
  assert.deepEqual(plan.words.map((word) => word.text), ["Hoy", "lanzamos", "Segmenta"], "the countdown never becomes a caption");
  assert.equal(plan.words.find((word) => word.text === "Segmenta")?.style, "enfasis");
  const script = buildSalaScript([take, second], { styleName: "Segmenta cinético", soundEffects: true });
  const cuts = script.lanes.cortes.filter((step) => step.action.kind === "cut" && step.clipIndex === 0);
  assert.equal(cuts.length, plan.removed.length);
  assert.ok(cuts.some((step) => step.label.includes("tres dos uno")), "the countdown removal is named");
  assert.ok(cuts.some((step) => /Acorta una pausa de 1,30 s a 0,45 s/.test(step.label)), cuts.map((step) => step.label).join(" | "));
  const words = script.lanes.subtitulos.filter((step) => step.action.kind === "word");
  assert.equal(words.length, plan.words.length + planSalaClip(second).words.length);
});

test("several agents work at once but never out of order", () => {
  const script = buildSalaScript([take, second], { styleName: "Segmenta cinético", soundEffects: true });
  assert.deepEqual(Object.keys(script.lanes), AGENT_ORDER);
  const ids = new Set(Object.values(script.lanes).flat().map((step) => step.id));
  for (const step of Object.values(script.lanes).flat()) for (const dependency of step.after ?? []) assert.ok(ids.has(dependency), `${step.id} waits for a real step`);
  const openSecond = script.lanes.director.find((step) => step.id === "director-clip-1")!;
  assert.ok(openSecond.after?.some((id) => id.startsWith("cortes")) && openSecond.after?.some((id) => id.startsWith("subtitulos")) && openSecond.after?.some((id) => id.startsWith("sonido")),
    "the Director opens the next take only after the previous one is finished");
  assert.ok(script.lanes.sonido.some((step) => step.label.includes("Acento")), "a scene change gets a discreet accent");
  const exportStep = script.lanes.director[script.lanes.director.length - 1];
  assert.equal(exportStep.action.kind, "export");
  assert.ok(exportStep.after?.length, "export waits for quality control");
  assert.equal(script.totalSteps, Object.values(script.lanes).reduce((sum, steps) => sum + steps.length, 0));
});

test("quality control reports honestly: missing timed captions are a warning, not a pass", () => {
  const untimed: SalaClipInput = { ...second, cues: [] };
  const script = buildSalaScript([untimed], { styleName: "Segmenta cinético" });
  const missing = script.lanes.subtitulos.find((step) => step.action.kind === "check");
  assert.ok(missing && missing.action.kind === "check" && !missing.action.ok);
  assert.ok(script.lanes.qa.every((step) => step.action.kind === "check"));
});
