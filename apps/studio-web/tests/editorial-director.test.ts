import assert from "node:assert/strict";
import test from "node:test";
import { planFromScript } from "../lib/editorial-director";

const script = [
  "Buscar el sitio y organizar al equipo es difícil; falta un buen plato de lechona.",
  "Pero fresco, de eso nos encargamos nosotros.",
  "Preparamos lechona tradicional para compartir con todo tu equipo.",
  "Díganos la cantidad de personas y la fecha.",
  "Escríbanos por WhatsApp y le damos una cotización.",
].join("\n\n");

test("orders spoken clips by script and recommends concrete visual support", () => {
  const plan = planFromScript(script, [
    { id: "cta", title: "Cierre", transcript: "Escríbanos por WhatsApp y le damos una cotización." },
    { id: "product", title: "Producto", transcript: "Preparamos lechona tradicional para compartir con todo tu equipo." },
    { id: "hook", title: "Problema", transcript: "Buscar el sitio y organizar al equipo es difícil; falta un buen plato de lechona." },
    { id: "solution", title: "Solución", transcript: "Pero fresco, de eso nos encargamos nosotros." },
    { id: "details", title: "Pedido", transcript: "Díganos la cantidad de personas y la fecha." },
  ]);
  assert.equal(plan.reliableOrder, true);
  assert.deepEqual(plan.suggestedClipIds, ["hook", "solution", "product", "details", "cta"]);
  assert.equal(plan.missingBeats.length, 0);
  assert.ok(plan.resources.some((item) => item.kind === "apoyo" && item.needsMedia));
  assert.ok(plan.resources.some((item) => item.kind === "cta" && item.generatedLabel));
});

test("does not claim a reliable chronology without transcriptions", () => {
  const plan = planFromScript(script, [{ id: "one", title: "IMG_1", transcript: "" }, { id: "two", title: "IMG_2", transcript: "" }]);
  assert.equal(plan.reliableOrder, false);
  assert.equal(plan.transcriptCoverage, 0);
  assert.equal(plan.missingBeats.length, 5);
});

test("flags repeated speech and a missing script beat", () => {
  const plan = planFromScript(script, [
    { id: "one", title: "A", transcript: "Díganos la cantidad de personas y la fecha." },
    { id: "two", title: "B", transcript: "Díganos la cantidad de personas y la fecha." },
  ]);
  assert.deepEqual(plan.repeatedBeats, [3]);
  assert.equal(plan.reliableOrder, false);
  assert.ok(plan.missingBeats.some((beat) => beat.index === 0));
});

test("orders two distinct spoken fragments inside the same E01 script beat", () => {
  const episode = `E01 ¿Le tocó organizar la despedida?\nHUMOR COTIDIANO · 30 s\nHOOK Don Óscar: «¿A usted también le tocó organizar la despedida de fin de año de la empresa? ¡Uy, lo pusieron a trabajar doble!»\nDOLOR Don Óscar: «Que buscar el sitio, organizar a los compañeros, cuadrar el presupuesto… ¡y todavía falta lo más importante: la comida!»`;
  const plan = planFromScript(episode, [
    { id: "pain2", title: "IMG_2", transcript: "cuadrar el presupuesto y todavía falta lo más importante la comida" },
    { id: "hook2", title: "IMG_3", transcript: "uy lo pusieron a trabajar doble" },
    { id: "pain1", title: "IMG_4", transcript: "que buscar el sitio organizar a los compañeros" },
    { id: "hook1", title: "IMG_1", transcript: "a usted también le tocó organizar la despedida de fin de año de la empresa" },
  ]);
  assert.equal(plan.beats.length, 2);
  assert.equal(plan.reliableOrder, true);
  assert.deepEqual(plan.suggestedClipIds, ["hook1", "hook2", "pain1", "pain2"]);
});
