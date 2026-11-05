"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Captions, Check, ChevronLeft, Download, Film, ImageIcon, Layers3,
  LoaderCircle, Music2, Pause, Play, Plus, Settings2, Sparkles,
  Type, UploadCloud, Volume2, WandSparkles, Zap,
} from "lucide-react";
import { EDITOR_STYLES, type EditorStyleId } from "../lib/editor-presets";

type Row = Record<string, any>;
type ToolTab = "media" | "styles" | "text" | "effects" | "audio";

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
  return data as T;
}

function seconds(milliseconds: unknown) {
  const value = Math.max(0, Number(milliseconds || 0) / 1000);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function ToolButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Film; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`flex min-w-[68px] flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-[10px] transition ${active ? "bg-violet-500 text-white" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"}`}><Icon size={17} /><span>{label}</span></button>;
}

function Toggle({ enabled, label, detail, onChange }: { enabled: boolean; label: string; detail: string; onChange: () => void }) {
  return <button onClick={onChange} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left ${enabled ? "border-violet-400/20 bg-violet-400/8" : "border-white/7 bg-black/15"}`}><span><strong className="block text-xs font-medium">{label}</strong><small className="mt-1 block leading-4 text-zinc-600">{detail}</small></span><span className={`relative h-5 w-9 shrink-0 rounded-full transition ${enabled ? "bg-violet-500" : "bg-zinc-800"}`}><i className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${enabled ? "left-[18px]" : "left-0.5"}`} /></span></button>;
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
  const [style, setStyle] = useState<EditorStyleId>("kiko-impacto");
  const [tool, setTool] = useState<ToolTab>("media");
  const [objective, setObjective] = useState("Reel vertical profesional: gancho fuerte, ritmo claro y cierre con autoridad.");
  const [options, setOptions] = useState({ captions: true, deadAir: true, transitions: true, soundEffects: true, labels: true, broll: false });
  const initialStyle = EDITOR_STYLES[0];
  const [settings, setSettings] = useState({ subtitleSize: initialStyle.subtitle.size, subtitlePosition: initialStyle.subtitle.position, silenceThresholdMs: initialStyle.execution.silenceThresholdMs, transition: initialStyle.transition, soundEffectVolume: initialStyle.execution.soundEffectVolume });
  const [job, setJob] = useState<Row | null>(null);
  const [busy, setBusy] = useState<"plan" | "render" | "">("");
  const [error, setError] = useState("");
  const [selectedTakeId, setSelectedTakeId] = useState("");
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!available.some((item) => item.id === sessionId)) setSessionId(available[0]?.id || "");
  }, [available, sessionId]);

  useEffect(() => {
    const latest = props.editJobs.find((item) => item.sessionId === sessionId);
    setJob(latest || null);
  }, [props.editJobs, sessionId]);

  useEffect(() => {
    const preset = EDITOR_STYLES.find((item) => item.id === style) || EDITOR_STYLES[0];
    setSettings({ subtitleSize: preset.subtitle.size, subtitlePosition: preset.subtitle.position, silenceThresholdMs: preset.execution.silenceThresholdMs, transition: preset.transition, soundEffectVolume: preset.execution.soundEffectVolume });
    setJob(null);
  }, [style]);

  const selectedSession = available.find((item) => item.id === sessionId);
  const approvedScenes = props.scenes.filter((scene) => scene.sessionId === sessionId && scene.selectedTakeId).sort((a, b) => a.position - b.position);
  const approvedTakes = approvedScenes.map((scene) => props.takes.find((take) => take.id === scene.selectedTakeId)).filter(Boolean) as Row[];
  const selectedStyle = EDITOR_STYLES.find((item) => item.id === style) || EDITOR_STYLES[0];
  const selectedTake = approvedTakes.find((take) => take.id === selectedTakeId) || approvedTakes[0];
  const ready = job?.status === "ready";
  const previewSrc = ready ? (job.resultUrl || `/api/editor/output/${job.id}`) : selectedTake ? `/api/media/${selectedTake.id}` : "";

  useEffect(() => {
    if (approvedTakes.length && !approvedTakes.some((take) => take.id === selectedTakeId)) setSelectedTakeId(approvedTakes[0].id);
  }, [approvedTakes, selectedTakeId]);

  const plan = async () => {
    setBusy("plan"); setError("");
    try {
      const result = await request<{ job: Row }>("/api/editor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, style, objective, options, settings }) });
      setJob(result.job);
      await props.onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear el plan."); }
    finally { setBusy(""); }
  };

  const render = async () => {
    if (!job) return;
    setBusy("render"); setError("");
    const fallbackStages = ["Analizando voz y silencios", "Recortando tiempos muertos", "Aplicando estilo y subtítulos", "Mezclando audio y transiciones", "Validando el MP4 final"];
    const progressTimer = job.ephemeral ? window.setInterval(() => setJob((current) => {
      if (!current || current.status === "ready") return current;
      const progress = Math.min(92, Number(current.progress || 8) + 5);
      return { ...current, status: "processing", progress, stage: fallbackStages[Math.min(fallbackStages.length - 1, Math.floor(progress / 20))] };
    }), 1400) : 0;
    const poll = job.ephemeral ? 0 : window.setInterval(async () => {
      try { setJob((await request<{ job: Row }>(`/api/editor?id=${job.id}`)).job); } catch { /* La petición principal reportará el error. */ }
    }, 1500);
    try {
      const result = await request<{ job: Row }>("/api/editor/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, job: job.ephemeral ? job : undefined }) });
      setJob(result.job); await props.onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo renderizar el video."); }
    finally { if (poll) window.clearInterval(poll); if (progressTimer) window.clearInterval(progressTimer); setBusy(""); }
  };

  const togglePlayback = async () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) { await videoRef.current.play(); setPlaying(true); }
    else { videoRef.current.pause(); setPlaying(false); }
  };

  return <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0c12] shadow-2xl sm:rounded-3xl">
    <header className="flex flex-wrap items-center gap-3 border-b border-white/8 bg-[#0d1018] px-3 py-2.5 sm:px-4">
      <button onClick={props.onBack} className="grid h-9 w-9 place-items-center rounded-xl text-zinc-500 hover:bg-white/5 hover:text-white"><ChevronLeft size={18} /></button>
      <div className="min-w-0"><p className="truncate text-sm font-medium">{selectedSession?.title || "Nuevo proyecto"}</p><p className="text-[9px] text-zinc-600">{selectedSession ? "Guardado automáticamente" : "Añade material para comenzar"}</p></div>
      {available.length ? <select value={sessionId} onChange={(event) => { setSessionId(event.target.value); setJob(null); }} className="ml-auto max-w-[170px] rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-zinc-300 outline-none">{available.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : <span className="ml-auto rounded-xl border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-[10px] text-amber-200">Sin material</span>}
      <span className="hidden rounded-xl border border-white/8 px-3 py-2 text-[10px] text-zinc-500 sm:inline">9:16 · 1080p</span>
      {ready ? <a href={previewSrc} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black"><Download size={14} />Exportar</a> : available.length ? <button onClick={job ? render : plan} disabled={busy !== ""} className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={14} /> : <Sparkles size={14} />}{busy === "render" ? "Exportando…" : job ? "Renderizar" : "Editar con IA"}</button> : <button onClick={props.onBack} className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold"><Plus size={14} />Subir video</button>}
    </header>

    <div className="grid min-h-[670px] lg:grid-cols-[78px_250px_minmax(320px,1fr)_260px]">
      <nav className="order-2 flex overflow-x-auto border-t border-white/8 bg-[#0d1018] p-1.5 lg:order-none lg:flex-col lg:border-r lg:border-t-0 lg:p-2">
        <ToolButton active={tool === "media"} icon={Film} label="Medios" onClick={() => setTool("media")} />
        <ToolButton active={tool === "styles"} icon={WandSparkles} label="Estilos" onClick={() => setTool("styles")} />
        <ToolButton active={tool === "text"} icon={Type} label="Texto" onClick={() => setTool("text")} />
        <ToolButton active={tool === "effects"} icon={Zap} label="Efectos" onClick={() => setTool("effects")} />
        <ToolButton active={tool === "audio"} icon={Volume2} label="Audio" onClick={() => setTool("audio")} />
      </nav>

      <aside className="order-3 max-h-[430px] overflow-y-auto border-t border-white/8 bg-[#0c0f17] p-4 lg:order-none lg:max-h-none lg:border-r lg:border-t-0">
        {tool === "media" && <><PanelTitle icon={Layers3} title="Tus escenas" text={`${approvedTakes.length} clips listos`} /><button onClick={props.onBack} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-violet-400/25 bg-violet-400/5 px-3 py-3 text-xs text-violet-200"><Plus size={15} />Añadir material</button><div className="mt-4 grid grid-cols-2 gap-2">{approvedTakes.map((take, index) => <button key={take.id} onClick={() => setSelectedTakeId(take.id)} className={`overflow-hidden rounded-xl border text-left ${selectedTake?.id === take.id ? "border-violet-400" : "border-white/8"}`}><div className="relative aspect-[9/12] bg-black"><video src={`/api/media/${take.id}`} muted preload="metadata" className="h-full w-full object-cover" /><span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[8px]">{seconds(take.durationMs)}</span></div><p className="truncate px-2 py-2 text-[9px] text-zinc-400">{approvedScenes[index]?.title || `Clip ${index + 1}`}</p></button>)}</div></>}
        {tool === "styles" && <><PanelTitle icon={WandSparkles} title="Estilos" text="Cambia toda la edición" /><div className="mt-4 space-y-2">{EDITOR_STYLES.map((item) => <button key={item.id} onClick={() => setStyle(item.id)} className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${style === item.id ? "border-violet-400/40 bg-violet-400/10" : "border-white/7 bg-black/15"}`}><span className="h-12 w-9 shrink-0 rounded-lg" style={{ background: `linear-gradient(145deg,${item.palette[0]},${item.palette[1]})` }} /><span className="min-w-0"><strong className="block truncate text-xs">{item.name}</strong><small className="mt-1 block truncate text-[9px] text-zinc-600">{item.reference}</small></span>{style === item.id && <Check className="ml-auto text-violet-300" size={14} />}</button>)}</div></>}
        {tool === "text" && <><PanelTitle icon={Captions} title="Subtítulos" text="Legibles y sincronizados" /><div className="mt-4 space-y-4"><Toggle enabled={options.captions} label="Subtítulos automáticos" detail="Usa el libreto de cada escena" onChange={() => setOptions({ ...options, captions: !options.captions })} /><Range label="Tamaño" value={settings.subtitleSize} min={38} max={100} suffix="px" onChange={(value) => setSettings({ ...settings, subtitleSize: value })} /><Select label="Posición" value={settings.subtitlePosition} onChange={(value) => setSettings({ ...settings, subtitlePosition: value as typeof settings.subtitlePosition })} options={[['top','Arriba'],['center','Centro'],['bottom','Abajo']]} /><Toggle enabled={options.labels} label="Título inicial" detail="Muestra el nombre del proyecto" onChange={() => setOptions({ ...options, labels: !options.labels })} /></div></>}
        {tool === "effects" && <><PanelTitle icon={Zap} title="Efectos" text="Movimiento sin complicaciones" /><div className="mt-4 space-y-3"><Toggle enabled={options.deadAir} label="Cortar silencios" detail="Elimina pausas largas" onChange={() => setOptions({ ...options, deadAir: !options.deadAir })} />{options.deadAir && <Range label="Pausa máxima" value={settings.silenceThresholdMs} min={350} max={1500} step={50} suffix=" ms" onChange={(value) => setSettings({ ...settings, silenceThresholdMs: value })} />}<Toggle enabled={options.transitions} label="Transiciones" detail="Entre escenas" onChange={() => setOptions({ ...options, transitions: !options.transitions })} />{options.transitions && <Select label="Tipo" value={settings.transition} onChange={(value) => setSettings({ ...settings, transition: value as typeof settings.transition })} options={[['cut','Corte'],['fade','Fundido'],['dissolve','Disolvencia']]} />}<div className="rounded-xl border border-dashed border-white/8 p-3 opacity-60"><p className="flex items-center gap-2 text-xs"><ImageIcon size={14} />B-roll e imágenes</p><small className="mt-1 block text-[9px] text-zinc-600">Se habilitará al conectar la biblioteca visual.</small></div></div></>}
        {tool === "audio" && <><PanelTitle icon={Volume2} title="Audio" text="Voz clara y golpes precisos" /><div className="mt-4 space-y-4"><Toggle enabled={options.soundEffects} label="Efectos sonoros" detail="En cambios importantes" onChange={() => setOptions({ ...options, soundEffects: !options.soundEffects })} />{options.soundEffects && <Range label="Intensidad" value={Math.round(settings.soundEffectVolume * 100)} min={0} max={100} suffix="%" onChange={(value) => setSettings({ ...settings, soundEffectVolume: value / 100 })} />}<div className="rounded-xl border border-dashed border-white/8 p-3 opacity-60"><p className="flex items-center gap-2 text-xs"><Music2 size={14} />Música</p><small className="mt-1 block text-[9px] text-zinc-600">Pendiente de pistas con licencia.</small></div></div></>}
      </aside>

      <main className="order-1 flex min-h-[540px] flex-col bg-[#07090e] lg:order-none">
        <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
          <div className="relative aspect-[9/16] h-[430px] max-h-[58vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:h-[520px]">
            {previewSrc ? <video key={previewSrc} ref={videoRef} src={previewSrc} controls={ready} playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="h-full w-full object-contain" /> : <button onClick={props.onBack} className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_35%,rgba(124,58,237,.18),transparent_45%)] text-center"><span><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-400/10 text-violet-200"><UploadCloud size={24} /></span><strong className="mt-4 block text-sm text-zinc-200">Sube o graba un video</strong><small className="mt-2 block px-7 leading-4 text-zinc-600">Después podrás cortarlo, subtitularlo y aplicar estilos.</small></span></button>}
            {!ready && options.captions && <div className={`pointer-events-none absolute inset-x-5 flex justify-center ${settings.subtitlePosition === "top" ? "top-[12%]" : settings.subtitlePosition === "center" ? "top-1/2 -translate-y-1/2" : "bottom-[10%]"}`}><span className="rounded-lg px-3 py-2 text-center font-black shadow-xl" style={{ color: selectedStyle.subtitle.text, backgroundColor: selectedStyle.subtitle.box, fontSize: `${Math.max(15, settings.subtitleSize * .3)}px`, textTransform: selectedStyle.subtitle.uppercase ? "uppercase" : "none" }}>{selectedStyle.caption}</span></div>}
            {!ready && <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[8px] text-zinc-300">VISTA PREVIA</span>}
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 border-t border-white/8 px-4 py-3"><button onClick={togglePlayback} disabled={!previewSrc} className="grid h-9 w-9 place-items-center rounded-full bg-white text-black disabled:opacity-30">{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><span className="text-[10px] text-zinc-600">{selectedTake ? seconds(selectedTake.durationMs) : ready ? `${job.resultMetadata?.duration_seconds || 0}s` : "0:00"}</span><span className="rounded-lg bg-white/5 px-2 py-1 text-[9px] text-zinc-500">{selectedStyle.name}</span></div>
      </main>

      <aside className="order-4 border-t border-white/8 bg-[#0c0f17] p-4 lg:order-none lg:border-l lg:border-t-0">
        <PanelTitle icon={Settings2} title="Director IA" text="Describe el resultado" />
        <textarea value={objective} onChange={(event) => { setObjective(event.target.value); setJob(null); }} rows={5} className="mt-4 w-full resize-none rounded-xl border border-white/8 bg-black/20 p-3 text-xs leading-5 text-zinc-300 outline-none focus:border-violet-400/40" placeholder="Ej. Quiero un reel energético, directo y con pausas mínimas…" />
        <div className="mt-4 rounded-xl border border-white/7 bg-black/15 p-3"><p className="text-[10px] font-medium text-zinc-300">Aplicado al render</p><div className="mt-3 space-y-2 text-[9px] text-zinc-500"><p className="flex justify-between"><span>Estilo</span><b className="text-zinc-300">{selectedStyle.name}</b></p><p className="flex justify-between"><span>Escenas</span><b className="text-zinc-300">{approvedScenes.length}</b></p><p className="flex justify-between"><span>Silencios</span><b className="text-zinc-300">{options.deadAir ? `${settings.silenceThresholdMs} ms` : "No"}</b></p><p className="flex justify-between"><span>Subtítulos</span><b className="text-zinc-300">{options.captions ? "Sí" : "No"}</b></p></div></div>
        {job && <div className={`mt-4 rounded-xl border p-3 ${ready ? "border-emerald-400/20 bg-emerald-400/6" : job.status === "failed" ? "border-red-400/20 bg-red-400/6" : "border-violet-400/20 bg-violet-400/6"}`}><div className="flex items-center justify-between text-[10px]"><span>{ready ? "Exportación verificada" : job.status === "failed" ? "Requiere corrección" : job.stage}</span><b>{job.progress || 0}%</b></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" style={{ width: `${Math.max(2, Number(job.progress || 0))}%` }} /></div>{job.error && <p className="mt-2 text-[9px] leading-4 text-red-200">{job.error}</p>}</div>}
        {!ready && <button onClick={available.length ? (job ? render : plan) : props.onBack} disabled={busy !== ""} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 px-4 py-3 text-xs font-semibold disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={15} /> : available.length ? (job ? <Film size={15} /> : <Sparkles size={15} />) : <Plus size={15} />}{busy === "plan" ? "Creando edición…" : busy === "render" ? "Renderizando…" : available.length ? (job ? "Renderizar MP4" : "Crear edición") : "Añadir material"}</button>}
        {ready && <a href={previewSrc} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-black"><Download size={15} />Descargar MP4</a>}
        {error && <p className="mt-4 rounded-xl bg-red-400/8 p-3 text-[10px] leading-4 text-red-200">{error}</p>}
      </aside>
    </div>

    <div className="border-t border-white/8 bg-[#0b0e15] p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-medium">Línea de tiempo</p><p className="text-[8px] text-zinc-600">Haz clic en un clip para verlo</p></div><span className="rounded-lg bg-white/5 px-2 py-1 text-[9px] text-zinc-500">{approvedTakes.length} clips</span></div>
      <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[8px] text-zinc-600"><span className="pt-3">VIDEO</span><div className="flex min-w-0 gap-1 overflow-x-auto">{approvedTakes.map((take, index) => <button key={take.id} onClick={() => setSelectedTakeId(take.id)} className={`min-w-[100px] flex-1 overflow-hidden rounded-lg border ${selectedTake?.id === take.id ? "border-violet-400 bg-violet-400/15" : "border-white/8 bg-white/[.03]"}`}><div className="flex items-center gap-2 p-2"><span className="grid h-7 w-7 place-items-center rounded bg-violet-500/20 text-violet-200">{index + 1}</span><span className="min-w-0 text-left"><strong className="block truncate text-[9px] text-zinc-300">{approvedScenes[index]?.title}</strong><small>{seconds(take.durationMs)}</small></span></div></button>)}</div><span className="pt-2">TEXTO</span><div className="flex gap-1 overflow-hidden">{options.captions && approvedScenes.map((scene) => <span key={scene.id} className="min-w-[100px] flex-1 truncate rounded-md bg-cyan-400/10 px-2 py-2 text-[8px] text-cyan-200">{scene.script}</span>)}</div><span className="pt-2">AUDIO</span><div className="h-7 rounded-md bg-[repeating-linear-gradient(90deg,rgba(167,139,250,.25)_0_2px,transparent_2px_6px)] opacity-70" /></div>
    </div>
  </section>;
}

function PanelTitle({ icon: Icon, title, text }: { icon: typeof Film; title: string; text: string }) { return <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-violet-300"><Icon size={16} /></span><span><strong className="block text-sm font-medium">{title}</strong><small className="text-[9px] text-zinc-600">{text}</small></span></div>; }
function Range({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) { return <label className="block text-[10px] text-zinc-500"><span className="flex justify-between"><span>{label}</span><b className="text-zinc-300">{value}{suffix}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-violet-500" /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <label className="block text-[10px] text-zinc-500">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-white/8 bg-[#111521] px-3 py-2.5 text-xs text-zinc-300 outline-none">{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>; }
