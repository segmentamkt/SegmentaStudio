/**
 * Skill «Subtítulos cinéticos» — dibujo y capa para FFmpeg.
 *
 * Cada palabra se dibuja con los contornos reales de Montserrat (opentype.js →
 * SVG → sharp), así el resultado es idéntico en el Mac y en el servidor sin
 * depender de fontconfig. La animación replica la referencia aprobada:
 * entrada con rebote (o con escala desde grande en las palabras de énfasis),
 * mantenimiento estable y salida de dos fotogramas.
 *
 * Toda la capa se entrega como UNA secuencia de imágenes (demuxer concat con
 * duraciones exactas): un solo `overlay` por toma, no uno por palabra.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";
import type { KineticStyle, KineticWord } from "./plan";

export const KINETIC_ORANGE = "#FF7A00";
export const KINETIC_WHITE = "#FFFFFF";
export const KINETIC_FPS = 30;

export const KINETIC_FONT_FILES: Record<KineticStyle, string> = {
  normal: "Montserrat-ExtraBoldItalic.ttf",
  enfasis: "Montserrat-BlackItalic.ttf",
  ligera: "Montserrat-LightItalic.ttf",
};

/** Tamaños de la referencia para un cuadro de 1080 px de ancho. */
const BASE_SIZE: Record<KineticStyle, number> = { normal: 112, enfasis: 138, ligera: 92 };

/** Altura del centro de la palabra (fracción del alto). «chest» = bajo la barbilla del presentador. */
export const KINETIC_ZONES = { top: .19, center: .47, chest: .64, bottom: .79 } as const;
export type KineticZone = keyof typeof KINETIC_ZONES;

/** Centro horizontal de la referencia: la itálica se compensa levemente a la izquierda. */
const CENTER_X = .47;
const MAX_TEXT_WIDTH = .80;

const fontCache = new Map<string, opentype.Font>();

function loadFont(fontDir: string, style: KineticStyle) {
  const path = join(fontDir, KINETIC_FONT_FILES[style]);
  let font = fontCache.get(path);
  if (!font) {
    font = opentype.loadSync(path);
    fontCache.set(path, font);
  }
  return font;
}

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const easeOutCubic = (value: number) => 1 - (1 - clamp(value)) ** 3;
const easeOutBack = (value: number, overshoot = 1.9) => {
  const x = clamp(value);
  return 1 + (overshoot + 1) * (x - 1) ** 3 + overshoot * (x - 1) ** 2;
};

export type WordSprite = { data: Buffer; width: number; height: number; fontSize: number };

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** SVG de una palabra: resplandor naranja (énfasis), sombra suave y relleno. */
export function wordSpriteSvg(text: string, style: KineticStyle, options: { fontDir: string; frameWidth?: number; sizeScale?: number }) {
  const font = loadFont(options.fontDir, style);
  const frameWidth = options.frameWidth ?? 1080;
  let size = BASE_SIZE[style] * frameWidth / 1080 * (options.sizeScale ?? 1);
  while (font.getAdvanceWidth(text, size, { kerning: true }) > frameWidth * MAX_TEXT_WIDTH && size > 30) size *= .92;
  const ascender = font.ascender / font.unitsPerEm * size;
  const descender = -font.descender / font.unitsPerEm * size;
  const advance = font.getAdvanceWidth(text, size, { kerning: true });
  const pad = Math.round(size * .55) + 20;
  const width = Math.ceil(advance + 2 * pad + size * .25);
  const height = Math.ceil(ascender + descender + 2 * pad);
  const path = font.getPath(text, pad, pad + ascender, size, { kerning: true }).toPathData(2);
  const color = style === "enfasis" ? KINETIC_ORANGE : KINETIC_WHITE;
  const region = `x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse"`;
  const glow = style === "enfasis"
    ? `<filter id="glow" ${region}><feMorphology in="SourceAlpha" operator="dilate" radius="2" result="wide"/><feGaussianBlur in="wide" stdDeviation="${(size * .30).toFixed(2)}" result="soft"/><feComponentTransfer in="soft" result="strong"><feFuncA type="linear" slope="1.44"/></feComponentTransfer><feFlood flood-color="${KINETIC_ORANGE}"/><feComposite in2="strong" operator="in"/></filter>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${glow}`
    + `<filter id="shadow" ${region}><feGaussianBlur in="SourceAlpha" stdDeviation="${(size * .10).toFixed(2)}"/><feOffset dy="${(size * .05).toFixed(2)}"/><feComponentTransfer><feFuncA type="linear" slope="0.6"/></feComponentTransfer></filter></defs>`
    + (glow ? `<path d="${escapeAttribute(path)}" fill="${KINETIC_ORANGE}" filter="url(#glow)"/>` : "")
    + `<path d="${escapeAttribute(path)}" fill="#000" filter="url(#shadow)"/>`
    + `<path d="${escapeAttribute(path)}" fill="${color}"/></svg>`;
  return { svg, width, height, fontSize: size };
}

