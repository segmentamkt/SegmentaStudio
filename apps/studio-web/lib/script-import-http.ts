import { ScriptImportError } from "./script-import-persistence";

// Leave multipart overhead below Vercel's 4.5 MB request limit.
export const SCRIPT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const SCRIPT_JSON_MAX_BYTES = 128 * 1024;

export async function readScriptRequestBody(request: Request, maxBytes: number): Promise<Blob> {
  const advertisedLength = Number(request.headers.get("content-length") || 0);
  if (advertisedLength > maxBytes) throw new ScriptImportError("El archivo es demasiado grande. Usa un libreto de hasta 4 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ScriptImportError("La solicitud está vacía.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ScriptImportError("El archivo es demasiado grande. Usa un libreto de hasta 4 MB.", 413);
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks);
}
