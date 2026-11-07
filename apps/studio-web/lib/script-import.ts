/** Shared, deterministic script importer. It does not call an AI or discard dialogue. */
export const SCRIPT_IMPORT_LIMITS = {
  maxProjects: 20,
  maxScenes: 12,
  maxSceneCharacters: 1000,
  maxScriptCharacters: 6000,
  maxFileBytes: 10 * 1024 * 1024,
  maxDocumentCharacters: 250_000,
} as const;

export type ScriptImportScene = { id: string; title: string; script: string };
export type ScriptImportProject = {
  id: string;
  title: string;
  script: string;
  scenes: ScriptImportScene[];
  sourceName?: string;
  /** Production directions are kept separate from words to read on camera. */
  notes?: string;
};
export type ScriptImportResult = { projects: ScriptImportProject[]; warnings: string[]; errors: string[] };

/** Keep production directions in the project reference, never in scene dialogue. */
export function scriptWithProductionNotes(project: { script: string; notes?: string }): string {
  const script = project.script.trim();
  const notes = project.notes?.trim();
  return notes ? `${script}\n\nIndicaciones de producción\n${notes}` : script;
}

const sceneNames: Record<string, string> = {
  hook: "Gancho", gancho: "Gancho", dolor: "Problema", problema: "Problema",
  valor: "Valor", desarrollo: "Desarrollo", solucion: "Solución", cta: "Cierre / CTA",
  cierre: "Cierre", "llamada a la accion": "Cierre / CTA", introduccion: "Introducción",
};
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const unformat = (line: string) => line.trim().replace(/^#{1,6}\s+/, "").replace(/\*\*|__/g, "").trim();
const isNumberedProject = (line: string) => /^(?:E\s*\d{1,3}|(?:VIDEO|GUION|GUIÓN|LIBRETO|EPISODIO)\s*#?\s*\d{1,3})(?:\s|[:.)–—-]|$)/i.test(line);

function sceneHeading(raw: string): { title: string; inline: string } | null {
  const line = unformat(raw);
  const numbered = line.match(/^(?:escena|toma|plano)\s*(\d{1,3})(?:\s*[:.)–—-]\s*(.*))?$/i);
  if (numbered) {
    // A colon introduces spoken content; a dash introduces a scene name.
    const isDialogue = /\d\s*:/.test(line) && !/^\s*#/.test(raw);
    return { title: isDialogue ? `Escena ${numbered[1]}` : line, inline: isDialogue ? numbered[2] || "" : "" };
  }
  const labeled = line.match(/^(HOOK|GANCHO|DOLOR|PROBLEMA|VALOR|DESARROLLO|SOLUCI[ÓO]N|CTA|CIERRE|INTRODUCCI[ÓO]N|LLAMADA A LA ACCI[ÓO]N)(?:\s*[:–—-]\s*|\s+|$)(.*)$/i);
  if (!labeled) return null;
  // Do not treat an ordinary sentence such as "Valor para tu equipo" as a heading.
  if (labeled[2] && labeled[1] !== labeled[1].toUpperCase() && !/^\s*#/.test(raw) && !/^\*\*/.test(raw.trim()) && !/^\w+\s*[:–—-]/.test(line)) return null;
  return { title: sceneNames[fold(labeled[1])] || labeled[1], inline: labeled[2].trim() };
}

function projectHeading(raw: string): string | null {
  const line = unformat(raw);
  if (!line || sceneHeading(raw)) return null;
  if (isNumberedProject(line)) return line;
  // H1 separates projects. H2–H6 remain inside a script unless explicitly numbered.
  return /^#\s+/.test(raw.trim()) ? line : null;
}

function isProductionNote(raw: string): boolean {
  const line = fold(unformat(raw));
  return /^(?:duracion(?: objetivo)?|objetivo|tono|formato|categoria|tema|audiencia|publico|personaje|locacion|ubicacion|musica|sfx|sonido|visual|recurso|apoyo|indicacion(?:es)?|nota(?:s)?|b-?roll)\s*[:–—-]/.test(line)
    || /\bduracion\s+(?:objetivo\s+)?\d+/.test(line)
    || /^\[(?:visual|musica|sfx|sonido|plano|apoyo|indicacion|b-?roll)\b/.test(line);
}

function isCategoryLine(raw: string): boolean {
  const line = unformat(raw);
  return line.length <= 200 && line === line.toUpperCase() && /[A-ZÁÉÍÓÚÜÑ]/.test(line)
    && /\s[/·|]\s/.test(line) && !/[«»"“”!?¿¡]/.test(line);
}

/** Split overlong paragraphs at sentence/word boundaries, retaining every word. */
function splitForCamera(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > SCRIPT_IMPORT_LIMITS.maxSceneCharacters) {
    const candidate = rest.slice(0, SCRIPT_IMPORT_LIMITS.maxSceneCharacters + 1);
    const sentenceEnds = [...candidate.matchAll(/[.!?…][»”"']?\s+|\n+/g)];
    let cut = sentenceEnds.length ? sentenceEnds[sentenceEnds.length - 1].index! + sentenceEnds[sentenceEnds.length - 1][0].length : -1;
    if (cut < SCRIPT_IMPORT_LIMITS.maxSceneCharacters / 3 || cut > SCRIPT_IMPORT_LIMITS.maxSceneCharacters) cut = candidate.lastIndexOf(" ", SCRIPT_IMPORT_LIMITS.maxSceneCharacters);
    if (cut <= 0) break; // An unbroken token stays editable and fails validation, never truncates.
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function validateScriptImportProjects(projects: ScriptImportProject[]): string[] {
  const errors: string[] = [];
  if (!projects.length) errors.push("No encontramos un libreto con texto. Agrega al menos una escena para grabar.");
  if (projects.length > SCRIPT_IMPORT_LIMITS.maxProjects) errors.push(`El archivo contiene ${projects.length} libretos. Importa como máximo ${SCRIPT_IMPORT_LIMITS.maxProjects} a la vez; no se ha eliminado ninguno del borrador.`);
  for (const [index, project] of projects.entries()) {
    const label = project.title?.trim() || `Libreto ${index + 1}`;
    if (!project.title?.trim()) errors.push(`Libreto ${index + 1}: escribe un título.`);
    if ((project.title || "").length > 160) errors.push(`${label}: el título admite hasta 160 caracteres.`);
    if (!project.scenes.length) errors.push(`${label}: agrega al menos una escena con texto.`);
    if (project.scenes.length > SCRIPT_IMPORT_LIMITS.maxScenes) errors.push(`${label}: hay ${project.scenes.length} escenas; divide el libreto en carpetas de hasta ${SCRIPT_IMPORT_LIMITS.maxScenes} escenas.`);
    const fullScript = project.scenes.map((scene) => scene.script.trim()).join("\n\n");
    if (Math.max(fullScript.length, scriptWithProductionNotes(project).length) > SCRIPT_IMPORT_LIMITS.maxScriptCharacters) errors.push(`${label}: el libreto y sus notas superan ${SCRIPT_IMPORT_LIMITS.maxScriptCharacters} caracteres. Divide su contenido en dos carpetas.`);
    for (const [sceneIndex, scene] of project.scenes.entries()) {
      if (!scene.title.trim()) errors.push(`${label}, escena ${sceneIndex + 1}: escribe un título.`);
      if (scene.title.length > 80) errors.push(`${label}, escena ${sceneIndex + 1}: el título admite hasta 80 caracteres.`);
      if (!scene.script.trim()) errors.push(`${label}, escena ${sceneIndex + 1}: agrega el texto que vas a grabar o elimina la escena vacía.`);
      if (scene.script.length > SCRIPT_IMPORT_LIMITS.maxSceneCharacters) errors.push(`${label}, escena ${sceneIndex + 1}: divide el texto en bloques de hasta ${SCRIPT_IMPORT_LIMITS.maxSceneCharacters} caracteres.`);
    }
  }
  return errors;
}

/** Recognizes numbered scripts and scene labels; all remaining content stays editable. */
export function parseScriptDocument(text: string, filename = "Libreto.txt"): ScriptImportResult {
  const warnings: string[] = [];
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
  if (!normalized) return { projects: [], warnings, errors: ["El archivo no contiene texto para grabar."] };
  if (normalized.length > SCRIPT_IMPORT_LIMITS.maxDocumentCharacters) return { projects: [], warnings, errors: ["El documento es demasiado extenso. Divídelo en archivos de hasta 20 libretos y vuelve a subirlos. No se ha importado ni recortado contenido."] };
  const fallback = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Mi libreto";
  const groups: Array<{ title: string; lines: string[] }> = [];
  const preface: string[] = [];
  let current: { title: string; lines: string[] } | undefined;
  for (const raw of normalized.split("\n")) {
    const heading = projectHeading(raw);
    if (heading) {
      if (current) {
        // A document heading followed only by directions may wrap E01/E02.
        const wrapper = !isNumberedProject(current.title) && isNumberedProject(heading)
          && current.lines.every((line) => !line.trim() || isProductionNote(line));
        if (wrapper) preface.push(current.title, ...current.lines);
        else groups.push(current);
      }
      current = { title: heading, lines: [] };
    } else if (current) current.lines.push(raw);
    else preface.push(raw);
  }
  if (current) groups.push(current);
  if (!groups.length) groups.push({ title: fallback, lines: preface.splice(0) });

  const projects = groups.map((group, projectIndex): ScriptImportProject => {
    const notes: string[] = projectIndex === 0 ? [...preface] : [];
    const sections: Array<{ title: string; lines: string[] }> = [];
    const explicit = group.lines.some((line) => sceneHeading(line));
    let section: { title: string; lines: string[] } | undefined;
    const finish = () => { if (section) { sections.push(section); section = undefined; } };
    for (const raw of group.lines) {
      const heading = sceneHeading(raw);
      if (heading) {
        finish();
        section = { title: heading.title, lines: heading.inline ? [heading.inline] : [] };
      } else if (isProductionNote(raw) || (explicit && !section && !sections.length && isCategoryLine(raw))) notes.push(unformat(raw));
      else if (!raw.trim() && !explicit) finish();
      else if (raw.trim()) {
        section ||= { title: explicit ? "Introducción" : `Escena ${sections.length + 1}`, lines: [] };
        section.lines.push(unformat(raw));
      }
    }
    finish();
    const scenes: ScriptImportScene[] = [];
    for (const section of sections) {
      const spoken = section.lines.join("\n").trim();
      const parts = splitForCamera(spoken);
      if (parts.length > 1) warnings.push(`${group.title}: «${section.title}» se dividió en ${parts.length} tomas para facilitar la grabación. Se conservó todo el texto.`);
      // Keep an explicit empty section visible for correction, rather than silently dropping it.
      for (const [partIndex, script] of (parts.length ? parts : [""]).entries()) scenes.push({
        id: `script-${projectIndex + 1}-scene-${scenes.length + 1}`,
        title: parts.length > 1 ? `${section.title} · ${partIndex + 1}` : section.title,
        script,
      });
    }
    if (!explicit) warnings.push(`${group.title}: las escenas se organizaron por párrafos. Puedes ajustar sus nombres y orden antes de crear las carpetas.`);
    if (notes.some((note) => note.trim())) warnings.push(`${group.title}: las indicaciones de producción se conservaron en Notas, fuera del texto de cámara.`);
    return {
      id: `script-${projectIndex + 1}`, title: group.title,
      script: scenes.map((scene) => scene.script).join("\n\n"), scenes,
      sourceName: filename,
      ...(notes.some((note) => note.trim()) ? { notes: notes.join("\n").trim() } : {}),
    };
  });
  return { projects, warnings, errors: validateScriptImportProjects(projects) };
}