/** Rasteriza la palabra y recorta al área con tinta (como la referencia). */
export async function renderWordSprite(text: string, style: KineticStyle, options: { fontDir: string; frameWidth?: number; sizeScale?: number }): Promise<WordSprite> {
  const { svg, fontSize } = wordSpriteSvg(text, style, options);
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let top = info.height, left = info.width, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 2) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error(`La palabra «${text}» no produjo trazo visible.`);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const cropped = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width, height }).raw().toBuffer();
  return { data: cropped, width, height, fontSize };
}

export type WordFrame = { scale: number; alpha: number; dy: number; seconds: number };

/**
 * Fotogramas de una palabra para un tiempo visible dado. Entrada (≈0,15 s),
 * estable y salida (2 fotogramas). Se calcula a mitad de cada fotograma.
 */
export function wordFrames(style: KineticStyle, visibleSeconds: number, options: { frameWidth?: number; fps?: number } = {}): WordFrame[] {
  const fps = options.fps ?? KINETIC_FPS;
  const step = 1 / fps;
  const lift = 22 * (options.frameWidth ?? 1080) / 1080;
  const entry = style === "enfasis" ? .16 : .15;
  const entryFrames = Math.ceil(entry * fps - 1e-6);
  const exitFrames = 2;
  const frames: WordFrame[] = [];
  const total = Math.max(1, Math.round(visibleSeconds * fps));
  const usableExit = total > entryFrames + exitFrames ? exitFrames : Math.max(0, Math.min(exitFrames, total - 1));
  const usableEntry = Math.min(entryFrames, total - usableExit);
  for (let index = 0; index < usableEntry; index += 1) {
    const elapsed = (index + .5) * step;
    const progress = elapsed / entry;
    const alpha = clamp(elapsed / .05);
    frames.push(style === "enfasis"
      ? { scale: 1 + .35 * (1 - easeOutCubic(progress)), alpha, dy: 0, seconds: step }
      : { scale: .72 + .28 * easeOutBack(progress), alpha, dy: lift * (1 - easeOutCubic(progress)), seconds: step });
  }
  const steady = visibleSeconds - (usableEntry + usableExit) * step;
  if (steady > 1e-4) frames.push({ scale: 1, alpha: 1, dy: 0, seconds: steady });
  for (let index = usableExit - 1; index >= 0; index -= 1) {
    const remaining = (index + .5) * step;
    const fade = clamp(remaining / .06);
    frames.push({ scale: .97 + .03 * fade, alpha: fade, dy: 0, seconds: step });
  }
  // Ajuste fino para que la suma coincida exactamente con el tiempo visible.
  const sum = frames.reduce((total, frame) => total + frame.seconds, 0);
  if (frames.length) frames[frames.length - 1].seconds = Math.max(1e-3, frames[frames.length - 1].seconds + visibleSeconds - sum);
  return frames;
}

export type KineticLayer = {
  /** Archivo ffconcat para usar con `-f concat -safe 0 -i`. */
  listFile: string;
  bandY: number;
  bandHeight: number;
  frameWidth: number;
  words: number;
  frameFiles: number;
};

export type KineticLayerOptions = {
  /** Carpeta temporal donde se escriben los fotogramas (se borra con el render). */
  directory: string;
  fontDir: string;
  durationSeconds: number;
  frameWidth?: number;
  frameHeight?: number;
  zone?: KineticZone;
  sizeScale?: number;
  fps?: number;
};

