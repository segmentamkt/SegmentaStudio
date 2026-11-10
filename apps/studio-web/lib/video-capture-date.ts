/**
 * Fecha real de grabación de un video MP4/MOV, leída en el navegador sin cargar el archivo:
 * se recorren solo las cabeceras de las cajas hasta encontrar `moov` (esté al inicio o al final)
 * y se lee, por orden de fiabilidad:
 *   1. `com.apple.quicktime.creationdate` (iPhone: hora local de captura con su zona horaria),
 *   2. `©day` del bloque de usuario (algunas cámaras y Android),
 *   3. `creation_time` de `mvhd` (UTC; muchos teléfonos lo rellenan al grabar).
 * Los videos reenviados por WhatsApp pierden estos datos: entonces devuelve null.
 */
type Sliceable = { size: number; slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> } };
export type CaptureDate = { date: Date; source: "apple" | "udta" | "mvhd" };

const MAX_MOOV_BYTES = 24 * 1024 * 1024;
const EPOCH_1904_MS = Date.UTC(1904, 0, 1);
const MIN_VALID_MS = Date.UTC(2000, 0, 1);

async function read(file: Sliceable, start: number, length: number) {
  return new DataView(await file.slice(start, Math.min(file.size, start + length)).arrayBuffer());
}

const fourcc = (view: DataView, offset: number) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

function plausible(ms: number) {
  return Number.isFinite(ms) && ms >= MIN_VALID_MS && ms <= Date.now() + 86_400_000;
}

/** «2026-10-31T12:20:36-0500» (sin dos puntos en la zona) también es válido. */
export function parseMetadataDate(value: string): Date | null {
  const text = value.replace(/\0/g, "").trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(/ /, "T");
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const ms = Date.parse(text);
  return plausible(ms) ? new Date(ms) : null;
}

type Box = { type: string; start: number; end: number };

/** Cajas hijas dentro de [start, end) de una vista ya cargada. */
function children(view: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end && boxes.length < 512) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) break;
    boxes.push({ type: fourcc(view, offset + 4), start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function text(view: DataView, start: number, end: number) {
  return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + start, Math.max(0, end - start)));
}

/** QuickTime `meta` (keys + ilst): busca la clave de fecha de creación de Apple. */
function appleCreationDate(view: DataView, meta: Box): Date | null {
  // In QuickTime files `meta` is a plain container; in ISO files it is a full box (4 bytes of version/flags).
  const plain = meta.start + 8 <= meta.end && fourcc(view, meta.start + 4) === "hdlr";
  const inner = children(view, plain ? meta.start : meta.start + 4, meta.end);
  const keysBox = inner.find((box) => box.type === "keys");
  const ilst = inner.find((box) => box.type === "ilst");
  if (!keysBox || !ilst || keysBox.start + 8 > keysBox.end) return null;
  const keys: string[] = [];
  const count = view.getUint32(keysBox.start + 4);
  let offset = keysBox.start + 8;
  for (let index = 0; index < count && offset + 8 <= keysBox.end; index += 1) {
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > keysBox.end) break;
    keys.push(text(view, offset + 8, offset + size));
    offset += size;
  }
  const wanted = keys.indexOf("com.apple.quicktime.creationdate") + 1;
  if (!wanted) return null;
  for (const item of children(view, ilst.start, ilst.end)) {
    if (view.getUint32(item.start - 4) !== wanted) continue;
    const data = children(view, item.start, item.end).find((box) => box.type === "data");
    if (data && data.start + 8 <= data.end) return parseMetadataDate(text(view, data.start + 8, data.end));
  }
  return null;
}

/** `udta/©day`: forma clásica de QuickTime (longitud + idioma + texto) o forma iTunes (caja `data`). */
function userDataDate(view: DataView, udta: Box): Date | null {
  for (const box of children(view, udta.start, udta.end)) {
    if (box.type === "\u00a9day") {
      const data = children(view, box.start, box.end).find((item) => item.type === "data");
      if (data) return parseMetadataDate(text(view, data.start + 8, data.end));
      if (box.start + 4 <= box.end) {
        const length = view.getUint16(box.start);
        return parseMetadataDate(text(view, box.start + 4, Math.min(box.end, box.start + 4 + length)));
      }
    }
    if (box.type === "meta") {
      const plain = box.start + 8 <= box.end && fourcc(view, box.start + 4) === "hdlr";
      const ilst = children(view, plain ? box.start : box.start + 4, box.end).find((item) => item.type === "ilst");
      const day = ilst && children(view, ilst.start, ilst.end).find((item) => item.type === "\u00a9day");
      const data = day && children(view, day.start, day.end).find((item) => item.type === "data");
      if (data) return parseMetadataDate(text(view, data.start + 8, data.end));
    }
  }
  return null;
}

function movieHeaderDate(view: DataView, mvhd: Box): Date | null {
  if (mvhd.start + 12 > mvhd.end) return null;
  const version = view.getUint8(mvhd.start);
  const seconds = version === 1 ? Number(view.getBigUint64(mvhd.start + 4)) : view.getUint32(mvhd.start + 4);
  const ms = EPOCH_1904_MS + seconds * 1000;
  return seconds > 0 && plausible(ms) ? new Date(ms) : null;
}

/** Lee la fecha de grabación; null si el archivo no la tiene o no es MP4/MOV. Nunca lanza. */
export async function readCaptureDate(file: Sliceable): Promise<CaptureDate | null> {
  try {
    let offset = 0;
    for (let guard = 0; guard < 128 && offset + 8 <= file.size; guard += 1) {
      const head = await read(file, offset, 16);
      if (head.byteLength < 8) return null;
      let size = head.getUint32(0);
      let header = 8;
      const type = fourcc(head, 4);
      if (size === 1) {
        if (head.byteLength < 16) return null;
        size = Number(head.getBigUint64(8));
        header = 16;
      } else if (size === 0) size = file.size - offset;
      if (size < header || !/^[\x20-\x7e\u00a9]{4}$/.test(type)) return null;
      if (type === "moov") {
        if (size > MAX_MOOV_BYTES) return null;
        const view = await read(file, offset, size);
        const boxes = children(view, header, view.byteLength);
        const udta = boxes.find((box) => box.type === "udta");
        // iPhone writes `meta` straight in `moov`; other muxers nest it in `udta`.
        const metas = [...boxes.filter((box) => box.type === "meta"), ...(udta ? children(view, udta.start, udta.end).filter((box) => box.type === "meta") : [])];
        for (const meta of metas) {
          const apple = appleCreationDate(view, meta);
          if (apple) return { date: apple, source: "apple" };
        }
        const day = udta && userDataDate(view, udta);
        if (day) return { date: day, source: "udta" };
        const mvhd = boxes.find((box) => box.type === "mvhd");
        const movie = mvhd && movieHeaderDate(view, mvhd);
        return movie ? { date: movie, source: "mvhd" } : null;
      }
      offset += size;
    }
    return null;
  } catch {
    return null;
  }
}
