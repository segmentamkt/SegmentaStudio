import assert from "node:assert/strict";
import { test } from "node:test";
import { answerPenguinGuide, guideNextStep } from "../lib/penguin-guide";

test("guide points a new visitor to upload, then advances with the project", () => {
  assert.equal(guideNextStep({ view: "summary", projectCount: 0, approvedCount: 0, readyCount: 0 }).action?.destination, "upload");
  assert.equal(guideNextStep({ view: "record", projectCount: 1, approvedCount: 0, readyCount: 0 }).action?.destination, "record");
  assert.equal(guideNextStep({ view: "edit", projectCount: 1, approvedCount: 2, readyCount: 0 }).action?.destination, "edit");
  assert.equal(guideNextStep({ view: "library", projectCount: 1, approvedCount: 2, readyCount: 1 }).action?.destination, "library");
});

test("guide routes common editing questions and states missing capabilities plainly", () => {
  const context = { view: "edit", projectCount: 1, approvedCount: 3, readyCount: 0 };
  assert.match(answerPenguinGuide("¿Cómo pongo subtítulos?", context).text, /SRT\/VTT/);
  assert.match(answerPenguinGuide("¿Cómo quito los tiempos muertos?", context).text, /Cortar silencios/);
  assert.match(answerPenguinGuide("Quiero sacar clips de un video largo", context).text, /todavía está en desarrollo/);
  assert.match(answerPenguinGuide("¿Está conectado Gemini?", context).text, /todavía no está activa/);
  assert.equal(answerPenguinGuide("¿Dónde descargo mi video?", context).action?.destination, "library");
});
