"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Circle, ExternalLink, FolderKanban, Lightbulb, Plus, RotateCcw, Save, Trash2, WandSparkles } from "lucide-react";
import { SkillsStudio } from "./skills-studio";

// Workspace cards display several heterogeneous studio row shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export type WorkspaceView = "summary" | "semantic" | "skills" | "projects" | "trends" | "style" | "team" | "tasks";

type WorkspaceState = {
  references: Array<{ id: string; title: string; url: string; creator: string; topic: string; idea: string }>;
  preferences: Array<{ id: string; key: string; value: string; rationale: string }>;
  tasks: Array<{ id: string; title: string; done: boolean }>;
};

const emptyState: WorkspaceState = { references: [], preferences: [], tasks: [] };

function storageKey(portfolioId: string) { return `segmenta-workspace-v2:${portfolioId || "default"}`; }

export const WORKSPACE_NAV: Array<{ id: WorkspaceView; label: string }> = [
  { id: "summary", label: "Resumen" }, { id: "semantic", label: "Editor semántico" },
  { id: "skills", label: "Skills" }, { id: "projects", label: "Proyectos" },
  { id: "trends", label: "Ideas y tendencias" }, { id: "style", label: "Estilo Kiko" },
  { id: "team", label: "Equipo IA" }, { id: "tasks", label: "Tareas" },
];