async function composeFrame(sprite: WordSprite, frame: WordFrame, canvas: { width: number; height: number }, centerX: number) {
  const width = Math.max(1, Math.round(sprite.width * frame.scale));
  const height = Math.max(1, Math.round(sprite.height * frame.scale));
  let layer = sharp(sprite.data, { raw: { width: sprite.width, height: sprite.height, channels: 4 } });
  if (width !== sprite.width || height !== sprite.height) layer = layer.resize(width, height, { kernel: "lanczos3" });
  if (frame.alpha < .999) layer = layer.linear([1, 1, 1, frame.alpha], [0, 0, 0, 0]);
  const input = await layer.png().toBuffer();
  const left = Math.round(centerX - width / 2);
  const top = Math.round(canvas.height / 2 - height / 2 + frame.dy);
  // Recorta lo que quede fuera del lienzo (nunca debería pasar con el ancho máximo del 80 %).
  const visibleLeft = Math.max(0, left);
  const visibleTop = Math.max(0, top);
  const visibleWidth = Math.min(canvas.width, left + width) - visibleLeft;
  const visibleHeight = Math.min(canvas.height, top + height) - visibleTop;
  const blank = sharp({ create: { width: canvas.width, height: canvas.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  if (visibleWidth <= 0 || visibleHeight <= 0) return blank.png({ compressionLevel: 1 }).toBuffer();
  const piece = left === visibleLeft && top === visibleTop && visibleWidth === width && visibleHeight === height
    ? input
    : await sharp(input).extract({ left: visibleLeft - left, top: visibleTop - top, width: visibleWidth, height: visibleHeight }).png().toBuffer();
  return blank.composite([{ input: piece, left: visibleLeft, top: visibleTop }]).png({ compressionLevel: 1 }).toBuffer();
}

const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;

/**
 * Escribe los fotogramas de todas las palabras de una toma y la lista ffconcat
 * con sus duraciones. La capa es una franja de ancho completo centrada en la zona elegida.
 */
export async function buildKineticLayer(words: KineticWord[], options: KineticLayerOptions): Promise<KineticLayer | null> {
  const frameWidth = options.frameWidth ?? 1080;
  const frameHeight = options.frameHeight ?? 1920;
  const fps = options.fps ?? KINETIC_FPS;
  const duration = Math.max(0, options.durationSeconds);
  const visible = words.filter((word) => word.startSeconds < duration && word.endSeconds > word.startSeconds);
  if (!visible.length || duration <= 0) return null;
  await mkdir(options.directory, { recursive: true });
  const sprites = new Map<string, WordSprite>();
  const plans: Array<{ word: KineticWord; sprite: WordSprite; start: number; end: number; frames: WordFrame[] }> = [];
  for (const word of visible) {
    const key = `${word.style}\u0000${word.text}`;
    let sprite = sprites.get(key);
    if (!sprite) {
      sprite = await renderWordSprite(word.text, word.style, { fontDir: options.fontDir, frameWidth, sizeScale: options.sizeScale });
      sprites.set(key, sprite);
    }
    const start = Math.max(0, word.startSeconds);
    const end = Math.min(duration, word.endSeconds);
    plans.push({ word, sprite, start, end, frames: wordFrames(word.style, end - start, { frameWidth, fps }) });
  }
  // Franja común a todas las palabras: cabe la palabra más grande en su mayor escala.
  const needed = Math.max(...plans.flatMap((plan) => plan.frames.map((frame) => plan.sprite.height * frame.scale + 2 * Math.abs(frame.dy))));
  const bandHeight = Math.min(frameHeight, Math.ceil(needed / 2) * 2 + 8);
  const centerY = frameHeight * KINETIC_ZONES[options.zone ?? "chest"];
  const bandY = Math.round(Math.max(0, Math.min(frameHeight - bandHeight, centerY - bandHeight / 2)));
  const canvas = { width: frameWidth, height: bandHeight };
  const centerX = frameWidth * CENTER_X;
  const blankPath = join(options.directory, "blank.png");
  await writeFile(blankPath, await sharp({ create: { width: canvas.width, height: canvas.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
  const entries: Array<{ path: string; seconds: number }> = [];
  // The same word in the same style yields identical frames: write each distinct image once.
  const files = new Map<string, Promise<string>>();
  const frameFile = (plan: (typeof plans)[number], frame: WordFrame) => {
    const key = `${plan.word.style}\u0000${plan.word.text}\u0000${frame.scale.toFixed(4)}\u0000${frame.alpha.toFixed(4)}\u0000${frame.dy.toFixed(2)}`;
    let file = files.get(key);
    if (!file) {
      const path = join(options.directory, `f${files.size}.png`);
      file = composeFrame(plan.sprite, frame, canvas, centerX).then((bytes) => writeFile(path, bytes)).then(() => path);
      files.set(key, file);
    }
    return file;
  };
  let cursor = 0;
  for (const plan of plans) {
    const start = Math.max(cursor, plan.start);
    if (start - cursor > 1e-4) entries.push({ path: blankPath, seconds: start - cursor });
    const frames = start > plan.start ? wordFrames(plan.word.style, plan.end - start, { frameWidth, fps }) : plan.frames;
    // Frames of one word are encoded in parallel (sharp uses its own thread pool).
    const paths = await Promise.all(frames.map((frame) => frameFile(plan, frame)));
    frames.forEach((frame, index) => entries.push({ path: paths[index], seconds: frame.seconds }));
    cursor = Math.max(start, plan.end);
  }
  const frameFiles = files.size + 1;
  if (duration - cursor > 1e-4) entries.push({ path: blankPath, seconds: duration - cursor });
  const lines = ["ffconcat version 1.0"];
  for (const entry of entries) lines.push(`file ${quote(entry.path)}`, `duration ${entry.seconds.toFixed(6)}`);
  // El demuxer concat ignora la duración de la última entrada si no se repite el archivo.
  lines.push(`file ${quote(entries[entries.length - 1].path)}`);
  const listFile = join(options.directory, "layer.ffconcat");
  await writeFile(listFile, `${lines.join("\n")}\n`);
  return { listFile, bandY, bandHeight, frameWidth, words: plans.length, frameFiles };
}

/** Filtro que monta la capa sobre el video base (entrada `inputIndex` = la lista concat). */
export function kineticOverlayFilter(input: { videoLabel: string; inputIndex: number; layer: KineticLayer; outputLabel: string }) {
  return `[${input.inputIndex}:v]format=rgba[kinetic_layer];[${input.videoLabel}][kinetic_layer]overlay=x=0:y=${input.layer.bandY}:eof_action=pass:format=auto[${input.outputLabel}]`;
}

/** Argumentos de entrada de FFmpeg para la capa. */
export function kineticInputArgs(layer: KineticLayer) {
  return ["-f", "concat", "-safe", "0", "-i", layer.listFile];
}
