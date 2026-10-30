import { Easing, interpolate } from "remotion";
import type { Timeline, Tramo, Ventana } from "./tipos";

export const MORADO = "#2E1065";
export const VIOLETA = "#7C3AED";
export const AMARILLO = "#FFD400";
export const FUENTE = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const PANEL_ALTO = 864;
/** Los gráficos usan solo hasta esta altura; debajo va la franja de subtítulos en pantalla dividida. */
export const ZONA_GRAFICO = 700;
export const SUBTITULO_DIVIDIDO = 790;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 → 1 entre a y b con suavizado. */
export const progreso = (t: number, a: number, b: number, easing = Easing.out(Easing.cubic)) =>
  b <= a ? (t >= a ? 1 : 0) : interpolate(t, [a, b], [0, 1], { ...clamp, easing });

/** Entra y sale con fundido de d segundos dentro de [inicio, fin]. */
export const fundido = (t: number, inicio: number, fin: number, d = 0.2) => {
  const lado = Math.min(d, (fin - inicio) / 2 - 0.001);
  if (lado <= 0) return t >= inicio && t < fin ? 1 : 0;
  return interpolate(t, [inicio, inicio + lado, fin - lado, fin], [0, 1, 1, 0], clamp);
};

/** Cuánto de pantalla dividida hay en t (transición de 0,2 s en cada borde). */
export const division = (t: number, ventanas: Ventana[]) =>
  Math.max(0, ...ventanas.map(([a, b]) => Easing.inOut(Easing.cubic)(fundido(t, a, b, 0.2))));

export const activa = (t: number, ventanas: Ventana[]) => ventanas.some(([a, b]) => t >= a && t < b);

/** Tramos del montaje; sin montaje, la toma completa de corrido. */
export const tramosDe = (timeline: Timeline): Tramo[] =>
  timeline.tramos?.length ? timeline.tramos : [{ desde: 0, hasta: timeline.duracion_voz ?? timeline.duracion, salida: 0 }];

/** Video y voz de la toma de un tramo (con varias tomas, cada tramo sabe de qué archivo viene). */
export const fuenteDe = (timeline: Timeline, tramo: Tramo) =>
  timeline.fuente.clips?.[tramo.clip ?? 0] ?? { clip: timeline.fuente.clip, voz: timeline.fuente.voz };
