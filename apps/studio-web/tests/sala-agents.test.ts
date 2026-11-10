import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaptionCue } from "../lib/caption-cues";
import { AGENT_ORDER, buildSalaScript, fillCrop, lookFromPixels, planSalaClip, type SalaClipInput } from "../lib/sala/agents";
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

test("framing and color agents report what the render really does with each take", () => {
  // 1920×1080 cubre 1080×1920 escalando ×1,78: solo queda visible el 31,6 % del ancho, centrado.
  const wide = fillCrop({ width: 1920, height: 1080 });
  assert.ok(Math.abs(wide.width - .3164) < .001 && wide.height === 1, JSON.stringify(wide));
  assert.deepEqual(fillCrop({ width: 1080, height: 1920 }), { width: 1, height: 1 });
  assert.deepEqual(fillCrop({ width: 1920, height: 1080 }, "fit"), { width: 1, height: 1 });
  const zoomed = fillCrop({ width: 720, height: 1280 }, "fill", 5);
  assert.ok(Math.abs(zoomed.width - 1 / 1.05) < .001);

  const dark = lookFromPixels([2, 2, 3, 255, 30, 28, 25, 255]);
  assert.ok(dark.luma < .16 && dark.clipped === 0, `a dark background is not "burnt": ${JSON.stringify(dark)}`);
  assert.equal(lookFromPixels([255, 255, 255, 255, 120, 120, 120, 255]).clipped, .5);
  const script = buildSalaScript([{ ...take, frame: { width: 1920, height: 1080 }, look: dark }, { ...second, frame: { width: 720, height: 1280 }, look: null }], { styleName: "Segmenta cinético" });
  assert.deepEqual(script.lanes.encuadre.map((step) => step.label), [
    "Toma horizontal 1920×1080: llena el 9:16 con recorte centrado (se ve el 32 % del ancho)",
    "Toma vertical 720×1280: llena el 9:16 sin recortar",
  ]);
  assert.match(script.lanes.color[0].label, /^Color neutro, sin filtros · luz media \d+ % · saturación \d+ %$/);
  assert.equal(script.lanes.color[1].label, "Color neutro, sin filtros", "no measurement is invented when frames cannot be read");
  assert.deepEqual(script.lanes.color[0].after, ["encuadre-0"], "color looks at the framed image");
  assert.ok(script.lanes.qa.some((step) => step.action.kind === "check" && !step.action.ok && step.label.startsWith("Imagen oscura")), "a dark take is flagged, never filtered");
  const openSecond = script.lanes.director.find((step) => step.id === "director-clip-1")!;
  assert.ok(openSecond.after?.includes("encuadre-0") && openSecond.after?.includes("color-0"));
  const styled = buildSalaScript([take], { styleName: "Otro", look: { framing: "fill", contrast: 1.08, saturation: 1.12 } });
  assert.equal(styled.lanes.color[0].label, "Contraste 1,08 y saturación 1,12 del estilo");
});
