import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseScriptDocument, SCRIPT_IMPORT_LIMITS, scriptWithProductionNotes, validateScriptImportProjects } from "../lib/script-import";
import { extractScriptFile } from "../lib/script-file";

const sample = `**E01 ¿Le tocó organizar la despedida?**
**HUMOR COTIDIANO / RESPONSABILIDAD · DURACIÓN OBJETIVO 30–35 s**
**HOOK** Don Óscar: «¿A usted también le tocó organizar la despedida de fin de año de la empresa? ¡Uy, lo pusieron a trabajar doble!»
**DOLOR** Don Óscar: «Que buscar el sitio, organizar a los compañeros, cuadrar el presupuesto… ¡y todavía falta lo más importante: la comida!»
**VALOR** Don Óscar: «¡Pero fresco, que de eso nos encargamos nosotros! En El Lechón del Tolima preparamos esta deliciosa lechona tradicional, perfecta para compartir con todo su equipo de trabajo.»
**CTA** Don Óscar: «Así que no se complique. Escríbanos por WhatsApp, díganos cuántas personas son y la fecha del evento, y le ayudamos con su cotización. ¡Que esa despedida quede para recordar!»`;

function file(name: string, data: string | Uint8Array) {
  const bytes = typeof data === "string" ? Buffer.from(data) : data;
  return { name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}

function docx(text: string) {
  const paragraphs = text.split("\n").map((line) => `<w:p><w:r><w:t>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</w:t></w:r></w:p>`).join("");
  return zipSync({ "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`) });
}

/** Small real PDF fixture generated locally, with a correct xref table. */
function pdf(lines: string[]) {
  const stream = lines.map((line, index) => `BT /F1 12 Tf 40 ${760 - index * 24} Td (${line.replace(/[\\()]/g, "\\$&")}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}

test("E01 sample creates the four spoken scenes, keeping directions separately", () => {
  const result = parseScriptDocument(sample, "Lechona.md");
  assert.deepEqual(result.errors, []);
  assert.equal(result.projects.length, 1);
  const project = result.projects[0];
  assert.equal(project.title, "E01 ¿Le tocó organizar la despedida?");
  assert.deepEqual(project.scenes.map((scene) => scene.title), ["Gancho", "Problema", "Valor", "Cierre / CTA"]);
  assert.match(project.scenes[2].script, /El Lechón del Tolima/);
  assert.match(project.scenes[3].script, /¡Que esa despedida quede para recordar!/);
  assert.match(project.notes || "", /DURACIÓN OBJETIVO/);
  assert.doesNotMatch(project.script, /HUMOR COTIDIANO|DURACIÓN/);
  assert.equal(project.sourceName, "Lechona.md");
});

test("multiple numbered scripts and Markdown scene headers remain ordered", () => {
  const input = "# Campaña de noviembre\n\nNotas: vestuario rojo\n\n## VIDEO 1: Invitación\n### ESCENA 1 — Apertura\nHola, equipo.\n### ESCENA 2 — Cierre\nLos esperamos.\n\nGUIÓN 2 · Recordatorio\nHOOK: Mañana nos vemos.\nCTA: Escríbenos.";
  const result = parseScriptDocument(input, "Campaña.md");
  assert.equal(result.projects.length, 2);
  assert.equal(result.projects[0].scenes.length, 2);
  assert.equal(result.projects[0].scenes[0].script, "Hola, equipo.");
  assert.equal(result.projects[1].scenes[1].script, "Escríbenos.");
  assert.deepEqual(result.errors, []);
});

test("production metadata on separate lines stays out of the teleprompter", () => {
  const result = parseScriptDocument("E01 Cena\nHUMOR COTIDIANO / RESPONSABILIDAD\nDuración objetivo: 30–35 s\nLocación: restaurante\nHOOK: Bienvenidos.\nVisual: mostrar el plato\nCTA: Escríbenos.", "libreto.txt");
  const project = result.projects[0];
  assert.equal(project.scenes.length, 2);
  assert.equal(project.script, "Bienvenidos.\n\nEscríbenos.");
  assert.match(project.notes || "", /HUMOR COTIDIANO/);
  assert.match(project.notes || "", /mostrar el plato/);
  assert.match(project.notes || "", /restaurante/);
  assert.match(scriptWithProductionNotes(project), /Indicaciones de producción\nHUMOR COTIDIANO/);
  assert.ok(validateScriptImportProjects([{ ...project, notes: "a".repeat(6000) }]).some((error) => error.includes("6000")));
});

test("H1 sections are independent scripts and H2 prose is preserved", () => {
  const result = parseScriptDocument("# Primera receta\n## Ingredientes\nMezcla todo.\n# Segunda receta\nSirve caliente.", "recetas.md");
  assert.equal(result.projects.length, 2);
  assert.match(result.projects[0].script, /Ingredientes\nMezcla todo/);
});

test("plain text is split by paragraphs without losing words or inventing lines", () => {
  const result = parseScriptDocument("\uFEFFValor para tu equipo.\r\n\r\nUna segunda idea.\r\nContinúa aquí.", "mis_libretos.txt");
  assert.equal(result.projects[0].title, "mis libretos");
  assert.deepEqual(result.projects[0].scenes.map((scene) => scene.script), ["Valor para tu equipo.", "Una segunda idea.\nContinúa aquí."]);
  assert.equal(result.errors.length, 0);
});

test("long scenes split on words, keep all content, and flag limits instead of truncating", () => {
  const spoken = Array.from({ length: 370 }, (_, index) => `palabra${index}`).join(" ");
  const result = parseScriptDocument(`E01 Largo\nHOOK: ${spoken}`, "largo.txt");
  const scenes = result.projects[0].scenes;
  assert.ok(scenes.length > 1);
  assert.ok(scenes.every((scene) => scene.script.length <= SCRIPT_IMPORT_LIMITS.maxSceneCharacters));
  assert.equal(scenes.map((scene) => scene.script).join(" "), spoken);
  assert.equal(result.errors.length, 0);
  const enormous = parseScriptDocument(`HOOK: ${"imposible ".repeat(800)}`, "enorme.txt");
  assert.ok(enormous.errors.some((error) => error.includes("6000")));
  assert.equal(enormous.projects[0].scenes.map((scene) => scene.script).join(" "), "imposible ".repeat(800).trim());
});

test("all 21 projects remain in the draft and cannot be created until corrected", () => {
  const result = parseScriptDocument(Array.from({ length: 21 }, (_, index) => `E${index + 1} Prueba\nHOOK: Texto ${index + 1}`).join("\n"), "lote.txt");
  assert.equal(result.projects.length, 21);
  assert.ok(result.errors.some((error) => error.includes("máximo 20")));
  assert.match(result.projects.at(-1)!.script, /Texto 21/);
});

test("empty explicit sections are shown for correction; no fake script is generated", () => {
  const result = parseScriptDocument("E01 Solo título\nHOOK:\nCTA: Escríbenos.", "incompleto.txt");
  assert.equal(result.projects[0].scenes[0].script, "");
  assert.ok(result.errors.some((error) => error.includes("escena 1")));
  assert.ok(validateScriptImportProjects([]).length);
  assert.equal(parseScriptDocument(" \n ", "vacio.txt").projects.length, 0);
});

test("UTF-8 and UTF-16 text files retain accents and reject binary data", async () => {
  assert.equal((await extractScriptFile(file("guion.txt", "Señor Óscar"))).text, "Señor Óscar");
  assert.equal((await extractScriptFile(file("guion.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Señor Óscar", "utf16le")])))).text, "Señor Óscar");
  await assert.rejects(extractScriptFile(file("guion.txt", "hola\0mundo")), /datos binarios/);
  await assert.rejects(extractScriptFile(file("guion.exe", "texto")), /\.txt/);
  await assert.rejects(extractScriptFile({ name: "libreto.txt", size: 11 * 1024 * 1024, arrayBuffer: async () => { throw new Error("must not read oversized input"); } }), /10 MB/);
});

test("Word text is extracted locally with paragraph and dialogue order preserved", async () => {
  const extracted = await extractScriptFile(file("lechona.docx", docx(sample)));
  const result = parseScriptDocument(extracted.text, extracted.name);
  assert.equal(result.projects[0].scenes.length, 4);
  assert.match(result.projects[0].scenes[2].script, /El Lechón del Tolima/);
  assert.deepEqual(result.errors, []);
});

test("DOCX rejects oversized declared entries and forged compressed expansion", async () => {
  const oversized = Buffer.from(docx("E01 hola"));
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversized.writeUInt32LE(25 * 1024 * 1024, central + 24);
  await assert.rejects(extractScriptFile(file("peligro.docx", oversized)), /20 MB/);
  const forged = Buffer.from(docx("hola ".repeat(10000)));
  const entry = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  forged.writeUInt32LE(1, entry + 24);
  await assert.rejects(extractScriptFile(file("peligro.docx", forged)), /comprimidos inválidos/);
});

test("PDF selectable text becomes ordered scenes and scanned PDFs fail clearly", async () => {
  const extracted = await extractScriptFile(file("libreto.pdf", pdf(["E01 Dinner", "HOOK: Welcome to dinner.", "CTA: Call us today."])));
  const result = parseScriptDocument(extracted.text, extracted.name);
  assert.equal(result.projects[0].scenes.length, 2);
  assert.equal(result.projects[0].scenes[0].script, "Welcome to dinner.");
  assert.match(extracted.warnings.join(" "), /columnas/);
  await assert.rejects(extractScriptFile(file("escaneado.pdf", pdf([]))), /no tiene texto seleccionable/);
});
