import { getRequestUser, unauthorized } from "../../../../lib/request-user";
import { extractScriptFile, ScriptFileError } from "../../../../lib/script-file";
import { parseScriptDocument } from "../../../../lib/script-import";
import { readScriptRequestBody, SCRIPT_UPLOAD_MAX_BYTES } from "../../../../lib/script-import-http";
import { ScriptImportError } from "../../../../lib/script-import-persistence";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) throw new ScriptImportError("Selecciona un archivo de libretos.", 415);
    const body = await readScriptRequestBody(request, SCRIPT_UPLOAD_MAX_BYTES + 64 * 1024);
    let form: FormData;
    try { form = await new Response(body, { headers: { "content-type": contentType } }).formData(); }
    catch { throw new ScriptImportError("No se pudo leer el archivo enviado. Selecciónalo de nuevo."); }
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ScriptImportError("Selecciona un archivo que tenga texto.");
    if (file.size > SCRIPT_UPLOAD_MAX_BYTES) throw new ScriptImportError("El archivo supera 4 MB. Exporta una versión solo con texto para importarlo.", 413);
    if (form.getAll("file").length !== 1) throw new ScriptImportError("Importa un archivo de libretos a la vez.");
    const extracted = await extractScriptFile(file);
    const draft = parseScriptDocument(extracted.text, extracted.name);
    return Response.json({ ...draft, warnings: [...extracted.warnings, ...draft.warnings] });
  } catch (error) {
    if (error instanceof ScriptImportError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ScriptFileError) return Response.json({ error: error.message }, { status: 422 });
    console.error("Script extraction failed", error instanceof Error ? error.name : "unknown_error");
    return Response.json({ error: "No se pudo leer el libreto. Prueba con un archivo TXT, MD, DOCX o un PDF con texto seleccionable." }, { status: 422 });
  }
}
