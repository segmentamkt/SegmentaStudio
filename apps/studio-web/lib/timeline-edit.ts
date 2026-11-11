/**
 * Geometría de la línea de tiempo de Studio: cuánto mide cada toma, dónde cae en la pista y qué
 * recorte u orden resulta de arrastrar. Sin React ni DOM, para probarlo con node:test.
 *
 * Unidades: segundos de origen (la grabación) dentro de la toma; píxeles en la pista. La pista muestra
 * el tiempo de salida, así que una toma a 2× ocupa la mitad de su recorte.
 */

export const MIN_TAKE_SECONDS = 0.2;
export const EXCLUDED_WIDTH_PX = 28;

export type TimelineSpan = {
  id: string;
  start: number;
  end: number;
  speed: number;
  included: boolean;
  /** Duración total de la grabación original: el final del recorte no puede pasarla. */
  sourceDuration: number;
};

export type TimelineBox = { id: string; left: number; width: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const speedOf = (span: Pick<TimelineSpan, "speed">) => Math.max(0.1, span.speed || 1);

/** Segundos que la toma ocupa en el MP4 final: el recorte dividido entre la velocidad. */
export function outputSeconds(span: TimelineSpan) {
  return span.included ? Math.max(0, span.end - span.start) / speedOf(span) : 0;
}

/** Posición y ancho de cada toma en la pista. Las excluidas ocupan un ancho fijo y no cuentan en el tiempo. */
export function layoutTimeline(spans: TimelineSpan[], pxPerSecond: number): TimelineBox[] {
  let left = 0;
  return spans.map((span) => {
    const width = span.included
      ? (Math.max(MIN_TAKE_SECONDS, span.end - span.start) / speedOf(span)) * pxPerSecond
      : EXCLUDED_WIDTH_PX;
    const box = { id: span.id, left, width };
    left += width;
    return box;
  });
}

export function timelineWidth(boxes: TimelineBox[]) {
  const last = boxes[boxes.length - 1];
  return last ? last.left + last.width : 0;
}

/** Segundo de origen que corresponde a una posición horizontal dentro de la toma. */
export function sourceSecondAt(span: TimelineSpan, offsetPx: number, pxPerSecond: number) {
  return clamp(span.start + (offsetPx / pxPerSecond) * speedOf(span), span.start, span.end);
}

/** Nuevo recorte al arrastrar uno de los bordes de la toma. Respeta el mínimo y la duración original. */
export function trimmedRange(span: TimelineSpan, edge: "start" | "end", deltaPx: number, pxPerSecond: number) {
  const delta = (deltaPx / pxPerSecond) * speedOf(span);
  if (edge === "start") return { start: clamp(span.start + delta, 0, span.end - MIN_TAKE_SECONDS), end: span.end };
  return { start: span.start, end: clamp(span.end + delta, span.start + MIN_TAKE_SECONDS, span.sourceDuration) };
}

/**
 * Posición de destino al soltar una toma arrastrada: cuántas otras tomas quedan a la izquierda del puntero.
 * Ese número es el índice de inserción en la lista sin la toma arrastrada.
 */
export function reorderTarget(boxes: TimelineBox[], draggedId: string, pointerX: number) {
  return boxes.filter((box) => box.id !== draggedId && box.left + box.width / 2 < pointerX).length;
}

/** Borde horizontal donde quedará la toma arrastrada, para dibujar la guía. */
export function dropEdgeLeft(boxes: TimelineBox[], draggedId: string, target: number) {
  const others = boxes.filter((box) => box.id !== draggedId);
  if (target <= 0 || !others.length) return 0;
  const before = others[Math.min(target, others.length) - 1];
  return before.left + before.width;
}

/** Posición del cursor sobre la pista para un segundo de origen; null si la toma no está incluida. */
export function playheadX(box: TimelineBox | undefined, span: TimelineSpan, seconds: number, pxPerSecond: number) {
  if (!box || !span.included) return null;
  return box.left + ((clamp(seconds, span.start, span.end) - span.start) / speedOf(span)) * pxPerSecond;
}

/** Un corte deja al menos 0,2 s a cada lado. */
export function canSplitAt(span: TimelineSpan, cut: number) {
  return span.included && cut - span.start >= MIN_TAKE_SECONDS && span.end - cut >= MIN_TAKE_SECONDS;
}
