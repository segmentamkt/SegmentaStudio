import assert from "node:assert/strict";
import test from "node:test";
import { draftPreproductionPlan, preproductionSchema } from "../lib/preproduction-plan";

test("the E01 script becomes an editable chronological plan before any upload", () => {
  const script = `E01 ¿Le tocó organizar la despedida?\nHOOK «¿A usted también le tocó organizar la despedida?»\nDOLOR «Buscar el sitio, cuadrar el presupuesto y la comida.»\nVALOR «Nosotros preparamos la lechona tradicional.»\nCTA «Escríbanos por WhatsApp para cotizar.»`;
  const plan = draftPreproductionPlan(script, "cálido y directo");
  assert.equal(plan.scenes.length, 4);
  assert.deepEqual(plan.scenes.map((scene) => scene.title), ["Gancho", "Problema", "Valor", "Cierre / CTA"]);
  assert.match(plan.scenes[3].spoken, /WhatsApp/);
  assert.match(plan.scenes[2].visual, /Plano detalle del producto/);
  assert.match(plan.scenes[3].visual, /WhatsApp/);
  assert.equal(plan.technical.noiseReduction, "light");
  assert.ok(plan.skills.includes("recortes"));
  assert.ok(preproductionSchema.safeParse(plan).success);
});

test("preproduction rejects impossible technical settings and too many scenes", () => {
  const plan = draftPreproductionPlan("La historia tiene un principio claro y un cierre concreto.");
  assert.equal(preproductionSchema.safeParse({ ...plan, technical: { ...plan.technical, noiseReduction: "strong" } }).success, false);
  assert.equal(preproductionSchema.safeParse({ ...plan, scenes: Array.from({ length: 13 }, () => plan.scenes[0]) }).success, false);
});
