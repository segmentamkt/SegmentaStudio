"use client";

import { useEffect, useMemo, useState } from "react";
import { Captions, Check, ChevronRight, Clapperboard, Download, Film, Gauge, ImageIcon, LoaderCircle, Music2, Scissors, Sparkles, Tags, Volume2, WandSparkles, Zap } from "lucide-react";
import { EDITOR_STYLES, type EditorStyleId } from "../lib/editor-presets";

type Row = Record<string, any>;

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
  return data as T;
}

const TOOLS = [
  { key: "deadAir", title: "Cortar tiempos muertos", text: "Detecta pausas largas y conserva aire natural.", icon: Scissors },
  { key: "captions", title: "Subtítulos dinámicos", text: "Tarjetas cortas, legibles y adaptadas al estilo.", icon: Captions },
  { key: "transitions", title: "Transiciones", text: "Cortes o disolvencias entre escenas.", icon: Zap },
  { key: "soundEffects", title: "Efectos de sonido", text: "Golpes discretos en los cambios importantes.", icon: Volume2 },
  { key: "labels", title: "Etiquetas y títulos", text: "Gancho y conceptos clave sobre el video.", icon: Tags },
] as const;

function StyleGallery({ value, onChange, disabled = false }: { value: EditorStyleId; onChange: (style: EditorStyleId) => void; disabled?: boolean }) {
  return <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">{EDITOR_STYLES.map((item) => <button key={item.id} disabled={disabled} onClick={() => onChange(item.id)} className={`overflow-hidden rounded-2xl border text-left transition disabled:cursor-default ${value === item.id ? "border-violet-300/60 bg-violet-400/10 ring-1 ring-violet-400/25" : "border-white/8 bg-white/[.025] hover:border-white/15"}`}><div className="relative aspect-[9/12] overflow-hidden bg-[#090b12] p-3"><div className="absolute inset-0 opacity-35" style={{ background: `radial-gradient(circle at 50% 18%, ${item.palette[0]}, transparent 45%), linear-gradient(155deg, #090b12, ${item.palette[1]}22)` }} /><div className="relative flex h-full flex-col justify-between"><div className="flex items-center justify-between"><span className="rounded-full bg-black/50 px-2 py-1 text-[7px]">00:12</span><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.palette[2] }} /></div><div className="mx-auto h-24 w-16 rounded-t-full border border-white/10 bg-gradient-to-t from-zinc-800 to-zinc-600 opacity-80" /><div className="rounded-lg px-2 py-2 text-center text-[9px] font-black leading-3" style={{ color: item.palette[2], backgroundColor: `${item.palette[0]}dd` }}>{item.caption}</div></div></div><div className="p-3"><div className="flex items-start justify-between gap-2"><strong className="text-xs">{item.name}</strong>{value === item.id && <Check className="shrink-0 text-violet-300" size={14} />}</div><p className="mt-1 text-[9px] text-zinc-600">{item.reference}</p><p className="mt-2 line-clamp-3 text-[10px] leading-4 text-zinc-400">{item.description}</p><p className="mt-2 text-[9px] text-zinc-600">{item.pace}</p></div></button>)}</div>;
}

export function EditorStudio(props: {
  portfolioId: string;
  sessions: Row[];
  scenes: Row[];
  takes: Row[];
  editJobs: Row[];
  onRefresh: () => Promise<void>;
  onBack: () => void;
}) {
  const available = useMemo(() => props.sessions.filter((session) => session.portfolioId === props.portfolioId && props.scenes.some((scene) => scene.sessionId === session.id && scene.selectedTakeId)), [props.sessions, props.scenes, props.portfolioId]);
  const [sessionId, setSessionId] = useState(available[0]?.id || "");
  const [style, setStyle] = useState<EditorStyleId>("segmenta_punch");
  const [objective, setObjective] = useState("Reel vertical profesional: gancho fuerte, ritmo claro y cierre con autoridad.");
  const [options, setOptions] = useState({ captions: true, deadAir: true, transitions: true, soundEffects: true, labels: true, broll: false });
  const [job, setJob] = useState<Row | null>(null);
  const [busy, setBusy] = useState<"plan" | "render" | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!available.some((item) => item.id === sessionId)) setSessionId(available[0]?.id || "");
  }, [available, sessionId]);

  useEffect(() => {
    const latest = props.editJobs.find((item) => item.sessionId === sessionId);
    if (latest) setJob(latest);
  }, [props.editJobs, sessionId]);

  const selectedSession = available.find((item) => item.id === sessionId);
  const approvedScenes = props.scenes.filter((scene) => scene.sessionId === sessionId && scene.selectedTakeId);
  const approvedTakes = approvedScenes.map((scene) => props.takes.find((take) => take.id === scene.selectedTakeId)).filter(Boolean);
  const selectedStyle = EDITOR_STYLES.find((item) => item.id === style) || EDITOR_STYLES[0];

  const plan = async () => {
    setBusy("plan"); setError("");
    try {
      const result = await request<{ job: Row }>("/api/editor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, style, objective, options }) });
      setJob(result.job);
      await props.onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear el plan."); }
    finally { setBusy(""); }
  };

  const render = async () => {
    if (!job) return;
    setBusy("render"); setError("");
    const poll = job.ephemeral ? 0 : window.setInterval(async () => {
      try {
        const result = await request<{ job: Row }>(`/api/editor?id=${job.id}`);
        setJob(result.job);
      } catch { /* La petición principal mostrará el fallo. */ }
    }, 1500);
    try {
      const result = await request<{ job: Row }>("/api/editor/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, job: job.ephemeral ? job : undefined }) });
      setJob(result.job);
      await props.onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo renderizar el video."); }
    finally { if (poll) window.clearInterval(poll); setBusy(""); }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 rounded-3xl border border-violet-400/20 bg-[radial-gradient(circle_at_20%_0%,rgba(124,58,237,.2),transparent_45%),rgba(255,255,255,.025)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-violet-300"><WandSparkles size={14} />Centro de edición</p><h2 className="mt-2 text-2xl font-semibold">Director automático + render real</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Selecciona una producción, define el estilo y Segmenta arma cortes, silencios, subtítulos, transiciones, audio y etiquetas en un MP4 verificable.</p></div>
        <button onClick={props.onBack} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300">Volver a tomas</button>
      </div>

      {!available.length ? <div className="space-y-5"><div><div className="mb-3"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">Biblioteca de estilos</p><h3 className="mt-1 text-xl font-semibold">Así se verá la edición</h3><p className="mt-1 text-xs text-zinc-500">Puedes explorar los lenguajes visuales incluso antes de grabar.</p></div><StyleGallery value={style} onChange={setStyle} /></div><div className="grid min-h-[260px] place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[.02] p-8 text-center"><div><Clapperboard className="mx-auto text-zinc-700" size={42} /><h3 className="mt-4 text-lg font-medium">Primero aprueba tus tomas</h3><p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">El editor usa las tomas aprobadas y las organiza según el libreto. Regresa a Grabar, aprueba al menos una y vuelve aquí.</p></div></div></div> : <>
        <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/8 bg-white/[.03] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[.18em] text-zinc-500">1. Material</p>
              <select value={sessionId} onChange={(event) => { setSessionId(event.target.value); setJob(null); }} className="mt-3 w-full rounded-xl border border-white/10 bg-[#111521] px-3 py-3 text-sm outline-none">{available.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
              <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-black/20 p-3"><strong className="block text-lg">{approvedScenes.length}</strong><span className="text-[10px] text-zinc-500">escenas aprobadas</span></div><div className="rounded-xl bg-black/20 p-3"><strong className="block text-lg">{approvedTakes.length}</strong><span className="text-[10px] text-zinc-500">tomas en montaje</span></div></div>
            </div>
            <div className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-zinc-500">2. Instrucción al director</p><textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={6} className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/25 p-4 text-sm leading-6 outline-none focus:border-violet-400/40" placeholder="Explícale qué quieres conseguir con este video…" /><p className="mt-2 text-[10px] leading-4 text-zinc-600">El libreto conserva prioridad sobre las decisiones automáticas.</p></div>
          </aside>

          <div className="space-y-5">
            <div><div className="mb-3 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">3. Estilo visual</p><h3 className="mt-1 text-xl font-semibold">Escoge cómo se va a sentir</h3></div><span className="hidden text-xs text-zinc-600 sm:block">Los ejemplos son una vista del lenguaje visual</span></div>
              <StyleGallery value={style} onChange={setStyle} />
            </div>

            <div className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-300">4. Herramientas</p><h3 className="mt-1 font-medium">Qué debe aplicar el motor</h3></div><Gauge className="text-zinc-600" size={20} /></div><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{TOOLS.map((tool) => { const Icon = tool.icon; const enabled = options[tool.key]; return <button key={tool.key} onClick={() => setOptions({ ...options, [tool.key]: !enabled })} className={`flex items-start gap-3 rounded-2xl border p-3 text-left ${enabled ? "border-emerald-400/20 bg-emerald-400/7" : "border-white/7 bg-black/15"}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${enabled ? "bg-emerald-400 text-black" : "bg-white/5 text-zinc-600"}`}><Icon size={16} /></span><span><strong className="block text-xs font-medium">{tool.title}</strong><small className="mt-1 block leading-4 text-zinc-600">{tool.text}</small></span></button>; })}<div className="flex items-start gap-3 rounded-2xl border border-dashed border-white/8 p-3 opacity-55"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-zinc-500"><ImageIcon size={16} /></span><span><strong className="block text-xs">B-roll e imágenes</strong><small className="mt-1 block leading-4 text-zinc-600">Visible; se activa al conectar la biblioteca de recursos.</small></span></div><div className="flex items-start gap-3 rounded-2xl border border-dashed border-white/8 p-3 opacity-55"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-zinc-500"><Music2 size={16} /></span><span><strong className="block text-xs">Música</strong><small className="mt-1 block leading-4 text-zinc-600">Pendiente de que elijas pistas con licencia.</small></span></div></div></div>

            {!job ? <button onClick={plan} disabled={busy !== "" || !sessionId} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 px-5 py-4 text-sm font-semibold disabled:opacity-40">{busy === "plan" ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}Crear plan de edición</button> : <div className="rounded-3xl border border-violet-400/20 bg-violet-400/7 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">Trabajo de edición</p><h3 className="mt-1 font-medium">{selectedSession?.title} · {selectedStyle.name}</h3><p className="mt-1 text-xs text-zinc-500">{job.stage || "Plan editorial listo"}</p></div><span className={`rounded-full px-3 py-1.5 text-xs ${job.status === "ready" ? "bg-emerald-400/15 text-emerald-300" : job.status === "failed" ? "bg-red-400/15 text-red-300" : "bg-violet-400/15 text-violet-200"}`}>{job.status === "ready" ? "Verificado" : job.status === "failed" ? "Requiere corrección" : busy === "render" ? "Procesando" : "Plan listo"}</span></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500" style={{ width: `${Math.max(2, Number(job.progress || 0))}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-zinc-600"><span>{job.stage}</span><span>{job.progress || 0}%</span></div>{job.error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-xs text-red-200">{job.error}</p>}{job.status === "ready" ? <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]"><video src={job.resultUrl || `/api/editor/output/${job.id}`} controls playsInline className="aspect-[9/16] w-full rounded-2xl bg-black object-contain" /><div className="flex flex-col justify-center"><p className="flex items-center gap-2 text-sm font-medium text-emerald-300"><Check size={16} />MP4 renderizado y aprobado</p><p className="mt-2 text-xs leading-5 text-zinc-500">{job.resultMetadata?.duration_seconds}s · 1080×1920 · {job.resultMetadata?.caption_count || 0} subtítulos · {job.resultMetadata?.removed_silence_seconds || 0}s de silencio removido.</p><a href={job.resultUrl || `/api/editor/output/${job.id}`} className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black"><Download size={16} />Descargar video</a></div></div> : <div className="mt-5 flex flex-col gap-2 sm:flex-row"><button onClick={render} disabled={busy !== ""} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40">{busy === "render" ? <LoaderCircle className="animate-spin" size={17} /> : <Film size={17} />}{busy === "render" ? "Editando video…" : job.status === "failed" ? "Corregir y repetir render" : "Aprobar y renderizar"}</button><button onClick={() => setJob(null)} disabled={busy !== ""} className="rounded-xl border border-white/10 px-4 py-3 text-sm text-zinc-400">Cambiar estilo</button></div>}</div>}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2"><div className="rounded-3xl border border-white/8 bg-white/[.025] p-5"><p className="flex items-center gap-2 text-sm font-medium"><Clapperboard size={16} className="text-violet-300" />Línea de tiempo prevista</p><div className="mt-4 flex gap-1 overflow-hidden rounded-xl">{approvedScenes.map((scene, index) => <div key={scene.id} className="min-w-12 flex-1 p-2 text-center text-[9px]" style={{ backgroundColor: `${selectedStyle.palette[index % selectedStyle.palette.length]}33`, color: selectedStyle.palette[index % selectedStyle.palette.length] }}>{index + 1}<span className="mt-1 block truncate text-[8px] text-zinc-500">{scene.title}</span></div>)}</div></div><div className="rounded-3xl border border-white/8 bg-white/[.025] p-5"><p className="flex items-center gap-2 text-sm font-medium"><Sparkles size={16} className="text-cyan-300" />Clips automáticos tipo Opus</p><p className="mt-2 text-xs leading-5 text-zinc-500">El espacio ya está contemplado: puntuará ganchos, ideas completas y potencial de retención para sacar clips verticales. Se habilita después de validar el primer render largo.</p><span className="mt-3 inline-flex items-center gap-1 text-[10px] text-zinc-600">Siguiente fase <ChevronRight size={12} /></span></div></div>
      </>}
      {error && <div className="rounded-2xl border border-red-400/20 bg-red-400/8 p-4 text-sm text-red-100">{error}</div>}
    </section>
  );
}