export function WorkspaceStudio({ view, portfolioId, portfolio, sessions, scenes, onOpenEditor, onOpenResults }: {
  view: WorkspaceView; portfolioId: string; portfolio?: Row; sessions: Row[]; scenes: Row[]; onOpenEditor: () => void; onOpenResults: () => void;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(emptyState);
  const [loadedPortfolioId, setLoadedPortfolioId] = useState<string | null>(null);
  const [reference, setReference] = useState({ title: "", url: "", creator: "", topic: "" });
  const [preference, setPreference] = useState({ key: "", value: "", rationale: "" });
  const [task, setTask] = useState("");
  const [savedOutputCount, setSavedOutputCount] = useState<number | null>(null);

  useEffect(() => {
    if (view !== "summary") return;
    let active = true;
    fetch("/api/editor/outputs", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron contar los MP4.");
        return response.json() as Promise<{ outputs?: unknown[] }>;
      })
      .then((result) => { if (active) setSavedOutputCount(result.outputs?.length || 0); })
      .catch(() => { if (active) setSavedOutputCount(null); });
    return () => { active = false; };
  }, [view, portfolioId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(storageKey(portfolioId));
        setWorkspace(saved ? { ...emptyState, ...JSON.parse(saved) } : emptyState);
      } catch { setWorkspace(emptyState); }
      setLoadedPortfolioId(portfolioId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [portfolioId]);

  useEffect(() => {
    if (loadedPortfolioId === portfolioId) localStorage.setItem(storageKey(portfolioId), JSON.stringify(workspace));
  }, [workspace, portfolioId, loadedPortfolioId]);

  const portfolioSessions = useMemo(() => sessions.filter((item) => item.portfolioId === portfolioId), [sessions, portfolioId]);
  const approved = scenes.filter((scene) => portfolioSessions.some((session) => session.id === scene.sessionId) && scene.selectedTakeId).length;
  const totalScenes = scenes.filter((scene) => portfolioSessions.some((session) => session.id === scene.sessionId)).length;
  const completedJobs = savedOutputCount ?? "—";

  const addReference = () => {
    if (!reference.title.trim() || !reference.url.trim()) return;
    const idea = `${reference.topic || reference.title}: abre mostrando el resultado, explica el problema en tres movimientos y cierra con una aplicación concreta para ${portfolio?.niche || "tu audiencia"}.`;
    setWorkspace((current) => ({ ...current, references: [{ id: crypto.randomUUID(), ...reference, idea }, ...current.references] }));
    setReference({ title: "", url: "", creator: "", topic: "" });
  };
  const addPreference = () => {
    if (!preference.key.trim() || !preference.value.trim()) return;
    setWorkspace((current) => ({ ...current, preferences: [{ id: crypto.randomUUID(), ...preference }, ...current.preferences] }));
    setPreference({ key: "", value: "", rationale: "" });
  };
  const addTask = () => {
    if (!task.trim()) return;
    setWorkspace((current) => ({ ...current, tasks: [{ id: crypto.randomUUID(), title: task.trim(), done: false }, ...current.tasks] }));
    setTask("");
  };

  if (view === "summary") return <section className="space-y-5"><Heading eyebrow="CENTRO DE CONTROL" title={`Resumen de ${portfolio?.name || "tu estudio"}`} text="El mismo flujo del estudio local, ahora organizado alrededor de tu portafolio." /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[[portfolioSessions.length,"Proyectos"],[`${approved}/${totalScenes}`,"Escenas aprobadas"],[completedJobs,"MP4 guardados"],[workspace.tasks.filter((item) => !item.done).length,"Tareas pendientes"]].map(([value,label]) => <article key={String(label)} className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><strong className="text-3xl">{value}</strong><p className="mt-2 text-xs text-zinc-500">{label}</p></article>)}</div><button onClick={onOpenResults} className="flex w-full items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/[.05] px-5 py-4 text-left text-sm font-medium text-emerald-100">Ver resultados editados <ExternalLink size={16} /></button><div className="rounded-3xl border border-violet-400/15 bg-violet-400/5 p-5"><p className="text-sm font-medium">Flujo editorial</p><div className="mt-4 grid gap-2 sm:grid-cols-4">{["Libreto y grabación","Aprobación de tomas","Edición semántica","Render y validación"].map((label,index) => <div key={label} className="rounded-2xl bg-black/20 p-4"><span className="grid h-7 w-7 place-items-center rounded-full bg-violet-500 text-xs font-bold">{index+1}</span><p className="mt-3 text-xs">{label}</p></div>)}</div></div></section>;

  if (view === "semantic") return <section className="space-y-5"><Heading eyebrow="EDICIÓN SEMÁNTICA" title="Editor semántico" text="Compara el libreto con las tomas aprobadas, conserva el orden narrativo y entrega el contrato al motor de edición." /><div className="grid gap-4 lg:grid-cols-2">{portfolioSessions.map((session) => { const sessionScenes = scenes.filter((scene) => scene.sessionId === session.id).sort((a,b) => a.position-b.position); return <article key={session.id} className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><div className="flex items-start justify-between"><div><p className="text-[10px] uppercase tracking-[.18em] text-violet-300">Producción</p><h3 className="mt-1 font-medium">{session.title}</h3></div><span className="rounded-full bg-white/5 px-3 py-1 text-[10px] text-zinc-400">{sessionScenes.filter((item) => item.selectedTakeId).length}/{sessionScenes.length} aprobadas</span></div><div className="mt-4 space-y-2">{sessionScenes.map((scene,index) => <div key={scene.id} className="flex items-center gap-3 rounded-xl bg-black/20 p-3"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs ${scene.selectedTakeId ? "bg-emerald-400 text-black" : "bg-white/5 text-zinc-600"}`}>{scene.selectedTakeId ? <Check size={13}/> : index+1}</span><span className="min-w-0"><strong className="block truncate text-xs">{scene.title}</strong><small className="block truncate text-zinc-600">{scene.script}</small></span></div>)}</div><button onClick={onOpenEditor} disabled={!sessionScenes.some((item) => item.selectedTakeId)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold disabled:opacity-30"><WandSparkles size={16}/>Planificar y editar</button></article>; })}{!portfolioSessions.length && <Empty icon={<BookOpen/>} title="Crea una producción con libreto" text="Cuando grabes y apruebes las tomas, aparecerán aquí en orden." />}</div></section>;

  if (view === "skills") return <SkillsStudio portfolioId={portfolioId} />;

  if (view === "projects") return <section className="space-y-5"><Heading eyebrow="PRODUCCIONES" title="Proyectos" text="Cada proyecto conserva libreto, escenas, tomas aprobadas y trabajos de edición." /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{portfolioSessions.map((session) => { const rows=scenes.filter((scene)=>scene.sessionId===session.id); const done=rows.filter((scene)=>scene.selectedTakeId).length; return <article key={session.id} className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><FolderKanban className="text-violet-300"/><h3 className="mt-4 font-medium">{session.title}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{session.script}</p><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-emerald-400" style={{width:`${rows.length ? done/rows.length*100 : 0}%`}}/></div><p className="mt-2 text-[10px] text-zinc-600">{done}/{rows.length} escenas listas</p></article>})}</div></section>;

  if (view === "trends") return <section className="space-y-5"><Heading eyebrow="REFERENCIAS VERIFICABLES" title="Ideas y tendencias" text="Registra referencias autorizadas y conviértelas en una idea original para tu portafolio." /><div className="grid gap-5 xl:grid-cols-[380px_1fr]"><FormCard title="Nueva referencia"><Input label="Título" value={reference.title} onChange={(value)=>setReference({...reference,title:value})}/><Input label="Enlace" value={reference.url} onChange={(value)=>setReference({...reference,url:value})}/><Input label="Creador" value={reference.creator} onChange={(value)=>setReference({...reference,creator:value})}/><Input label="Tema" value={reference.topic} onChange={(value)=>setReference({...reference,topic:value})}/><Primary onClick={addReference}><Lightbulb size={15}/>Guardar y crear idea</Primary></FormCard><div className="space-y-3">{workspace.references.map((item)=><article key={item.id} className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><div className="flex justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.18em] text-cyan-300">{item.creator || "Referencia"}</p><h3 className="mt-1 font-medium">{item.title}</h3></div><a href={item.url} target="_blank" rel="noreferrer" className="text-zinc-500"><ExternalLink size={16}/></a></div><p className="mt-4 rounded-2xl bg-black/20 p-4 text-sm leading-6 text-zinc-300">{item.idea}</p></article>)}{!workspace.references.length&&<Empty icon={<Lightbulb/>} title="Todavía no hay referencias" text="Añade el primer reel, video o creador que quieras estudiar."/>}</div></div></section>;

  if (view === "style") return <section className="space-y-5"><Heading eyebrow="APRENDIZAJE CONTROLADO" title="Estilo Kiko" text="Guarda únicamente preferencias confirmadas; puedes retirar cualquier regla cuando quieras." /><div className="grid gap-5 xl:grid-cols-[380px_1fr]"><FormCard title="Confirmar preferencia"><Input label="Elemento" value={preference.key} onChange={(value)=>setPreference({...preference,key:value})} placeholder="Ej. subtítulos"/><Input label="Preferencia" value={preference.value} onChange={(value)=>setPreference({...preference,value:value})} placeholder="Ej. palabras clave amarillas"/><Input label="Por qué" value={preference.rationale} onChange={(value)=>setPreference({...preference,rationale:value})}/><Primary onClick={addPreference}><Save size={15}/>Guardar preferencia</Primary></FormCard><div className="space-y-3">{workspace.preferences.map((item)=><article key={item.id} className="flex items-start justify-between gap-4 rounded-2xl border border-white/8 bg-white/[.03] p-4"><div><p className="text-xs font-medium">{item.key}</p><p className="mt-1 text-sm text-violet-200">{item.value}</p><small className="mt-2 block text-zinc-600">{item.rationale}</small></div><button onClick={()=>setWorkspace((current)=>({...current,preferences:current.preferences.filter((row)=>row.id!==item.id)}))} className="text-zinc-600 hover:text-amber-300" title="Revertir"><RotateCcw size={15}/></button></article>)}</div></div></section>;

  if (view === "team") return <section className="space-y-5"><Heading eyebrow="EQUIPO IA" title="Codex, Claude y Gemini" text="Estado real de los tres colaboradores y del puente entre la nube y tu computador." /><div className="grid gap-4 md:grid-cols-3">{[{name:"Codex",state:"Disponible aquí",detail:"Construcción, diagnóstico y dirección del producto.",ready:true},{name:"Claude",state:"Disponible en el motor local",detail:"La nube todavía necesita el puente seguro de sesión para invocarlo.",ready:false},{name:"Gemini",state:"Disponible en el motor local",detail:"La nube todavía necesita el puente seguro de sesión para invocarlo.",ready:false}].map((agent)=><article key={agent.name} className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-400/10 text-xl font-black">{agent.name[0]}</span><h3 className="mt-4 font-medium">{agent.name}</h3><p className="mt-2 text-xs leading-5 text-zinc-500">{agent.detail}</p><span className={`mt-4 inline-flex rounded-full px-3 py-1 text-[10px] ${agent.ready?"bg-emerald-400/12 text-emerald-300":"bg-amber-300/10 text-amber-200"}`}>{agent.state}</span></article>)}</div><div className="rounded-3xl border border-amber-300/15 bg-amber-300/5 p-5 text-sm leading-6 text-zinc-400"><strong className="text-amber-200">Sin simulación:</strong> el panel ya conserva el módulo, pero no afirmará que Claude o Gemini trabajan en la nube hasta que el puente autenticado quede instalado.</div></section>;

  return <section className="space-y-5"><Heading eyebrow="COLA RECUPERABLE" title="Tareas" text="Marca lo realizado y conserva visible el siguiente paso del proyecto." /><div className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><div className="flex gap-2"><input value={task} onChange={(event)=>setTask(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")addTask();}} placeholder="Nueva tarea…" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm"/><button onClick={addTask} className="grid h-12 w-12 place-items-center rounded-xl bg-violet-500"><Plus size={18}/></button></div><div className="mt-4 space-y-2">{workspace.tasks.map((item)=><div key={item.id} className="flex items-center gap-3 rounded-xl bg-black/20 p-3"><button onClick={()=>setWorkspace((current)=>({...current,tasks:current.tasks.map((row)=>row.id===item.id?{...row,done:!row.done}:row)}))} className={item.done?"text-emerald-300":"text-zinc-600"}>{item.done?<Check size={18}/>:<Circle size={18}/>}</button><span className={`flex-1 text-sm ${item.done?"text-zinc-600 line-through":"text-zinc-300"}`}>{item.title}</span><button onClick={()=>setWorkspace((current)=>({...current,tasks:current.tasks.filter((row)=>row.id!==item.id)}))} className="text-zinc-700 hover:text-red-300"><Trash2 size={15}/></button></div>)}</div></div></section>;
}

function Heading({eyebrow,title,text}:{eyebrow:string;title:string;text:string}) { return <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">{eyebrow}</p><h2 className="mt-2 text-2xl font-semibold">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{text}</p></div>; }
function FormCard({title,children}:{title:string;children:React.ReactNode}) { return <div className="space-y-3 rounded-3xl border border-white/8 bg-white/[.03] p-5"><h3 className="font-medium">{title}</h3>{children}</div>; }
function Input({label,value,onChange,placeholder=""}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string}) { return <label className="block text-[10px] text-zinc-500">{label}<input value={value} onChange={(event)=>onChange(event.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-zinc-200"/></label>; }
function Primary({onClick,children}:{onClick:()=>void;children:React.ReactNode}) { return <button onClick={onClick} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold">{children}</button>; }
function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}) { return <div className="grid min-h-[220px] place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[.02] p-8 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-zinc-600">{icon}</span><h3 className="mt-4 font-medium">{title}</h3><p className="mt-2 max-w-sm text-xs leading-5 text-zinc-600">{text}</p></div></div>; }
