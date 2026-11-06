export type EditorStyleId = "kiko-impacto" | "aula-premium" | "historia-cinematica" | "ia-demostrativa" | "autoridad-minimal" | "reflexion-intima" | "demo-visual-dividida" | "storytelling-marca-pop";

export type EditorStyle = {
  id: EditorStyleId; name: string; reference: string; description: string; pace: string;
  palette: [string, string, string]; caption: string; transition: "cut" | "fade" | "dissolve"; transitionDuration: number;
  subtitle: { text: string; box: string; size: number; uppercase: boolean; position: "top" | "center" | "bottom"; maxWords: number };
  execution: { silenceThresholdMs: number; zoomPercent: number; contrast: number; saturation: number; soundEffectVolume: number; soundPreset?: "auto" | "none" | "soft" | "kinetic" | "cinematic" | "pop"; noiseReduction?: "off" | "light" | "medium"; framing: "fill" | "fit"; titleCards: boolean; titleColor: string };
};

export const EDITOR_STYLES: EditorStyle[] = [
  {
    id: "kiko-impacto", name: "Impacto directo", reference: "Alex Hormozi · Juan Lombana",
    description: "Cortes firmes, lectura muy visible y bloques breves para sostener la atención.", pace: "Ágil · ventas y hooks",
    palette: ["#7c3aed", "#09090b", "#facc15"], caption: "NO VENDAS SIN ESTO", transition: "fade", transitionDuration: .18,
    subtitle: { text: "#facc15", box: "#09090b", size: 82, uppercase: true, position: "bottom", maxWords: 4 },
    execution: { silenceThresholdMs: 500, zoomPercent: 5, contrast: 1.08, saturation: 1.12, soundEffectVolume: .65, framing: "fill", titleCards: true, titleColor: "#7c3aed" },
  },
  {
    id: "aula-premium", name: "Educativo premium", reference: "Vilma Núñez · Ali Abdaal",
    description: "Jerarquía limpia, ritmo cómodo y subtítulos discretos para transmitir claridad.", pace: "Natural · tutoriales",
    palette: ["#7c3aed", "#fff7ed", "#ffffff"], caption: "MÉTODO SIMPLE", transition: "cut", transitionDuration: .2,
    subtitle: { text: "#ffffff", box: "#7c3aed", size: 58, uppercase: false, position: "bottom", maxWords: 6 },
    execution: { silenceThresholdMs: 750, zoomPercent: 1, contrast: 1.03, saturation: 1.03, soundEffectVolume: .35, framing: "fit", titleCards: true, titleColor: "#7c3aed" },
  },
  {
    id: "historia-cinematica", name: "Historia cinematográfica", reference: "Euge Oller",
    description: "Montaje sobrio, pausas con intención y una lectura que acompaña sin competir.", pace: "Emotivo · storytelling",
    palette: ["#0f172a", "#f59e0b", "#f8fafc"], caption: "TODO CAMBIÓ AQUÍ", transition: "fade", transitionDuration: .45,
    subtitle: { text: "#ffffff", box: "#111827", size: 54, uppercase: false, position: "bottom", maxWords: 6 },
    execution: { silenceThresholdMs: 1100, zoomPercent: 2, contrast: 1.08, saturation: .92, soundEffectVolume: .25, framing: "fill", titleCards: true, titleColor: "#0f172a" },
  },
  {
    id: "ia-demostrativa", name: "IA demostrativa", reference: "Riley Brown",
    description: "Caption protagonista, bloques rápidos y alto contraste para explicar mientras se muestra.", pace: "Ágil · demos de IA",
    palette: ["#0891b2", "#09090b", "#22d3ee"], caption: "AUTOMATIZA ESTO", transition: "cut", transitionDuration: .18,
    subtitle: { text: "#22d3ee", box: "#09090b", size: 64, uppercase: true, position: "center", maxWords: 4 },
    execution: { silenceThresholdMs: 450, zoomPercent: 4, contrast: 1.1, saturation: 1.08, soundEffectVolume: .5, framing: "fill", titleCards: true, titleColor: "#0891b2" },
  },
  {
    id: "autoridad-minimal", name: "Autoridad minimalista", reference: "Dan Koe",
    description: "Imagen despejada, lectura elegante y menos estímulos para que domine la idea.", pace: "Natural · tesis y marca",
    palette: ["#111827", "#fff7ed", "#e5e7eb"], caption: "MENOS RUIDO", transition: "cut", transitionDuration: .2,
    subtitle: { text: "#ffffff", box: "#111827", size: 52, uppercase: false, position: "bottom", maxWords: 7 },
    execution: { silenceThresholdMs: 900, zoomPercent: 0, contrast: 1.02, saturation: .96, soundEffectVolume: .2, framing: "fit", titleCards: false, titleColor: "#111827" },
  },
  {
    id: "reflexion-intima", name: "Reflexión íntima", reference: "Francisco Sola",
    description: "Monólogo cercano, pausas emocionales y lectura central palabra a palabra.", pace: "Humano · reflexiones",
    palette: ["#18181b", "#a16207", "#ffffff"], caption: "LAS PERSONAS QUE AMAS", transition: "cut", transitionDuration: 0,
    subtitle: { text: "#ffffff", box: "#18181b", size: 60, uppercase: false, position: "center", maxWords: 4 },
    execution: { silenceThresholdMs: 1200, zoomPercent: 2, contrast: 1.07, saturation: .9, soundEffectVolume: 0, framing: "fill", titleCards: false, titleColor: "#18181b" },
  },
  {
    id: "demo-visual-dividida", name: "Demo visual dividida", reference: "Alejo Santana",
    description: "Presentador abajo y demostración o resultado arriba, con palabras clave amarillas.", pace: "Rápido · tutorial visual",
    palette: ["#111827", "#facc15", "#ffffff"], caption: "PLANTILLA DE PROMPT", transition: "cut", transitionDuration: 0,
    subtitle: { text: "#ffffff", box: "#111827", size: 66, uppercase: false, position: "bottom", maxWords: 5 },
    execution: { silenceThresholdMs: 450, zoomPercent: 3, contrast: 1.07, saturation: 1.08, soundEffectVolume: .2, framing: "fill", titleCards: true, titleColor: "#facc15" },
  },
  {
    id: "storytelling-marca-pop", name: "Storytelling de marca pop", reference: "StratCom · Postobón",
    description: "Relato enérgico con palabras cinéticas, placas de color y ritmo de campaña.", pace: "Dinámico · historias de marca",
    palette: ["#ec4899", "#0f172a", "#ffffff"], caption: "PASABA POR", transition: "cut", transitionDuration: 0,
    subtitle: { text: "#ffffff", box: "#ec4899", size: 70, uppercase: true, position: "center", maxWords: 4 },
    execution: { silenceThresholdMs: 500, zoomPercent: 5, contrast: 1.1, saturation: 1.16, soundEffectVolume: .35, framing: "fill", titleCards: true, titleColor: "#ec4899" },
  },
];

const LEGACY_ALIASES: Record<string, EditorStyleId> = {
  segmenta_punch: "kiko-impacto", david_clean: "autoridad-minimal", viral_kinetic: "kiko-impacto",
  cinematic_story: "historia-cinematica", podcast_authority: "aula-premium",
};

export function getEditorStyle(value: unknown) {
  const id = typeof value === "string" ? (LEGACY_ALIASES[value] || value) : "";
  return EDITOR_STYLES.find((style) => style.id === id) || EDITOR_STYLES[0];
}
