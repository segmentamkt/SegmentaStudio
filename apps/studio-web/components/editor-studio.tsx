"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Captions, Check, ChevronLeft, Download, Film, ImageIcon, Layers3,
  LoaderCircle, Music2, Pause, Play, Plus, Settings2, Sparkles,
  Type, UploadCloud, Volume2, WandSparkles, Zap,
} from "lucide-react";
import { EDITOR_STYLES, type EditorStyleId } from "../lib/editor-presets";
import { loadSkillProfiles } from "../lib/studio-skills";

// Session, scene, take and job rows share the editor surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type ToolTab = "media" | "styles" | "text" | "effects" | "audio";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
  onUpload: () => void;
  onAddToCurrent: (sessionId: string) => void;
}) {
  const available = useMemo(() => props.sessions.filter((session) => session.portfolioId === props.portfolioId && props.scenes.some((scene) => scene.sessionId === session.id && scene.selectedTakeId)), [props.sessions, props.scenes, props.portfolioId]);
  const [sessionChoice, setSessionId] = useState(available[0]?.id || "");
  const sessionId = available.some((item) => item.id === sessionChoice) ? sessionChoice : available[0]?.id || "";
  const [style, setStyle] = useState<EditorStyleId>("kiko-impacto");
  const [tool, setTool] = useState<ToolTab>("media");
  const [objective, setObjective] = useState("Reel vertical profesional: gancho fuerte, ritmo claro y cierre con autoridad.");
  const [options, setOptions] = useState({ captions: true, deadAir: true, transitions: true, soundEffects: true, labels: true, broll: false });
  const initialStyle = EDITOR_STYLES[0];
  const [settings, setSettings] = useState({ subtitleSize: initialStyle.subtitle.size, subtitlePosition: initialStyle.subtitle.position, silenceThresholdMs: initialStyle.execution.silenceThresholdMs, transition: initialStyle.transition, soundEffectVolume: initialStyle.execution.soundEffectVolume });
  const [localJob, setJob] = useState<Row | null | undefined>(undefined);
  const [lastResult, setLastResult] = useState<Row | null>(null);
  const [previewMode, setPreviewMode] = useState<"final" | "original">("final");
  const latestJob = props.editJobs.find((item) => item.sessionId === sessionId) || null;
  const job = localJob === undefined || (localJob && localJob.sessionId !== sessionId) ? latestJob : localJob;
  const ephemeralStorageKey = `segmenta.edit-job.v1:${props.portfolioId}:${sessionId}`;
  const resultStorageKey = `segmenta.latest-result.v1:${props.portfolioId}:${sessionId}`;
  const [busy, setBusy] = useState<"plan" | "render" | "">("");
  const [error, setError] = useState("");
  const [selectedTakeId, setSelectedTakeId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [mediaErrorSrc, setMediaErrorSrc] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(ephemeralStorageKey) || "null") as Row | null;
        if (!latestJob && saved?.ephemeral && saved.sessionId === sessionId) {
          setJob(saved.status === "processing" ? { ...saved, status: "failed", stage: "Render interrumpido", progress: 0, error: "El intento anterior se interrumpió. Revisa Mis videos para ver si se guardó un MP4 y, si no aparece, vuelve a renderizar." } : saved);
        }
      } catch { /* Un plan local corrupto se ignora. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ephemeralStorageKey, latestJob, sessionId]);

  useEffect(() => {
    if (localJob === null) window.localStorage.removeItem(ephemeralStorageKey);
    else if (localJob?.ephemeral && localJob.sessionId === sessionId) window.localStorage.setItem(ephemeralStorageKey, JSON.stringify(localJob));
  }, [ephemeralStorageKey, localJob, sessionId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(resultStorageKey) || "null") as Row | null;
        setLastResult(saved?.status === "ready" && saved.sessionId === sessionId ? saved : null);
      } catch { setLastResult(null); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resultStorageKey, sessionId]);

  useEffect(() => {
    if (lastResult?.status === "ready" && lastResult.sessionId === sessionId) {
      window.localStorage.setItem(resultStorageKey, JSON.stringify(lastResult));
    }
  }, [lastResult, resultStorageKey, sessionId]);

  const chooseStyle = (nextStyle: EditorStyleId) => {
    const preset = EDITOR_STYLES.find((item) => item.id === nextStyle) || EDITOR_STYLES[0];
    setStyle(nextStyle);
    setSettings({ subtitleSize: preset.subtitle.size, subtitlePosition: preset.subtitle.position, silenceThresholdMs: preset.execution.silenceThresholdMs, transition: preset.transition, soundEffectVolume: preset.execution.soundEffectVolume });
    setJob(null);
  };

  const changeOptions = (next: Partial<typeof options>) => {
    setOptions((current) => ({ ...current, ...next }));
    setJob(null);
  };

  const changeSettings = (next: Partial<typeof settings>) => {
    setSettings((current) => ({ ...current, ...next }));
    setJob(null);
  };

  const selectedSession = available.find((item) => item.id === sessionId);
  const approvedScenes = props.scenes.filter((scene) => scene.sessionId === sessionId && scene.selectedTakeId).sort((a, b) => a.position - b.position);
  const hasTranscript = approvedScenes.some((scene) => String(scene.script || "").trim());
  const approvedTakes = approvedScenes.map((scene) => props.takes.find((take) => take.id === scene.selectedTakeId)).filter(Boolean) as Row[];
  const selectedStyle = EDITOR_STYLES.find((item) => item.id === style) || EDITOR_STYLES[0];
  const selectedTake = approvedTakes.find((take) => take.id === selectedTakeId) || approvedTakes[0];
  const ready = job?.status === "ready";
  const activeResult = ready ? job : latestJob?.status === "ready" ? latestJob : lastResult?.sessionId === sessionId ? lastResult : null;
  const showingFinal = Boolean(activeResult && previewMode === "final");
  const resultSrc = activeResult ? `/api/editor/output/${activeResult.id}` : "";
  const previewSrc = showingFinal ? resultSrc : selectedTake ? `/api/media/${selectedTake.id}` : "";
  const resultMetadata = activeResult?.resultMetadata || {};
  const resultStyle = EDITOR_STYLES.find((item) => item.id === resultMetadata.style_id)?.name || "Estilo no registrado";

  const plan = async () => {
    setBusy("plan"); setError("");
    try {
      const result = await request<{ job: Row }>("/api/editor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, style, objective, options, settings, skillProfiles: loadSkillProfiles(props.portfolioId) }) });
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
      if (!current || current.status === "ready" || current.status === "failed") return current;
      const progress = Math.min(92, Number(current.progress || 8) + 5);
      return { ...current, status: "processing", progress, stage: fallbackStages[Math.min(fallbackStages.length - 1, Math.floor(progress / 20))] };
    }), 1400) : 0;
    const poll = job.ephemeral ? 0 : window.setInterval(async () => {
      try { setJob((await request<{ job: Row }>(`/api/editor?id=${job.id}`)).job); } catch { /* La petición principal reportará el error. */ }
    }, 1500);
    try {
      const result = await request<{ job: Row }>("/api/editor/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, job: job.ephemeral ? job : undefined }) });
      setJob(result.job);
      if (result.job.status === "ready") { setLastResult(result.job); setPreviewMode("final"); }
      await props.onRefresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo renderizar el video.";
      setError(message);
      setJob((current) => ({ ...(current || job), status: "failed", stage: "Render falló", progress: 0, error: message }));
    }
    finally { if (poll) window.clearInterval(poll); if (progressTimer) window.clearInterval(progressTimer); setBusy(""); }
  };

  const togglePlayback = async () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      try { await videoRef.current.play(); setPlaying(true); }
      catch { setMediaErrorSrc(previewSrc); }
    }
    else { videoRef.current.pause(); setPlaying(false); }
  };

  return <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0c12] shadow-2xl sm:rounded-3xl">
    <header className="flex flex-wrap items-center gap-3 border-b border-white/8 bg-[#0d1018] px-3 py-2.5 sm:px-4">
      <button onClick={props.onBack} className="grid h-9 w-9 place-items-center rounded-xl text-zinc-500 hover:bg-white/5 hover:text-white"><ChevronLeft size={18} /></button>
      <div className="min-w-0"><p className="truncate text-sm font-medium">{selectedSession?.title || "Nuevo proyecto"}</p><p className="text-[9px] text-zinc-600">{selectedSession ? "Guardado automáticamente" : "Añade material para comenzar"}</p></div>
      {available.length ? <select value={sessionId} onChange={(event) => { setSessionId(event.target.value); setJob(undefined); setSelectedTakeId(""); }} className="ml-auto max-w-[170px] rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-zinc-300 outline-none">{available.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : <span className="ml-auto rounded-xl border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-[10px] text-amber-200">Sin material</span>}
      <span className="hidden rounded-xl border border-white/8 px-3 py-2 text-[10px] text-zinc-500 sm:inline">9:16 · 1080p</span>
      {ready ? <a href={`${resultSrc}?download=1`} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black"><Download size={14} />Descargar MP4</a> : available.length ? <button onClick={job ? render : plan} disabled={busy !== ""} className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={14} /> : <Sparkles size={14} />}{busy === "render" ? "Exportando…" : job ? "Renderizar" : "Preparar edición"}</button> : <button onClick={props.onUpload} className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold"><Plus size={14} />Subir videos</button>}
    </header>

    {activeResult && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-400/20 bg-emerald-400/[.08] px-4 py-4 sm:px-6"><div><p className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><Check size={16} />{job?.status === "failed" ? "Resultado anterior disponible" : "Resultado editado listo"}</p><p className="mt-1 text-xs text-zinc-400">El MP4 pasó una comprobación inicial de video y audio. Revísalo completo antes de publicarlo.</p><div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-300"><span>{resultStyle}</span><span>· {Number(resultMetadata.duration_seconds || 0).toFixed(1)} s finales</span><span>· {Number(resultMetadata.caption_count || 0)} subtítulos</span><span>· {Number(resultMetadata.effect_count || 0)} efectos</span><span>· {Number(resultMetadata.removed_silence_seconds || 0).toFixed(1)} s de silencio retirado</span></div></div><div className="flex w-full gap-2 sm:w-auto"><button onClick={() => setPreviewMode("final")} className="flex-1 rounded-xl bg-emerald-400 px-3 py-2 text-xs font-semibold text-black sm:flex-none">Ver resultado</button><a href={`${resultSrc}?download=1`} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-300/30 px-3 py-2 text-xs text-emerald-100 sm:flex-none"><Download size={14} />Descargar</a></div></div>}
    {job?.status === "failed" && <div className="border-b border-red-400/20 bg-red-400/[.08] px-4 py-4 text-sm text-red-100 sm:px-6"><strong>La edición no se completó. No existe un MP4 final de este intento.</strong><p className="mt-1 text-xs text-red-200/80">{job.error || error || "Revisa el mensaje y vuelve a intentar el render."}</p></div>}

    <div className="grid min-h-[670px] lg:grid-cols-[78px_250px_minmax(320px,1fr)_260px]">
      <nav className="order-2 flex overflow-x-auto border-t border-white/8 bg-[#0d1018] p-1.5 lg:order-none lg:flex-col lg:border-r lg:border-t-0 lg:p-2">
        <ToolButton active={tool === "media"} icon={Film} label="Medios" onClick={() => setTool("media")} />
        <ToolButton active={tool === "styles"} icon={WandSparkles} label="Estilos" onClick={() => setTool("styles")} />
        <ToolButton active={tool === "text"} icon={Type} label="Texto" onClick={() => setTool("text")} />
        <ToolButton active={tool === "effects"} icon={Zap} label="Efectos" onClick={() => setTool("effects")} />
        <ToolButton active={tool === "audio"} icon={Volume2} label="Audio" onClick={() => setTool("audio")} />
      </nav>

      <aside className="order-3 max-h-[430px] overflow-y-auto border-t border-white/8 bg-[#0c0f17] p-4 lg:order-none lg:max-h-none lg:border-r lg:border-t-0">
        {tool === "media" && <><PanelTitle icon={Layers3} title="Tus escenas" text={`${approvedTakes.length} clips listos`} /><button onClick={() => props.onAddToCurrent(sessionId)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-violet-400/25 bg-violet-400/5 px-3 py-3 text-xs text-violet-200"><Plus size={15} />Añadir a este proyecto</button><div className="mt-4 grid grid-cols-2 gap-2">{approvedTakes.map((take, index) => <button key={take.id} onClick={() => setSelectedTakeId(take.id)} className={`overflow-hidden rounded-xl border text-left ${selectedTake?.id === take.id ? "border-violet-400" : "border-white/8"}`}><div className="relative aspect-[9/12] bg-black"><video src={`/api/media/${take.id}`} muted preload="metadata" className="h-full w-full object-cover" /><span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[8px]">{seconds(take.durationMs)}</span></div><p className="truncate px-2 py-2 text-[9px] text-zinc-400">{approvedScenes[index]?.title || `Clip ${index + 1}`}</p></button>)}</div></>}
        {tool === "styles" && <><PanelTitle icon={WandSparkles} title="Estilos" text="Cambia toda la edición" /><div className="mt-4 space-y-2">{EDITOR_STYLES.map((item) => <button key={item.id} onClick={() => chooseStyle(item.id)} className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${style === item.id ? "border-violet-400/40 bg-violet-400/10" : "border-white/7 bg-black/15"}`}><span className="h-12 w-9 shrink-0 rounded-lg" style={{ background: `linear-gradient(145deg,${item.palette[0]},${item.palette[1]})` }} /><span className="min-w-0"><strong className="block truncate text-xs">{item.name}</strong><small className="mt-1 block truncate text-[9px] text-zinc-600">{item.reference}</small></span>{style === item.id && <Check className="ml-auto text-violet-300" size={14} />}</button>)}</div></>}
        {tool === "text" && <><PanelTitle icon={Captions} title="Subtítulos" text="Basados en el libreto" /><div className="mt-4 space-y-4">{!hasTranscript && <p className="rounded-xl border border-amber-300/15 bg-amber-300/5 p-3 text-[10px] leading-4 text-amber-100">Para añadir subtítulos, escribe el texto hablado en cada escena desde “Crear video”. Sin ese texto se editará el video sin inventar palabras.</p>}<Toggle enabled={options.captions && Boolean(hasTranscript)} label="Subtítulos del libreto" detail="Distribución temporal aproximada por escena" onChange={() => hasTranscript ? changeOptions({ captions: !options.captions }) : setError("Añade el texto hablado a una escena antes de activar subtítulos.")} /><Range label="Tamaño" value={settings.subtitleSize} min={38} max={100} suffix="px" onChange={(value) => changeSettings({ subtitleSize: value })} /><Select label="Posición" value={settings.subtitlePosition} onChange={(value) => changeSettings({ subtitlePosition: value as typeof settings.subtitlePosition })} options={[['top','Arriba'],['center','Centro'],['bottom','Abajo']]} /><Toggle enabled={options.labels} label="Título inicial" detail="Muestra el nombre del proyecto" onChange={() => changeOptions({ labels: !options.labels })} /></div></>}
        {tool === "effects" && <><PanelTitle icon={Zap} title="Efectos" text="Movimiento sin complicaciones" /><div className="mt-4 space-y-3"><Toggle enabled={options.deadAir} label="Cortar silencios" detail="Elimina pausas largas" onChange={() => changeOptions({ deadAir: !options.deadAir })} />{options.deadAir && <Range label="Pausa máxima" value={settings.silenceThresholdMs} min={350} max={1500} step={50} suffix=" ms" onChange={(value) => changeSettings({ silenceThresholdMs: value })} />}<Toggle enabled={options.transitions} label="Transiciones" detail="Entre escenas" onChange={() => changeOptions({ transitions: !options.transitions })} />{options.transitions && <Select label="Tipo" value={settings.transition} onChange={(value) => changeSettings({ transition: value as typeof settings.transition })} options={[['cut','Corte'],['fade','Fundido'],['dissolve','Disolvencia']]} />}<div className="rounded-xl border border-dashed border-white/8 p-3 opacity-60"><p className="flex items-center gap-2 text-xs"><ImageIcon size={14} />B-roll e imágenes</p><small className="mt-1 block text-[9px] text-zinc-600">Se habilitará al conectar la biblioteca visual.</small></div></div></>}
        {tool === "audio" && <><PanelTitle icon={Volume2} title="Audio" text="Voz clara y golpes precisos" /><div className="mt-4 space-y-4"><Toggle enabled={options.soundEffects} label="Efectos sonoros" detail="En cambios importantes" onChange={() => changeOptions({ soundEffects: !options.soundEffects })} />{options.soundEffects && <Range label="Intensidad" value={Math.round(settings.soundEffectVolume * 100)} min={0} max={100} suffix="%" onChange={(value) => changeSettings({ soundEffectVolume: value / 100 })} />}<div className="rounded-xl border border-dashed border-white/8 p-3 opacity-60"><p className="flex items-center gap-2 text-xs"><Music2 size={14} />Música</p><small className="mt-1 block text-[9px] text-zinc-600">Pendiente de pistas con licencia.</small></div></div></>}
      </aside>

      <main className="order-1 flex min-h-[540px] flex-col bg-[#07090e] lg:order-none">
        <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
          <div className="relative aspect-[9/16] h-[430px] max-h-[58vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:h-[520px]">
            {previewSrc ? <video key={previewSrc} ref={videoRef} src={previewSrc} aria-label={showingFinal ? "Resultado editado" : "Toma original sin editar"} controls playsInline preload="metadata" onLoadedMetadata={() => setMediaErrorSrc("")} onError={() => setMediaErrorSrc(previewSrc)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="h-full w-full object-contain" /> : <button onClick={props.onUpload} className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_35%,rgba(124,58,237,.18),transparent_45%)] text-center"><span><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-400/10 text-violet-200"><UploadCloud size={24} /></span><strong className="mt-4 block text-sm text-zinc-200">Sube videos para editar</strong><small className="mt-2 block px-7 leading-4 text-zinc-600">Después podrás cortarlos, subtitularlos y aplicar estilos.</small></span></button>}
            {mediaErrorSrc === previewSrc && <p className="absolute inset-x-3 bottom-12 rounded-xl bg-black/90 p-3 text-center text-[10px] leading-4 text-amber-100">{showingFinal ? "Este resultado no se pudo reproducir aquí. Prueba descargarlo o actualizar la biblioteca." : "Esta toma original no se reproduce en este navegador. El render final se exporta como MP4."}</p>}
            {!showingFinal && options.captions && hasTranscript && <div className={`pointer-events-none absolute inset-x-5 flex justify-center ${settings.subtitlePosition === "top" ? "top-[12%]" : settings.subtitlePosition === "center" ? "top-1/2 -translate-y-1/2" : "bottom-[10%]"}`}><span className="rounded-lg px-3 py-2 text-center font-black shadow-xl" style={{ color: selectedStyle.subtitle.text, backgroundColor: selectedStyle.subtitle.box, fontSize: `${Math.max(15, settings.subtitleSize * .3)}px`, textTransform: selectedStyle.subtitle.uppercase ? "uppercase" : "none" }}>{selectedStyle.caption}</span></div>}
            <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[8px] ${showingFinal ? "bg-emerald-400 text-black" : "bg-black/70 text-zinc-300"}`}>{showingFinal ? "RESULTADO EDITADO" : "TOMA ORIGINAL · SIN EDITAR"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/8 px-4 py-3">{activeResult && <div className="flex rounded-xl border border-white/10 bg-white/5 p-1 text-[10px]"><button onClick={() => setPreviewMode("final")} className={`rounded-lg px-3 py-1.5 ${showingFinal ? "bg-emerald-400 font-semibold text-black" : "text-zinc-400"}`}>Resultado editado</button><button onClick={() => setPreviewMode("original")} className={`rounded-lg px-3 py-1.5 ${!showingFinal ? "bg-white font-semibold text-black" : "text-zinc-400"}`}>Toma original</button></div>}<button onClick={togglePlayback} disabled={!previewSrc} className="grid h-9 w-9 place-items-center rounded-full bg-white text-black disabled:opacity-30">{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><span className="text-[10px] text-zinc-400">{showingFinal ? `${Number(resultMetadata.duration_seconds || 0).toFixed(1)} s` : selectedTake ? seconds(selectedTake.durationMs) : "0:00"}</span><span className="rounded-lg bg-white/5 px-2 py-1 text-[9px] text-zinc-500">{showingFinal ? resultStyle : selectedStyle.name}</span></div>
      </main>

      <aside className="order-4 border-t border-white/8 bg-[#0c0f17] p-4 lg:order-none lg:border-l lg:border-t-0">
        <PanelTitle icon={Settings2} title="Director de edición" text="Describe el resultado" />
        <textarea value={objective} onChange={(event) => { setObjective(event.target.value); setJob(null); }} rows={5} className="mt-4 w-full resize-none rounded-xl border border-white/8 bg-black/20 p-3 text-xs leading-5 text-zinc-300 outline-none focus:border-violet-400/40" placeholder="Ej. Quiero un reel energético, directo y con pausas mínimas…" />
        <div className="mt-4 rounded-xl border border-white/7 bg-black/15 p-3"><p className="text-[10px] font-medium text-zinc-300">Ajustes actuales de edición</p><div className="mt-3 space-y-2 text-[9px] text-zinc-500"><p className="flex justify-between"><span>Estilo</span><b className="text-zinc-300">{selectedStyle.name}</b></p><p className="flex justify-between"><span>Escenas</span><b className="text-zinc-300">{approvedScenes.length}</b></p><p className="flex justify-between"><span>Silencios</span><b className="text-zinc-300">{options.deadAir ? `${settings.silenceThresholdMs} ms` : "No"}</b></p><p className="flex justify-between"><span>Subtítulos</span><b className="text-zinc-300">{options.captions && hasTranscript ? "Sí" : "No"}</b></p></div></div>
        {job && <div className={`mt-4 rounded-xl border p-3 ${ready ? "border-emerald-400/20 bg-emerald-400/6" : job.status === "failed" ? "border-red-400/20 bg-red-400/6" : "border-violet-400/20 bg-violet-400/6"}`}><div className="flex items-center justify-between text-[10px]"><span>{ready ? "MP4 generado" : job.status === "failed" ? "Render falló" : job.stage}</span><b>{job.status === "failed" ? "Error" : `${job.progress || 0}%`}</b></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"><div className={`h-full transition-all ${job.status === "failed" ? "bg-red-400" : "bg-gradient-to-r from-violet-500 to-cyan-400"}`} style={{ width: `${job.status === "failed" ? 0 : Math.max(2, Number(job.progress || 0))}%` }} /></div>{job.error && <p className="mt-2 text-[9px] leading-4 text-red-200">{job.error}</p>}</div>}
        {job?.contract?.skill_manifest?.decisions && <details className="mt-4 rounded-xl border border-white/8 bg-black/15 p-3"><summary className="cursor-pointer text-xs text-zinc-300">Decisiones de las skills ({job.contract.skill_manifest.decisions.length})</summary><div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{job.contract.skill_manifest.decisions.map((decision: Row) => <p key={decision.skillId} className="border-t border-white/5 pt-2 text-[10px] leading-4 text-zinc-500"><strong className="block text-zinc-300">{decision.skillId} · {decision.execution === "render" ? "render" : decision.execution === "pending" ? "pendiente" : decision.execution === "plan" ? "plan" : "parcial"}</strong>{decision.summary}</p>)}</div></details>}
        {!ready && <button onClick={available.length ? (job ? render : plan) : props.onUpload} disabled={busy !== ""} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 px-4 py-3 text-xs font-semibold disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={15} /> : available.length ? (job ? <Film size={15} /> : <Sparkles size={15} />) : <Plus size={15} />}{busy === "plan" ? "Creando edición…" : busy === "render" ? "Renderizando…" : available.length ? (job ? "Renderizar MP4" : "Crear edición") : "Subir videos"}</button>}
        {activeResult && <a href={`${resultSrc}?download=1`} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-black"><Download size={15} />Descargar resultado MP4</a>}
        {error && <p className="mt-4 rounded-xl bg-red-400/8 p-3 text-[10px] leading-4 text-red-200">{error}</p>}
      </aside>
    </div>

    <div className="border-t border-white/8 bg-[#0b0e15] p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-medium">Línea de tiempo</p><p className="text-[8px] text-zinc-600">Haz clic en un clip para verlo</p></div><span className="rounded-lg bg-white/5 px-2 py-1 text-[9px] text-zinc-500">{approvedTakes.length} clips</span></div>
      <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[8px] text-zinc-600"><span className="pt-3">VIDEO</span><div className="flex min-w-0 gap-1 overflow-x-auto">{approvedTakes.map((take, index) => <button key={take.id} onClick={() => setSelectedTakeId(take.id)} className={`min-w-[100px] flex-1 overflow-hidden rounded-lg border ${selectedTake?.id === take.id ? "border-violet-400 bg-violet-400/15" : "border-white/8 bg-white/[.03]"}`}><div className="flex items-center gap-2 p-2"><span className="grid h-7 w-7 place-items-center rounded bg-violet-500/20 text-violet-200">{index + 1}</span><span className="min-w-0 text-left"><strong className="block truncate text-[9px] text-zinc-300">{approvedScenes[index]?.title}</strong><small>{seconds(take.durationMs)}</small></span></div></button>)}</div><span className="pt-2">TEXTO</span><div className="flex gap-1 overflow-hidden">{options.captions && hasTranscript && approvedScenes.map((scene) => <span key={scene.id} className="min-w-[100px] flex-1 truncate rounded-md bg-cyan-400/10 px-2 py-2 text-[8px] text-cyan-200">{scene.script}</span>)}</div><span className="pt-2">AUDIO</span><div className="h-7 rounded-md bg-[repeating-linear-gradient(90deg,rgba(167,139,250,.25)_0_2px,transparent_2px_6px)] opacity-70" /></div>
    </div>
  </section>;
}

function PanelTitle({ icon: Icon, title, text }: { icon: typeof Film; title: string; text: string }) { return <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-violet-300"><Icon size={16} /></span><span><strong className="block text-sm font-medium">{title}</strong><small className="text-[9px] text-zinc-600">{text}</small></span></div>; }
function Range({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) { return <label className="block text-[10px] text-zinc-500"><span className="flex justify-between"><span>{label}</span><b className="text-zinc-300">{value}{suffix}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-violet-500" /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <label className="block text-[10px] text-zinc-500">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-white/8 bg-[#111521] px-3 py-2.5 text-xs text-zinc-300 outline-none">{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>; }
