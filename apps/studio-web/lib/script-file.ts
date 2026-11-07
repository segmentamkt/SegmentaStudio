// Server only: uploaded document bytes never leave this process.
import { inflateRawSync } from "node:zlib";
import { zipSync } from "fflate";
import { SCRIPT_IMPORT_LIMITS } from "./script-import";

export class ScriptFileError extends Error {
  constructor(message: string) { super(message); this.name = "ScriptFileError"; }
}

export type ScriptFileInput = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
export type ExtractedScriptFile = { name: string; text: string; warnings: string[] };
const MAX_XML_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 100;

function invalidDocx(): never { throw new ScriptFileError("El Word está dañado o usa un formato no compatible. Vuelve a guardarlo como .docx o .txt."); }

/**
 * Rebuild a text-only DOCX after bounded inflation. ZIP directory sizes alone
 * are untrusted: zlib enforces the real output bound before Mammoth sees it.
 * No archive paths are written to disk, and images/macros are never extracted.
 */
function boundedDocx(buffer: Buffer): Buffer {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) invalidDocx();
  const count = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralStart = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count === 0xffff || centralStart === 0xffffffff || centralStart + centralSize > end || count !== buffer.readUInt16LE(end + 8)) invalidDocx();
  if (!count || count > 2000) throw new ScriptFileError("Este Word contiene demasiados elementos. Exporta solo los libretos como .docx o .txt.");
  const files: Record<string, Uint8Array> = Object.create(null);
  let offset = centralStart;
  let expanded = 0;
  const seen = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) invalidDocx();
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > centralStart + centralSize || flags & 1 || ![0, 8].includes(method) || [size, compressedSize, localOffset].includes(0xffffffff)) invalidDocx();
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (seen.has(name) || name.includes("\0") || name.startsWith("/") || name.split(/[\\/]/).includes("..")) invalidDocx();
    seen.add(name);
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES) throw new ScriptFileError("El Word supera 20 MB al descomprimirse. Elimina las imágenes del documento y vuelve a subir el libreto.");
    offset = next;
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    if (size > MAX_XML_BYTES) throw new ScriptFileError("El texto interno de este Word es demasiado grande. Divide los libretos en varios archivos.");
    if (localOffset + 30 > centralStart || buffer.readUInt32LE(localOffset) !== 0x04034b50) invalidDocx();
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const start = localOffset + 30 + localNameLength + buffer.readUInt16LE(localOffset + 28);
    if (start + compressedSize > centralStart || buffer.readUInt16LE(localOffset + 8) !== method || buffer.readUInt16LE(localOffset + 6) & 1 || buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8") !== name) invalidDocx();
    let data: Buffer;
    try {
      const compressed = buffer.subarray(start, start + compressedSize);
      data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_XML_BYTES, Math.max(1, size)) });
    } catch { throw new ScriptFileError("El Word contiene datos comprimidos inválidos o demasiado grandes. Exporta el libreto como .txt y vuelve a intentarlo."); }
    if (data.length !== size) invalidDocx();
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(data.toString("utf8"))) throw new ScriptFileError("Este Word contiene definiciones XML no admitidas. Vuelve a guardarlo como un documento nuevo.");
    files[name] = data;
  }
  if (offset !== centralStart + centralSize || !files["word/document.xml"]) invalidDocx();
  return Buffer.from(zipSync(files, { level: 0 }));
}

function checkTextSize(text: string) {
  if (text.length > SCRIPT_IMPORT_LIMITS.maxDocumentCharacters) throw new ScriptFileError("El documento tiene demasiado texto. Divídelo en archivos de hasta 20 libretos; no se ha importado ni recortado contenido.");
}

