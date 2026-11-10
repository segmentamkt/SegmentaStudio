/**
 * Skill independiente «Subtítulos cinéticos» de Segmenta Studio.
 * Contrato y criterios de calidad: apps/studio-web/skills/subtitulos-cineticos/SKILL.md
 *
 *   planKineticCaptions(cues)  → palabras con tiempo de visibilidad y estilo (puro, sin E/S)
 *   buildKineticLayer(words)   → fotogramas + lista ffconcat de la capa animada
 *   kineticOverlayFilter(...)  → filtro FFmpeg que la monta sobre el video
 */
export { planKineticCaptions, summarizeKineticPlan, cueTokens, cleanKineticText, normalizeWord, KINETIC_TIMING } from "./plan";
export type { KineticPlanOptions, KineticStyle, KineticWord } from "./plan";
export {
  buildKineticLayer, kineticInputArgs, kineticOverlayFilter, renderWordSprite, wordFrames, wordSpriteSvg,
  KINETIC_FONT_FILES, KINETIC_FPS, KINETIC_ORANGE, KINETIC_WHITE, KINETIC_ZONES,
} from "./render";
export type { KineticLayer, KineticLayerOptions, KineticZone, WordFrame, WordSprite } from "./render";
