import { z } from "zod";
import { EDITOR_STYLES } from "./editor-presets";
import { splitScriptBeats } from "./editorial-director";
import { SKILL_CATALOG, SKILL_IDS } from "./studio-skills";

export const preproductionSchema = z.object({
  schema: z.literal("segmenta.preproduction.v1"),
  description: z.string().trim().min(20).max(2000),
  style: z.enum(EDITOR_STYLES.map((style) => style.id) as [typeof EDITOR_STYLES[number]["id"], ...Array<typeof EDITOR_STYLES[number]["id"]>]),
  targetSeconds: z.number().int().min(10).max(120),
  scenes: z.array(z.object({ title: z.string().trim().min(1).max(80), spoken: z.string().trim().max(1000), visual: z.string().trim().max(300) })).min(1).max(12),
  skills: z.array(z.enum(SKILL_IDS)).max(SKILL_IDS.length),
  technical: z.object({
    removeSilence: z.boolean(), silenceThresholdMs: z.number().int().min(350).max(1500),
    noiseReduction: z.enum(["off", "light", "medium"]),
    captions: z.boolean(), transitions: z.boolean(), soundEffects: z.boolean(), labels: z.boolean(),
  }),
  conversation: z.array(z.object({ role: z.enum(["person", "ai"]), text: z.string().trim().min(1).max(1500) })).max(20),
});

export type PreproductionPlan = z.infer<typeof preproductionSchema>;

export function draftPreproductionPlan(script: string, essence = "claro, humano y visual"): PreproductionPlan {
  const beats = splitScriptBeats(script).slice(0, 12);
  const roles = ["Gancho", "Problema", "Valor", "Cierre / CTA"];
  const scenes = beats.length ? beats.map((beat, index) => ({
    title: roles[index] || `Escena ${index + 1}`,
    spoken: beat.text.slice(0, 1000),
    visual: index === 0 ? "Primer plano, apertura clara y rótulo breve." : index === beats.length - 1 ? "Cierre con llamada a la acción legible." : "Alternar plano principal con un apoyo visual pertinente.",
  })) : roles.map((title) => ({ title, spoken: "", visual: "Definir plano y recurso visual antes de grabar." }));
  return {
    schema: "segmenta.preproduction.v1",
    description: `Video vertical con tono ${essence}. Abrir con una idea clara, desarrollar cada escena en el orden del libreto y cerrar con una acción concreta. Cortar pausas largas sin perder intención. Mantener la voz al frente, subtítulos legibles y efectos discretos.`,
    style: "kiko-impacto", targetSeconds: 35, scenes,
    skills: SKILL_CATALOG.filter((skill) => skill.defaultEnabled).map((skill) => skill.id),
    technical: { removeSilence: true, silenceThresholdMs: 650, noiseReduction: "light", captions: true, transitions: true, soundEffects: true, labels: true },
    conversation: [],
  };
}
