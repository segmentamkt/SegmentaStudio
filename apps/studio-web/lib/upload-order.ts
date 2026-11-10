/**
 * Orden de montaje al subir varios videos.
 *
 * Al subir: un solo criterio para todo el lote, el más fiable disponible:
 *   1. fecha de grabación (metadatos del video o fecha escrita en el nombre, p. ej. WhatsApp),
 *   2. número del nombre en orden natural (IMG_8382 antes que IMG_8390, «2» antes que «10»),
 *   3. el orden en que se eligieron (y se pide revisarlo).
 * Después, con subtítulos y libreto, lo que se dice en cada toma decide (ver scriptOrderChange).
 */
export type UploadOrderStrategy = "fecha" | "nombre" | "seleccion";
export type UploadCandidate = { index: number; name: string; capturedAt: Date | null };
export type UploadOrderNote = { index: number; reason: string; uncertain: boolean };
export type UploadOrderPlan = { order: number[]; strategy: UploadOrderStrategy; summary: string; notes: UploadOrderNote[] };

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** «Video (2).mp4» → base «Video» y copia 2: el original va antes que sus copias numeradas. */
function nameKey(name: string) {
  const stem = name.replace(/\.[a-z0-9]{2,5}$/i, "").trim();
  const copy = stem.match(/^(.*?)\s*\((\d+)\)$/);
  return copy ? { base: copy[1], copy: Number(copy[2]) } : { base: stem, copy: 0 };
}

export const naturalCompare = (left: string, right: string) => {
  const a = nameKey(left);
  const b = nameKey(right);
  return collator.compare(a.base, b.base) || a.copy - b.copy;
};

/**
 * Fecha escrita en el nombre del archivo (hora local):
 * «WhatsApp Video 2026-11-06 at 14.39.47 (4)», «Grabación de pantalla 2026-11-10 a la(s) 2.15.39 p.m.»,
 * «Screen Recording 2026-11-10 at 2.15.39 PM», «VID_20261106_143947», «PXL_20261106_143947123».
 */
export function filenameDate(name: string): Date | null {
  const plain = name.replace(/[\u00a0\u202f]/g, " ");
  const spaced = plain.match(/(\d{4})-(\d{2})-(\d{2})\D{1,16}?(\d{1,2})[.:](\d{2})[.:](\d{2})(?:\s*([ap])\.?\s*m\b\.?)?/i);
  const compact = plain.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/);
  const match = spaced || compact;
  if (!match) return null;
  const [year, month, day, rawHour, minute, second] = match.slice(1, 7).map(Number);
  let hour = rawHour;
  const meridiem = spaced ? spaced[7]?.toLowerCase() : undefined;
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  const date = new Date(year, month - 1, day, hour, minute, second);
  const valid = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && hour < 24 && minute < 60 && second < 60;
  return valid && year >= 2000 && date.getTime() <= Date.now() + 86_400_000 ? date : null;
}

const when = (date: Date) => date.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function planUploadOrder(candidates: UploadCandidate[]): UploadOrderPlan {
  const dated = candidates.map((item) => {
    const fromFile = item.capturedAt;
    const fromName = fromFile ? null : filenameDate(item.name);
    return { ...item, date: fromFile ?? fromName, source: fromFile ? "grabacion" as const : fromName ? "nombre" as const : null };
  });
  if (candidates.length && dated.every((item) => item.date)) {
    const order = [...dated].sort((left, right) => left.date!.getTime() - right.date!.getTime() || naturalCompare(left.name, right.name) || left.index - right.index);
    return {
      order: order.map((item) => item.index), strategy: "fecha",
      summary: "Ordenados por fecha de grabación.",
      notes: dated.map((item) => ({ index: item.index, uncertain: false,
        reason: item.source === "grabacion" ? `Grabado el ${when(item.date!)}` : `Fecha del nombre: ${when(item.date!)}` })),
    };
  }
  const numbered = candidates.length > 1 && candidates.every((item) => /\d/.test(nameKey(item.name).base)) && new Set(candidates.map((item) => item.name.toLowerCase())).size === candidates.length;
  if (numbered) {
    const order = [...candidates].sort((left, right) => naturalCompare(left.name, right.name) || left.index - right.index);
    return {
      order: order.map((item) => item.index), strategy: "nombre",
      summary: "Sin fecha de grabación en todos: ordenados por el número del nombre.",
      notes: dated.map((item) => ({ index: item.index, uncertain: !item.date, reason: item.date ? `${item.source === "grabacion" ? "Grabado" : "Fecha del nombre"}: ${when(item.date)}` : "Por el número del nombre" })),
    };
  }
  return {
    order: candidates.map((item) => item.index), strategy: "seleccion",
    summary: candidates.length > 1 ? "No encontré fecha ni número en todos: quedan en el orden en que los elegiste. Revísalo." : "Un solo video.",
    notes: candidates.map((item) => ({ index: item.index, uncertain: candidates.length > 1, reason: "En el orden en que lo elegiste" })),
  };
}

/** Orden por defecto de la revisión de material: escena y luego hora de subida (igual que el panel de revisión). */
export function defaultReviewOrder(scenes: Array<{ id: string; position?: number }>, takes: Array<{ id: string; sceneId: string; createdAt?: string }>) {
  const position = new Map(scenes.map((scene) => [scene.id, Number(scene.position || 0)]));
  return [...takes].sort((left, right) => (position.get(left.sceneId) ?? 0) - (position.get(right.sceneId) ?? 0)
    || String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || left.id.localeCompare(right.id)).map((take) => take.id);
}

/** ¿El orden confirmado es el que venía de la subida? (Si alguien lo arrastró a mano, su decisión manda.) */
export function keepsDefaultOrder(confirmed: string[], defaults: string[]) {
  const chosen = new Set(confirmed);
  const expected = defaults.filter((id) => chosen.has(id));
  return expected.length === confirmed.length && expected.every((id, index) => id === confirmed[index]);
}

/**
 * Cambio de orden que pide el libreto: solo entre tomas incluidas, conservando el lugar de las excluidas.
 * Devuelve null si ya están en el orden del libreto.
 */
export function scriptOrderChange<T extends { segmentId: string; included: boolean; title: string }>(timeline: T[], suggestedIds: string[]) {
  const rank = new Map(suggestedIds.map((id, index) => [id, index]));
  const included = timeline.filter((clip) => clip.included && rank.has(clip.segmentId));
  const sorted = [...included].sort((left, right) => rank.get(left.segmentId)! - rank.get(right.segmentId)!);
  if (sorted.every((clip, index) => clip.segmentId === included[index].segmentId)) return null;
  let slot = 0;
  const next = timeline.map((clip) => clip.included && rank.has(clip.segmentId) ? sorted[slot++] : clip);
  const moved = sorted.flatMap((clip, index) => {
    const before = included.findIndex((item) => item.segmentId === clip.segmentId);
    return before === index ? [] : [{ title: clip.title, from: before + 1, to: index + 1 }];
  });
  return { next, moved };
}