async function pdfText(buffer: Buffer): Promise<{ text: string; warnings: string[] }> {
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new ScriptFileError("El archivo no es un PDF válido. Vuelve a exportar el libreto.");
  // Node's local PDF.js worker is traced with this server-only package in Next.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false,
    useWorkerFetch: false, stopAtErrors: true, verbosity: 0,
  });
  const warnings: string[] = [];
  try {
    const document = await loading.promise;
    if (document.numPages > MAX_PDF_PAGES) throw new ScriptFileError(`El PDF tiene ${document.numPages} páginas. Divide el archivo en documentos de hasta ${MAX_PDF_PAGES} páginas.`);
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      let y: number | undefined;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const nextY = item.transform[5] as number;
        if (y !== undefined && Math.abs(nextY - y) > Math.max(2, item.height * 0.4) && !text.endsWith("\n")) text += "\n";
        else if (text && !/\s$/.test(text) && item.str && !/^\s|^[,.;:!?»)]/.test(item.str)) text += " ";
        text += item.str;
        if (item.hasEOL) text += "\n";
        y = nextY;
      }
      if (!text.trim()) warnings.push(`La página ${number} no tiene texto seleccionable. Si contiene un libreto escaneado, pégalo como texto para incluirlo.`);
      length += text.length;
      if (length > SCRIPT_IMPORT_LIMITS.maxDocumentCharacters) throw new ScriptFileError("El PDF tiene demasiado texto. Divídelo en archivos de hasta 20 libretos; no se ha importado ni recortado contenido.");
      pages.push(text.trim());
      page.cleanup();
    }
    const text = pages.join("\n\n").trim();
    if (!text) throw new ScriptFileError("Este PDF no tiene texto seleccionable; parece escaneado. Exporta el documento original a Word/texto o pega aquí el libreto. Esta importación no hace OCR.");
    warnings.push("Revisa el orden del texto extraído del PDF, especialmente si el documento tiene varias columnas.");
    return { text, warnings };
  } catch (error) {
    if (error instanceof ScriptFileError) throw error;
    if (error instanceof Error && error.name === "PasswordException") throw new ScriptFileError("El PDF está protegido con contraseña. Guarda una copia sin protección para importar el libreto.");
    throw new ScriptFileError("No pudimos leer el texto de este PDF. Vuelve a exportarlo o súbelo como Word o texto.");
  } finally { await loading.destroy(); }
}

export async function extractScriptFile(file: ScriptFileInput): Promise<ExtractedScriptFile> {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (![".txt", ".md", ".docx", ".pdf"].includes(extension || "")) throw new ScriptFileError("Sube un archivo .txt, .md, .docx o un PDF con texto seleccionable.");
  if (!file.size) throw new ScriptFileError("El archivo está vacío. Agrega el libreto y vuelve a subirlo.");
  if (file.size > SCRIPT_IMPORT_LIMITS.maxFileBytes) throw new ScriptFileError("El archivo supera 10 MB. Divide los libretos o elimina las imágenes del documento.");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > SCRIPT_IMPORT_LIMITS.maxFileBytes) throw new ScriptFileError("El archivo supera 10 MB.");
  let text: string;
  let warnings: string[] = [];
  if (extension === ".docx") {
    const safeBuffer = boundedDocx(buffer);
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: safeBuffer });
      text = result.value;
      warnings = result.messages.length ? ["Word contiene elementos de formato que no se importan. Revisa el texto antes de crear las carpetas."] : [];
    } catch (error) {
      if (error instanceof ScriptFileError) throw error;
      throw new ScriptFileError("No pudimos leer este Word. Guárdalo de nuevo como .docx o exporta el libreto a .txt.");
    }
  } else if (extension === ".pdf") ({ text, warnings } = await pdfText(buffer));
  else {
    const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? "utf-16le" : buffer[0] === 0xfe && buffer[1] === 0xff ? "utf-16be" : "utf-8";
    try { text = new TextDecoder(encoding, { fatal: true }).decode(buffer); }
    catch { throw new ScriptFileError("No pudimos leer la codificación del texto. Guarda el archivo como UTF-8 y vuelve a subirlo."); }
    if (/\0/.test(text)) throw new ScriptFileError("El archivo contiene datos binarios. Guarda el libreto como texto UTF-8, Word o PDF.");
  }
  checkTextSize(text);
  if (!text.trim()) throw new ScriptFileError("El documento no contiene texto para grabar. Agrega el libreto y vuelve a subirlo.");
  return { name: file.name, text, warnings };
}
