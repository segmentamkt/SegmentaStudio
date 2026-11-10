/**
 * Skill independiente «Cortes y pausas» de Segmenta Studio.
 * Contrato y criterios de calidad: apps/studio-web/skills/cortes-pausas/SKILL.md
 *
 *   planCuts({ window, silences, words, script }) → tramos a conservar + qué se descartó y por qué
 */
export { planCuts, sameWord, normalizeToken, snapWordsToSilences, CUT_RULES } from "./plan";
export type { CutPlan, CutPlanInput, PlanWord, Range } from "./plan";
export { measureVoiceActivity, voiceActivityFromSamples, VOICE_RULES } from "./voice";
export type { VoiceActivity } from "./voice";
