import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { BUILTIN_VISUAL_RESOURCE_IDS, VISUAL_RESOURCE_LAYOUTS, type VisualResource } from "./visual-resources";

const MAX_UPLOAD_BYTES = 200 * 1024;
const MAX_BUILTIN_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 4_000_000;
const allowedMimeFormats = { png: "png", jpeg: "jpeg", webp: "webp" } as const;

/** Raster inputs only: never fetch a URL, interpret SVG, or trust a client file path. */
export async function renderVisualResourceImage(resource: VisualResource, builtinDirectory = join(process.cwd(), "public", "visual-resources")): Promise<Buffer> {
  if (!Object.hasOwn(VISUAL_RESOURCE_LAYOUTS, resource.layout)) throw new Error("La posición del recurso no es válida.");
  let bytes: Buffer;
  let expectedFormat: string;
  if (resource.image.kind === "builtin") {
    if (!(BUILTIN_VISUAL_RESOURCE_IDS as readonly string[]).includes(resource.image.assetId)) throw new Error("El recurso visual no existe en la biblioteca.");
    const path = join(builtinDirectory, `${resource.image.assetId}.png`);
    let size: number;
    try { size = (await stat(path)).size; } catch { throw new Error("La imagen de la biblioteca no está disponible. Vuelve a intentarlo o elige otra imagen."); }
    if (size > MAX_BUILTIN_BYTES) throw new Error("La imagen de la biblioteca supera el tamaño permitido.");
    try { bytes = await readFile(path); } catch { throw new Error("No se pudo abrir la imagen de la biblioteca."); }
    expectedFormat = "png";
  } else if (resource.image.kind === "upload") {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(resource.image.dataUrl);
    if (!match || match[2].length % 4 || match[2].length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) throw new Error("La imagen debe ser PNG, JPEG o WebP de hasta 200 KB.");
    bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error("La imagen supera el tamaño permitido.");
    expectedFormat = allowedMimeFormats[match[1] as keyof typeof allowedMimeFormats];
  } else throw new Error("El origen de la imagen no es válido.");

  const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", animated: false });
  const metadata = await image.metadata();
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) {
    throw new Error("El archivo no es una imagen estática compatible.");
  }
  const { width, height } = VISUAL_RESOURCE_LAYOUTS[resource.layout];
  const inset = 3;
  const radius = 24;
  const inner = await image.rotate().resize(width - inset * 2, height - inset * 2, { fit: "cover", position: "centre" })
    .flatten({ background: "#151225" }).ensureAlpha().png().toBuffer();
  // The only SVG we rasterize is this fixed geometry, without user markup or URLs.
  const mask = Buffer.from(`<svg width="${width - inset * 2}" height="${height - inset * 2}"><rect width="100%" height="100%" rx="${radius - inset}" fill="#fff"/></svg>`);
  const rounded = await sharp(inner).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const border = Buffer.from(`<svg width="${width}" height="${height}"><rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="${radius}" fill="#151225" stroke="#D8CFFF" stroke-opacity=".8" stroke-width="3"/></svg>`);
  return sharp(border).composite([{ input: rounded, left: inset, top: inset }]).png().toBuffer();
}
