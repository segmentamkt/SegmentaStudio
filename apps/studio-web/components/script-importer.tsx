"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Check, FileText, FolderOpen, LoaderCircle, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { validateScriptImportProjects, type ScriptImportProject, type ScriptImportResult } from "../lib/script-import";

type CreatedFolder = { projectId: string; sessionId: string; title: string };
type Props = { open: boolean; portfolioId: string; portfolioName: string; onClose: () => void; onCreated: () => Promise<void>; onOpen: (sessionId: string) => void };

async function request<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "No se pudo procesar el archivo. Inténtalo otra vez.");
  return body as T;
}

export function ScriptImporter({ open, portfolioId, portfolioName, onClose, onCreated, onOpen }: Props) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importIdRef = useRef("");
  const busyRef = useRef(false);
  const [projects, setProjects] = useState<ScriptImportProject[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [created, setCreated] = useState<CreatedFolder[]>([]);
  const [attemptedIds, setAttemptedIds] = useState<string[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [synced, setSynced] = useState(false);
  const activeProject = projects.find((item) => item.id === activeProjectId) || projects[0];
  const complete = Boolean(projects.length && created.length === projects.length);
  const errors = projects.length ? validateScriptImportProjects(projects.filter((item) => !created.some((folder) => folder.projectId === item.id))) : [];
  const locked = busy || attemptedIds.includes(activeProject?.id || "");

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { previous?.focus(); };
  }, [open]);

  const readFile = async (file?: File) => {
    if (!file || busyRef.current || attemptedIds.length) return;
    if (!/\.(txt|md|docx|pdf)$/i.test(file.name)) return setError("Selecciona un archivo Word (.docx), PDF con texto, .txt o .md.");
    if (file.size > 4 * 1024 * 1024) return setError("El archivo admite hasta 4 MB. Guarda una copia sin imágenes o expórtalo como texto.");
    busyRef.current = true; setBusy(true); setError(""); setProgress("Leyendo y separando los libretos…");
    try {
      const form = new FormData(); form.set("file", file);
      const result = await request<ScriptImportResult>("/api/scripts/import", { method: "POST", body: form });
      importIdRef.current = crypto.randomUUID();
      setProjects(result.projects); setWarnings(result.warnings); setCreated([]); setAttemptedIds([]); setSynced(false);
      setActiveProjectId(result.projects[0]?.id || ""); setSourceName(file.name);
      if (!result.projects.length) setError(result.errors?.[0] || "No encontramos texto en este archivo.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo leer el archivo."); }
    finally { busyRef.current = false; setBusy(false); setProgress(""); }
  };

  const editProject = (update: (project: ScriptImportProject) => ScriptImportProject) => {
    if (!activeProject || locked) return;
    setProjects((items) => items.map((item) => {
      if (item.id !== activeProject.id) return item;
      const next = update(item);
      return { ...next, script: next.scenes.map((scene) => scene.script.trim()).join("\n\n") };
    }));
  };

  const createFolders = async () => {
    if (busyRef.current || !projects.length || errors.length || complete) return;
    busyRef.current = true; setBusy(true); setError("");
    const finished = [...created];
    try {
      for (const project of projects) {
        if (finished.some((folder) => folder.projectId === project.id)) continue;
        setAttemptedIds((ids) => ids.includes(project.id) ? ids : [...ids, project.id]);
        setProgress(`Creando carpeta ${finished.length + 1} de ${projects.length}: ${project.title}`);
        const result = await request<{ session: { id: string } }>("/api/scripts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId, importId: importIdRef.current, project }),
        });
        finished.push({ projectId: project.id, sessionId: result.session.id, title: project.title });
        setCreated([...finished]);
      }
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : "Se interrumpió la creación."} Puedes reintentar aquí; las carpetas ya creadas se conservan sin duplicarlas.`);
    } finally {
      if (finished.length) {
        try { await onCreated(); setSynced(true); }
        catch { setError("Las carpetas se guardaron, pero no pudimos actualizar el estudio. Vuelve a abrirlo para verlas."); }
      }
      busyRef.current = false; setBusy(false); setProgress("");
    }
  };

  const close = () => { if (!busyRef.current) onClose(); };
  const refreshFolders = async () => {
    setBusy(true); busyRef.current = true; setError("");
    try { await onCreated(); setSynced(true); }
    catch { setError("Las carpetas están guardadas. Revisa tu conexión y pulsa Actualizar carpetas."); }
    finally { setBusy(false); busyRef.current = false; }
  };
  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]');
    if (!nodes?.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  if (!open) return null;
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-2 backdrop-blur-sm sm:p-6">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onKeyDown={trapFocus} className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-(--c-10121c) text-white shadow-2xl outline-none">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 p-4 sm:p-6">
        <div><p className="text-[10px] font-semibold uppercase tracking-widest text-violet-300">Del libreto a la cámara</p><h2 id={headingId} className="mt-1 text-xl font-semibold">Importar libretos</h2><p className="mt-1 text-xs text-zinc-400">Cada libreto será una carpeta en {portfolioName || "tu portafolio"}, con sus escenas en orden.</p></div>
        <button onClick={close} disabled={busy} aria-label="Cerrar importación" className="rounded-xl p-2 hover:bg-white/10 disabled:opacity-30"><X size={20} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
        {!complete && <>
          <input ref={inputRef} type="file" accept=".txt,.md,.docx,.pdf" aria-label="Archivo de libretos" className="sr-only" disabled={busy || attemptedIds.length > 0} onChange={(event) => { void readFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
          <button disabled={busy || attemptedIds.length > 0} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void readFile(event.dataTransfer.files[0]); }} className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-violet-400/40 bg-violet-400/5 p-5 text-left disabled:opacity-60">
            <UploadCloud className="shrink-0 text-violet-300" size={28} /><span className="min-w-0"><strong className="block truncate text-sm">{sourceName || "Elige o arrastra tu archivo de libretos"}</strong><span className="mt-1 block text-xs text-zinc-400">Word, PDF con texto, TXT o Markdown · hasta 4 MB</span></span>
          </button>
          {!projects.length && <div className="mt-5 rounded-2xl bg-white/[.03] p-4 text-sm leading-6 text-zinc-400"><p><b className="text-zinc-200">Un archivo puede contener varios videos.</b> Usa títulos como E01, E02 o VIDEO 1 y separa sus escenas con HOOK, DOLOR, VALOR, CTA o ESCENA 1.</p><p className="mt-2">Revisarás el resultado antes de guardar. El texto queda listo para leerlo frente a la cámara.</p><a href="/plantilla-libretos.txt" download className="mt-3 inline-flex items-center gap-2 text-violet-200 underline underline-offset-4"><FileText size={16} />Descargar archivo de ejemplo</a></div>}
          {warnings.length > 0 && <div className="mt-4 rounded-xl bg-amber-300/5 p-3 text-xs leading-5 text-amber-200">{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
          {projects.length > 0 && <div className="mt-5 grid gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
            <nav aria-label="Carpetas detectadas" className="flex gap-2 overflow-x-auto md:block md:space-y-2">
              {projects.map((project) => <button key={project.id} disabled={busy} onClick={() => setActiveProjectId(project.id)} className={`w-48 shrink-0 rounded-xl border p-3 text-left md:w-full ${activeProject?.id === project.id ? "border-violet-400/50 bg-violet-400/15" : "border-white/10 bg-black/15"}`}><span className="flex items-center gap-2 text-xs font-medium"><FolderOpen size={17} className="shrink-0 text-violet-300" /><span className="truncate">{project.title}</span>{created.some((folder) => folder.projectId === project.id) && <Check size={14} className="shrink-0 text-emerald-300" />}</span><small className="mt-2 block text-zinc-400">{project.scenes.length} escenas</small></button>)}
            </nav>
            {activeProject && <div className="min-w-0 rounded-2xl border border-white/10 p-3 sm:p-4">
              <label className="block text-xs text-zinc-400">Nombre de la carpeta<input aria-label="Nombre de la carpeta" value={activeProject.title} disabled={locked} onChange={(event) => editProject((item) => ({ ...item, title: event.target.value }))} className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white" /></label>
              {activeProject.notes && <details className="mt-3 text-xs text-zinc-400"><summary>Indicaciones del libreto</summary><p className="mt-2 whitespace-pre-wrap leading-5">{activeProject.notes}</p></details>}
              <p className="mt-4 text-xs text-zinc-400">Las escenas se grabarán en este orden. Puedes ajustar el texto.</p>
              <div className="mt-3 space-y-3">{activeProject.scenes.map((scene, index) => <div key={scene.id} className="rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="flex items-center gap-2"><span className="text-xs text-violet-300">{index + 1}</span><input value={scene.title} disabled={locked} aria-label={`Título de escena ${index + 1}`} onChange={(event) => editProject((item) => ({ ...item, scenes: item.scenes.map((entry) => entry.id === scene.id ? { ...entry, title: event.target.value } : entry) }))} className="min-w-0 flex-1 rounded bg-transparent p-1 text-xs font-medium" /><button disabled={locked || index === 0} aria-label={`Subir escena ${index + 1}`} onClick={() => editProject((item) => { const scenes = [...item.scenes]; [scenes[index - 1], scenes[index]] = [scenes[index], scenes[index - 1]]; return { ...item, scenes }; })} className="rounded p-2 hover:bg-white/10 disabled:opacity-20"><ArrowUp size={14} /></button><button disabled={locked || index === activeProject.scenes.length - 1} aria-label={`Bajar escena ${index + 1}`} onClick={() => editProject((item) => { const scenes = [...item.scenes]; [scenes[index + 1], scenes[index]] = [scenes[index], scenes[index + 1]]; return { ...item, scenes }; })} className="rounded p-2 hover:bg-white/10 disabled:opacity-20"><ArrowDown size={14} /></button><button disabled={locked} aria-label={`Eliminar escena ${index + 1} del borrador`} onClick={() => editProject((item) => ({ ...item, scenes: item.scenes.filter((entry) => entry.id !== scene.id) }))} className="rounded p-2 text-zinc-400 hover:text-red-300 disabled:opacity-20"><Trash2 size={14} /></button></div>
                <textarea aria-label={`Texto de escena ${index + 1}`} rows={3} value={scene.script} disabled={locked} onChange={(event) => editProject((item) => ({ ...item, scenes: item.scenes.map((entry) => entry.id === scene.id ? { ...entry, script: event.target.value } : entry) }))} className="mt-2 w-full resize-y rounded-lg border border-white/5 bg-black/20 p-2 text-xs leading-5 text-zinc-200" />
              </div>)}</div>
              <div className="mt-3 flex flex-wrap justify-between gap-3"><button disabled={locked || activeProject.scenes.length >= 12} onClick={() => editProject((item) => ({ ...item, scenes: [...item.scenes, { id: crypto.randomUUID(), title: `Escena ${item.scenes.length + 1}`, script: "" }] }))} className="flex items-center gap-1 text-xs text-violet-200 disabled:opacity-30"><Plus size={15} />Añadir escena</button><button disabled={locked} onClick={() => setProjects((items) => items.filter((item) => item.id !== activeProject.id))} className="text-xs text-zinc-500 disabled:opacity-30">Quitar carpeta del borrador</button></div>
            </div>}
          </div>}
          {!complete && errors.length > 0 && <div className="mt-4 rounded-xl bg-amber-300/5 p-3 text-xs leading-5 text-amber-200">{errors.map((item, index) => <p key={index}>{item}</p>)}</div>}
        </>}
        {complete && <div><div className="mb-5 rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-5"><Check className="mb-2 text-emerald-300" /><h3 className="text-lg font-semibold">Tu rodaje ya está organizado</h3><p className="mt-2 text-sm leading-6 text-zinc-400">Abre una carpeta y pulsa una escena para activar la cámara. Al terminar cada toma podrás aprobarla, guardarla como blooper o repetirla.</p></div><div className="grid gap-3 sm:grid-cols-2">{created.map((folder) => <button key={folder.sessionId} disabled={busy || !synced} onClick={() => onOpen(folder.sessionId)} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:border-violet-400/50"><FolderOpen className="text-violet-300" /><strong className="mt-3 block text-sm">{folder.title}</strong><span className="mt-3 flex items-center gap-2 text-xs text-violet-200"><Camera size={15} />Abrir carpeta para grabar</span></button>)}</div></div>}
      </div>
      <footer className="border-t border-white/10 p-4 sm:px-6">
        <p role="status" aria-live="polite" className="mb-3 text-xs text-zinc-400">{progress || (complete ? `${created.length} carpetas guardadas en la nube.` : projects.length ? `${projects.length} carpetas · ${projects.reduce((sum, item) => sum + item.scenes.length, 0)} escenas${created.length ? ` · ${created.length} carpetas guardadas` : " · aún sin guardar"}` : "No necesitas preparar el plan de edición para empezar a grabar.")}</p>
        {busy && <div role="progressbar" aria-label="Creación de carpetas" aria-valuemin={0} aria-valuemax={projects.length || 1} aria-valuenow={created.length} className="mb-3 h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full bg-violet-400 transition-all" style={{ width: projects.length ? `${created.length / projects.length * 100}%` : "20%" }} /></div>}
        <div className="flex flex-wrap justify-end gap-2">{complete && !synced && <button disabled={busy} onClick={() => void refreshFolders()} className="rounded-xl bg-violet-500 px-4 py-3 text-xs">Actualizar carpetas</button>}{complete && <button disabled={busy} onClick={() => { setProjects([]); setCreated([]); setAttemptedIds([]); setWarnings([]); setSourceName(""); setError(""); }} className="rounded-xl border border-violet-400/20 px-4 py-3 text-xs text-violet-200">Importar otro archivo</button>}<button disabled={busy} onClick={close} className="rounded-xl border border-white/10 px-4 py-3 text-xs text-zinc-300 disabled:opacity-30">{complete ? "Cerrar" : "Volver al estudio"}</button>{!complete && <button onClick={() => void createFolders()} disabled={busy || !projects.length || errors.length > 0} className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold disabled:opacity-30">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <FolderOpen size={16} />}{created.length ? "Completar carpetas" : "Crear carpetas y escenas"}</button>}</div>
      </footer>
    </div>
  </div>;
}
