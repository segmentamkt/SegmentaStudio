export type EditorStyleId = "segmenta_punch" | "david_clean" | "viral_kinetic" | "cinematic_story" | "podcast_authority";

export type EditorStyle = {
  id: EditorStyleId;
  name: string;
  reference: string;
  description: string;
  pace: string;
  palette: [string, string, string];
  caption: string;
  transition: "cut" | "fade" | "dissolve";
  subtitle: { text: string; box: string; size: number; uppercase: boolean };
};

export const EDITOR_STYLES: EditorStyle[] = [
  {
    id: "segmenta_punch",
    name: "Segmenta Punch",
    reference: "Identidad principal",
    description: "Gancho fuerte, morado de marca, cortes compactos, palabras clave y golpes sonoros selectivos.",
    pace: "Dinámico · 1,8–2,8 s",
    palette: ["#7c3aed", "#22d3ee", "#ffffff"],
    caption: "IDEAS QUE VENDEN",
    transition: "dissolve",
    subtitle: { text: "#ffffff", box: "#5b21b6", size: 66, uppercase: true },
  },
  {
    id: "david_clean",
    name: "Negocio limpio",
    reference: "Referencia David M.",
    description: "Plano protagonista, tipografía sobria, acercamientos discretos y recursos visuales solo cuando explican.",
    pace: "Preciso · 2,5–4 s",
    palette: ["#111827", "#f8fafc", "#a3e635"],
    caption: "CRECE CON SISTEMA",
    transition: "cut",
    subtitle: { text: "#ffffff", box: "#111827", size: 60, uppercase: false },
  },
  {
    id: "viral_kinetic",
    name: "Viral cinético",
    reference: "Reels / TikTok",
    description: "Ritmo alto, subtítulos grandes, zooms, etiquetas y transiciones con energía para retención.",
    pace: "Rápido · 1,2–2,2 s",
    palette: ["#facc15", "#ef4444", "#ffffff"],
    caption: "NO COMETAS ESTE ERROR",
    transition: "dissolve",
    subtitle: { text: "#ffffff", box: "#dc2626", size: 72, uppercase: true },
  },
  {
    id: "cinematic_story",
    name: "Historia cinematográfica",
    reference: "Storytelling",
    description: "Pausas intencionales, contraste cálido, rótulos minimalistas y transiciones suaves.",
    pace: "Emotivo · 3–5 s",
    palette: ["#0f172a", "#f59e0b", "#f8fafc"],
    caption: "TODO CAMBIÓ ESE DÍA",
    transition: "fade",
    subtitle: { text: "#ffffff", box: "#0f172a", size: 54, uppercase: false },
  },
  {
    id: "podcast_authority",
    name: "Autoridad podcast",
    reference: "Educativo / opinión",
    description: "Lectura cómoda, ritmo estable, subtítulos centrados y etiquetas para conceptos clave.",
    pace: "Estable · 3–6 s",
    palette: ["#0e7490", "#ecfeff", "#67e8f9"],
    caption: "LA CLAVE ES EL FOCO",
    transition: "cut",
    subtitle: { text: "#ecfeff", box: "#155e75", size: 58, uppercase: false },
  },
];

export function getEditorStyle(value: unknown) {
  return EDITOR_STYLES.find((style) => style.id === value) || EDITOR_STYLES[0];
}
