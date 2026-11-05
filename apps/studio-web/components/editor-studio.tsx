"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Captions, Check, ChevronLeft, Download, Film, ImageIcon, Layers3,
  LoaderCircle, Music2, Pause, Play, Plus, Settings2, Sparkles,
  Type, UploadCloud, Volume2, WandSparkles, Zap,
} from "lucide-react";
import { EDITOR_STYLES, type EditorStyleId } from "../lib/editor-presets";
import { loadSkillProfiles } from "../lib/studio-skills";
import { planFromScript } from "../lib/editorial-director";
import { parseCaptionCues, type CaptionCue } from "../lib/caption-cues";

// Session, scene, take and job rows share the editor surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type ToolTab = "media" | "styles" | "text" | "effects" | "audio";
type TimelineClip = { takeId: string; sceneId: string; title: string; duration: number; included: boolean; trimStartSeconds: number; trimEndSeconds: number; transcript: string; label: string; captionCues: CaptionCue[] };

class RenderStatusUnconfirmedError extends Error {}

async function findSavedRender(job: Row): Promise<Row | null> {
  if (!job.ephemeral) {
    try {
      const response = await fetch(`/api/editor?id=${encodeURIComponent(job.id)}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json() as { job?: Row };
        if (data.job?.status === "ready") return data.job;
        if (data.job?.status === "failed") return null;
      }
    } catch { /* The output library may still be available. */ }
  }
  try {
    const response = await fetch("/api/editor/outputs", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json() as { outputs?: { id: string; sizeBytes: number }[] };
    if (!data.outputs?.some((output) => output.id === job.id && output.sizeBytes > 0)) return null;
    return {
      ...job, status: "ready", stage: "MP4 encontrado en la biblioteca", progress: 100,
      resultObjectKey: job.resultObjectKey || `${job.ownerId}/renders/${job.id}.mp4`,
      resultMetadata: { ...(job.resultMetadata || {}), recoveredFromStorage: true }, error: null,
    };
  } catch { return null; }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
  return data as T;
}

async function streamRender(job: Row, onProgress: (progress: number, stage: string) => void): Promise<Row> {
  const controller = new AbortController();
  let inactivityTimer = 0;
  let progressTimer = 0;
  let stalled = false;
  let serverFailure = false;
  const keepAlive = () => {
    window.clearTimeout(inactivityTimer);
    inactivityTimer = window.setTimeout(() => { stalled = true; controller.abort(); }, 40_000);
  };
  const keepProgress = () => {
    window.clearTimeout(progressTimer);
    progressTimer = window.setTimeout(() => { stalled = true; controller.abort(); }, 180_000);
  };
  keepAlive();
  keepProgress();
  try {
    const response = await fetch("/api/editor/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ jobId: job.id, job: job.ephemeral ? job : undefined }),
      signal: controller.signal,
    });
    keepAlive();
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({})) as { job?: Row; error?: string };
      if (!response.ok) { serverFailure = true; throw new Error(data.error || "No se pudo renderizar el video."); }
      if (data.job) return data.job;
      throw new RenderStatusUnconfirmedError("El servidor no devolvió el resultado del render.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let remaining = "";
    let completed: Row | null = null;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as { type: string; progress?: number; stage?: string; job?: Row; error?: string };
      if (event.type === "progress") {
        keepProgress();
        onProgress(Number(event.progress || 0), String(event.stage || "Procesando video"));
      }
      if (event.type === "done" && event.job) completed = event.job;
      if (event.type === "error") { serverFailure = true; throw new Error(event.error || "El render se detuvo."); }
    };
    while (true) {
      const { done, value } = await reader.read();
      keepAlive();
      remaining += decoder.decode(value, { stream: !done });
      let newline = remaining.indexOf("\n");
      while (newline !== -1) {
        consume(remaining.slice(0, newline));
        remaining = remaining.slice(newline + 1);
        newline = remaining.indexOf("\n");
      }
      if (done) break;
    }
    if (remaining.trim()) consume(remaining);
    if (!completed) throw new RenderStatusUnconfirmedError("El render terminó sin confirmar un MP4.");
    return completed;
  } catch (error) {
    if (serverFailure) throw error;
    const saved = await findSavedRender(job);
    if (saved) return saved;
    throw new RenderStatusUnconfirmedError(stalled
      ? "El servidor dejó de enviar avances reales. No pudimos confirmar el resultado; revisa Mis videos antes de reintentar."
      : "Se interrumpió la conexión antes de confirmar el MP4. Revisa Mis videos antes de reintentar.");
  } finally {
    window.clearTimeout(inactivityTimer);
    window.clearTimeout(progressTimer);
  }
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
  const [settings, setSettings] = useState({ subtitleSize: initialStyle.subtitle.size, subtitlePosition: initialStyle.subtitle.position, silenceThresholdMs: initialStyle.execution.silenceThresholdMs, silenceNoiseDb: -30, transition: initialStyle.transition, soundEffectVolume: initialStyle.execution.soundEffectVolume, soundPreset: "auto" as "auto" | "none" | "soft" | "kinetic" | "cinematic" | "pop" });
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
  const [timeline, setTimeline] = useState<TimelineClip[]>([]);
  const [timelineReadyKey, setTimelineReadyKey] = useState("");
  const [draftPending, setDraftPending] = useState(false);
  const [scriptDraft, setScriptDraft] = useState("");
  const [savingScript, setSavingScript] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mediaErrorSrc, setMediaErrorSrc] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  const approvedScenes = props.scenes.filter((scene) => scene.sessionId === sessionId && scene.selectedTakeId).sort((a, b) => a.position - b.position);
  const approvedTakes = approvedScenes.map((scene) => props.takes.find((take) => take.id === scene.selectedTakeId)).filter(Boolean) as Row[];
  const timelineStorageKey = `segmenta.timeline.v1:${props.portfolioId}:${sessionId}`;
  const draftPendingKey = `segmenta.timeline-pending.v1:${props.portfolioId}:${sessionId}`;
  const sourceSignature = approvedScenes.map((scene) => `${scene.id}:${scene.selectedTakeId}:${scene.script || ""}`).join("|");

  useEffect(() => {
    const defaults = approvedScenes.flatMap((scene) => {
      const take = props.takes.find((item) => item.id === scene.selectedTakeId);
      if (!take) return [];
      const duration = Math.max(.2, Number(take.durationMs || 0) / 1000);
      return [{ takeId: take.id, sceneId: scene.id, title: String(scene.title || "Toma"), duration, included: true,
        trimStartSeconds: 0, trimEndSeconds: duration, transcript: String(scene.script || ""), label: "", captionCues: [] }];
    });
    let saved: TimelineClip[] = [];
    try { saved = JSON.parse(window.localStorage.getItem(timelineStorageKey) || "[]") as TimelineClip[]; }
    catch { /* Keep the original approved order if the local draft is corrupt. */ }
    const byId = new Map(defaults.map((clip) => [clip.takeId, clip]));
    const restored = Array.isArray(saved) ? saved.flatMap((clip) => {
      const original = byId.get(clip.takeId);
      if (!original) return [];
      byId.delete(clip.takeId);
      return [{ ...original, included: clip.included !== false,
        trimStartSeconds: Math.max(0, Math.min(original.duration - .2, Number(clip.trimStartSeconds) || 0)),
        trimEndSeconds: Math.max(.2, Math.min(original.duration, Number(clip.trimEndSeconds) || original.duration)),
        transcript: String(clip.transcript ?? original.transcript).slice(0, 1000), label: String(clip.label || "").slice(0, 120),
        captionCues: Array.isArray(clip.captionCues) ? clip.captionCues.slice(0, 100) : [] }];
    }) : [];
    setTimeline([...restored, ...byId.values()]);
    setTimelineReadyKey(timelineStorageKey);
  // Only refresh the draft when approved source material changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineStorageKey, sourceSignature]);

  useEffect(() => {
    if (timelineReadyKey === timelineStorageKey) window.localStorage.setItem(timelineStorageKey, JSON.stringify(timeline));
  }, [timeline, timelineReadyKey, timelineStorageKey]);

  useEffect(() => {
    setDraftPending(window.localStorage.getItem(draftPendingKey) === "1");
  }, [draftPendingKey]);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(ephemeralStorageKey) || "null") as Row | null;
        if (!latestJob && saved?.ephemeral && saved.sessionId === sessionId) {
          if (saved.status === "processing" || saved.status === "unconfirmed") {
            setJob((current) => current && (current.id !== saved.id || current.status === "processing")
              ? current : { ...saved, status: "unconfirmed", stage: "Comprobando el resultado", progress: 0, error: null });
            void findSavedRender(saved).then((result) => {
              if (cancelled) return;
              setJob((current) => {
                if (current && (current.id !== saved.id || current.status === "processing")) return current;
                if (result) return result;
                return { ...saved, status: "unconfirmed", stage: "Resultado sin confirmar", progress: 0, error: "No hay un MP4 confirmado para este intento. Revisa Mis videos antes de volver a renderizar." };
              });
            });
          } else setJob((current) => current && current.id !== saved.id ? current : saved);
        }
      } catch { /* Un plan local corrupto se ignora. */ }
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
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
    if (busy) return;
    const preset = EDITOR_STYLES.find((item) => item.id === nextStyle) || EDITOR_STYLES[0];
    setStyle(nextStyle);
    setSettings({ subtitleSize: preset.subtitle.size, subtitlePosition: preset.subtitle.position, silenceThresholdMs: preset.execution.silenceThresholdMs, silenceNoiseDb: -30, transition: preset.transition, soundEffectVolume: preset.execution.soundEffectVolume, soundPreset: "auto" });
    setJob(null);
    setDraftPending(true);
    window.localStorage.setItem(draftPendingKey, "1");
  };

  const changeOptions = (next: Partial<typeof options>) => {
    if (busy) return;
    setOptions((current) => ({ ...current, ...next }));
    setJob(null);
    setDraftPending(true);
    window.localStorage.setItem(draftPendingKey, "1");
  };

  const changeSettings = (next: Partial<typeof settings>) => {
    if (busy) return;
    setSettings((current) => ({ ...current, ...next }));
    setJob(null);
    setDraftPending(true);
    window.localStorage.setItem(draftPendingKey, "1");
  };

  const changeTimeline = (next: TimelineClip[] | ((current: TimelineClip[]) => TimelineClip[])) => {
    if (busy) return;
    setTimeline(next);
    setJob(null);
    setDraftPending(true);
    window.localStorage.setItem(draftPendingKey, "1");
  };

  const updateClip = (takeId: string, patch: Partial<TimelineClip>) => changeTimeline((current) => current.map((clip) => clip.takeId === takeId ? { ...clip, ...patch } : clip));

  const moveClip = (takeId: string, offset: number) => changeTimeline((current) => {
    const next = [...current];
    const from = next.findIndex((clip) => clip.takeId === takeId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= next.length) return current;
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });

  const selectedSession = available.find((item) => item.id === sessionId);
  const activeTimeline = timeline.filter((clip) => clip.included);
  const editorialPlan = useMemo(() => planFromScript(scriptDraft, timeline.filter((clip) => clip.included).map((clip) => ({ id: clip.takeId, title: clip.title, transcript: clip.transcript }))), [scriptDraft, timeline]);
  useEffect(() => {
    setScriptDraft(String(selectedSession?.script || ""));
  }, [sessionId, selectedSession?.script]);
  const hasTranscript = activeTimeline.some((clip) => clip.transcript.trim());
  const selectedStyle = EDITOR_STYLES.find((item) => item.id === style) || EDITOR_STYLES[0];
  const selectedClip = timeline.find((clip) => clip.takeId === selectedTakeId) || timeline[0];
  const selectedTake = approvedTakes.find((take) => take.id === selectedClip?.takeId) || approvedTakes[0];
  const needsPlan = !job || draftPending;
  const ready = job?.status === "ready" && !draftPending;
  const activeResult = ready ? job : latestJob?.status === "ready" ? latestJob : lastResult?.sessionId === sessionId ? lastResult : null;
  const resultIsPrevious = Boolean(activeResult && (draftPending || job?.status !== "ready"));
  const showingFinal = Boolean(activeResult && previewMode === "final");
  const resultSrc = activeResult ? `/api/editor/output/${activeResult.id}` : "";
  const previewSrc = showingFinal ? resultSrc : selectedTake ? `/api/media/${selectedTake.id}` : "";
  const resultMetadata = activeResult?.resultMetadata || {};
  const resultStyle = EDITOR_STYLES.find((item) => item.id === resultMetadata.style_id)?.name || "Estilo no registrado";

  const changeScriptDraft = (value: string) => {
    if (busy || savingScript) return;
    setScriptDraft(value.slice(0, 6_000));
    setJob(null);
    setDraftPending(true);
    window.localStorage.setItem(draftPendingKey, "1");
  };

  const ensureScriptSaved = async () => {
    const script = scriptDraft.trim();
    if (!script) throw new Error("Sube o pega el libreto completo para dirigir la edición.");
    if (script === String(selectedSession?.script || "").trim()) return;
    await request("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_session_script", sessionId, script }) });
    await props.onRefresh();
  };

  const saveScript = async () => {
    setSavingScript(true); setError("");
    try { await ensureScriptSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el libreto."); }
    finally { setSavingScript(false); }
  };

  const importScript = async (file?: File) => {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 30_000) {
      setError("Sube un libreto .txt o .md de hasta 30 KB."); return;
    }
    const content = await file.text();
    if (content.length > 6_000) { setError("El libreto admite hasta 6.000 caracteres."); return; }
    changeScriptDraft(content);
    setError("");
  };

  const importTranscript = async (clip: TimelineClip, file?: File) => {
    if (!file) return;
    if (!/\.(txt|srt|vtt)$/i.test(file.name) || file.size > 30_000) { setError("Sube una transcripción .txt, .srt o .vtt de hasta 30 KB."); return; }
    const content = await file.text();
    const timed = /\.(srt|vtt)$/i.test(file.name);
    const cues = timed ? parseCaptionCues(content) : [];
    if (timed && (!cues.length || cues.some((cue) => cue.startSeconds >= clip.duration || cue.endSeconds > clip.duration + .3))) {
      setError("Los tiempos de esta transcripción no coinciden con la duración de la toma."); return;
    }
    const transcript = timed ? cues.map((cue) => cue.text).join(" ") : content.trim();
    if (!transcript || transcript.length > 1_000) { setError("La transcripción de una toma admite entre 1 y 1.000 caracteres."); return; }
    updateClip(clip.takeId, { transcript, captionCues: cues.map((cue) => ({ ...cue, endSeconds: Math.min(clip.duration, cue.endSeconds) })) });
    setError("");
  };

  const applySuggestedOrder = () => {
    if (!editorialPlan.reliableOrder) return;
    const ranks = new Map(editorialPlan.suggestedClipIds.map((id, index) => [id, index]));
    changeTimeline((current) => [...current].sort((a, b) => (ranks.get(a.takeId) ?? 999) - (ranks.get(b.takeId) ?? 999)));
  };

  const plan = async () => {
    if (!scriptDraft.trim()) { setError("Sube o pega el libreto completo antes de editar."); return; }
    if (!activeTimeline.length) { setError("Activa al menos una toma en la línea de tiempo."); return; }
    if (options.captions && activeTimeline.some((clip) => !clip.transcript.trim())) {
      setError("Para exportar con subtítulos, escribe el texto hablado de cada toma incluida. Puedes corregirlo en la línea de tiempo.");
      return;
    }
    setBusy("plan"); setError("");
    try {
      await ensureScriptSaved();
      const result = await request<{ job: Row }>("/api/editor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, style, objective, options, settings, timeline, skillProfiles: loadSkillProfiles(props.portfolioId) }) });
      setJob(result.job);
      setDraftPending(false);
      window.localStorage.removeItem(draftPendingKey);
      if (result.job.ephemeral) window.localStorage.setItem(ephemeralStorageKey, JSON.stringify(result.job));
      else await props.onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear el plan."); }
    finally { setBusy(""); }
  };

  const render = async () => {
    if (!job) return;
    setBusy("render"); setError("");
    setJob({ ...job, status: "processing", progress: 0, stage: "Enviando el plan al servidor", error: null });
    try {
      const completedJob = await streamRender(job, (progress, stage) => setJob((current) => ({ ...(current || job), status: "processing", progress, stage, error: null })));
      setJob(completedJob);
      if (completedJob.ephemeral) window.localStorage.setItem(ephemeralStorageKey, JSON.stringify(completedJob));
      if (completedJob.status === "ready") {
        window.localStorage.setItem(resultStorageKey, JSON.stringify(completedJob));
        setLastResult(completedJob);
        setPreviewMode("final");
        setDraftPending(false);
        window.localStorage.removeItem(draftPendingKey);
      }
      if (!completedJob.ephemeral) await props.onRefresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo renderizar el video.";
      setError(message);
      setJob((current) => ({ ...(current || job), status: reason instanceof RenderStatusUnconfirmedError ? "unconfirmed" : "failed", stage: reason instanceof RenderStatusUnconfirmedError ? "Resultado sin confirmar" : "Render falló", progress: 0, error: message }));
    }
    finally { setBusy(""); }
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
      {ready ? <a href={`${resultSrc}?download=1`} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black"><Download size={14} />Descargar MP4</a> : available.length ? <button onClick={needsPlan ? plan : render} disabled={busy !== ""} className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={14} /> : <Sparkles size={14} />}{busy === "render" ? "Exportando…" : needsPlan ? "Preparar edición" : "Renderizar"}</button> : <button onClick={props.onUpload} className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold"><Plus size={14} />Subir videos</button>}
    </header>

    {activeResult && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-400/20 bg-emerald-400/[.08] px-4 py-4 sm:px-6"><div><p className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><Check size={16} />{resultIsPrevious ? "Resultado anterior disponible" : "Resultado editado listo"}</p><p className="mt-1 text-xs text-zinc-400">{resultIsPrevious ? "Esta versión todavía no incluye los cambios pendientes. Prepara y renderiza una nueva versión." : resultMetadata.recoveredFromStorage ? "El MP4 apareció en la biblioteca tras perderse la conexión. Reprodúcelo completo para comprobar el resultado." : "El MP4 pasó una comprobación inicial de video y audio. Revísalo completo antes de publicarlo."}</p>{!resultMetadata.recoveredFromStorage && <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-300"><span>{resultStyle}</span><span>· {Number(resultMetadata.duration_seconds || 0).toFixed(1)} s finales</span><span>· {Number(resultMetadata.caption_count || 0)} subtítulos</span><span>· {Number(resultMetadata.effect_count || 0)} efectos</span><span>· {Number(resultMetadata.removed_silence_seconds || 0).toFixed(1)} s de silencio retirado</span></div>}</div><div className="flex w-full gap-2 sm:w-auto"><button onClick={() => setPreviewMode("final")} className="flex-1 rounded-xl bg-emerald-400 px-3 py-2 text-xs font-semibold text-black sm:flex-none">Ver resultado</button><a href={`${resultSrc}?download=1`} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-300/30 px-3 py-2 text-xs text-emerald-100 sm:flex-none"><Download size={14} />Descargar</a></div></div>}
    {job?.status === "failed" && <div className="border-b border-red-400/20 bg-red-400/[.08] px-4 py-4 text-sm text-red-100 sm:px-6"><strong>La edición no se completó. No existe un MP4 final de este intento.</strong><p className="mt-1 text-xs text-red-200/80">{job.error || error || "Revisa el mensaje y vuelve a intentar el render."}</p></div>}
    {job?.status === "unconfirmed" && <div className="border-b border-amber-300/20 bg-amber-300/[.07] px-4 py-4 text-sm text-amber-100 sm:px-6"><strong>No pudimos confirmar el resultado de este intento.</strong><p className="mt-1 text-xs text-amber-100/80">{job.error || "Abre Mis videos para ver si apareció el MP4 antes de reintentar."}</p></div>}
    {job?.ephemeral && <div className="border-b border-amber-300/15 bg-amber-300/[.04] px-4 py-2.5 text-[11px] text-amber-100/80 sm:px-6">El plan y el progreso de esta edición solo se conservan en este navegador. El MP4 terminado aparecerá en Mis videos de esta misma sesión.</div>}

    {selectedSession && <section className="border-b border-white/8 bg-[#10131e] p-4 sm:p-5" aria-label="Dirección por libreto">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[.17em] text-violet-300">Dirección editorial</p><h2 className="mt-1 text-base font-semibold">Libreto y recursos del video</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">El libreto guía el orden y los apoyos. Para reconocer qué toma corresponde a cada parte, añade su texto hablado en la línea de tiempo.</p></div><span className={`rounded-full px-3 py-1 text-[10px] ${scriptDraft.trim() ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-300/10 text-amber-200"}`}>{scriptDraft.trim() ? "Libreto cargado" : "Libreto necesario para editar"}</span></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div><label className="block text-xs text-zinc-300">Libreto completo<textarea value={scriptDraft} onChange={(event) => changeScriptDraft(event.target.value)} maxLength={6_000} rows={7} placeholder="Pega el libreto en el orden en que debe contarse la historia. Separa ideas o escenas con líneas en blanco." className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/25 p-3 text-xs leading-5 text-white outline-none focus:border-violet-400/50" /></label><div className="mt-2 flex flex-wrap items-center gap-2"><label className="cursor-pointer rounded-lg border border-white/15 px-3 py-2 text-[11px] text-zinc-200">Subir .txt o .md<input type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={(event) => { void importScript(event.target.files?.[0]); event.target.value = ""; }} /></label><button onClick={() => void saveScript()} disabled={savingScript || !scriptDraft.trim() || scriptDraft.trim() === String(selectedSession.script || "").trim()} className="rounded-lg bg-violet-500 px-3 py-2 text-[11px] font-semibold disabled:opacity-40">{savingScript ? "Guardando…" : "Guardar libreto"}</button><span className="text-[10px] text-zinc-500">{scriptDraft.length}/6000 caracteres</span></div></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold">Orden propuesto por el libreto</p><p className="mt-1 text-[10px] text-zinc-500">{editorialPlan.matches.filter((match) => match.beatIndex !== null).length}/{activeTimeline.length} tomas vinculadas · {editorialPlan.beats.length} partes del relato</p></div><button onClick={applySuggestedOrder} disabled={!editorialPlan.reliableOrder || Boolean(busy)} className="rounded-lg bg-violet-500 px-3 py-2 text-[10px] font-semibold disabled:opacity-40">Aplicar orden</button></div>
          {!editorialPlan.reliableOrder && <p className="mt-3 rounded-lg bg-amber-300/10 p-2 text-[10px] leading-4 text-amber-100">{editorialPlan.transcriptCoverage < 1 ? "Falta texto hablado en una o más tomas; el sistema no puede reconocer su lugar con seguridad." : editorialPlan.repeatedBeats.length ? "Hay tomas que coinciden con la misma parte del libreto. Revisa si se repiten." : "El texto de las tomas no coincide lo suficiente con el libreto para imponer un orden."}</p>}
          {editorialPlan.beats.length > 0 && <ol className="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-[10px]">{editorialPlan.beats.map((beat) => { const match = editorialPlan.matches.find((item) => item.beatIndex === beat.index); const clip = activeTimeline.find((item) => item.takeId === match?.clipId); return <li key={beat.index} className="flex gap-2 rounded-lg bg-white/[.04] p-2"><span className="font-semibold text-violet-300">{beat.index + 1}.</span><span className="min-w-0"><span className="block truncate text-zinc-300">{beat.text}</span><small className={clip ? "text-emerald-300" : "text-amber-200"}>{clip ? `${clip.title} · coincidencia ${match?.confidence}` : "Falta toma o transcripción"}</small></span></li>; })}</ol>}
        </div>
      </div>
      {editorialPlan.resources.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-semibold">Recursos recomendados para esta historia</p><div className="flex gap-2 overflow-x-auto pb-1">{editorialPlan.resources.map((resource) => { const match = editorialPlan.matches.find((item) => item.beatIndex === resource.beatIndex); return <article key={resource.id} className="min-w-[210px] max-w-[240px] flex-1 rounded-xl border border-white/10 bg-black/20 p-3"><span className={`text-[9px] font-semibold uppercase tracking-wide ${resource.needsMedia ? "text-amber-200" : "text-cyan-200"}`}>{resource.needsMedia ? "Requiere imagen o toma propia" : "Generable como rótulo"}</span><strong className="mt-1 block text-xs">{resource.title}</strong><p className="mt-1 text-[10px] leading-4 text-zinc-500">{resource.detail}</p>{resource.generatedLabel && <button onClick={() => match && updateClip(match.clipId, { label: resource.generatedLabel || "" })} disabled={!match || Boolean(busy)} className="mt-2 rounded-lg border border-cyan-300/25 px-2 py-1.5 text-[10px] text-cyan-200 disabled:opacity-40">{match ? `Aplicar a ${activeTimeline.find((clip) => clip.takeId === match.clipId)?.title || "toma"}` : "Falta vincular la toma"}</button>}</article>; })}</div></div>}
    </section>}

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
        {tool === "text" && <><PanelTitle icon={Captions} title="Subtítulos" text="Texto hablado de cada toma" /><div className="mt-4 space-y-4">{!hasTranscript && <p className="rounded-xl border border-amber-300/15 bg-amber-300/5 p-3 text-[10px] leading-4 text-amber-100">Escribe o importa el texto hablado de cada toma en la línea de tiempo. El video no saldrá con subtítulos hasta completarlo o desactivarlos.</p>}<p className="text-[10px] leading-4 text-zinc-500">Importa SRT o VTT para conservar tiempos exactos. Si pegas texto plano, se repartirá aproximadamente durante la toma.</p><Toggle enabled={options.captions} label="Subtítulos por toma" detail="Corrige el texto en la línea de tiempo" onChange={() => changeOptions({ captions: !options.captions })} /><Range label="Tamaño" value={settings.subtitleSize} min={38} max={100} suffix="px" onChange={(value) => changeSettings({ subtitleSize: value })} /><Select label="Posición" value={settings.subtitlePosition} onChange={(value) => changeSettings({ subtitlePosition: value as typeof settings.subtitlePosition })} options={[['top','Arriba'],['center','Centro'],['bottom','Abajo']]} /><Toggle enabled={options.labels} label="Título inicial" detail="Muestra el nombre del proyecto" onChange={() => changeOptions({ labels: !options.labels })} /></div></>}
        {tool === "effects" && <><PanelTitle icon={Zap} title="Efectos" text="Movimiento sin complicaciones" /><div className="mt-4 space-y-3"><Toggle enabled={options.deadAir} label="Cortar silencios" detail="Elimina pausas largas" onChange={() => changeOptions({ deadAir: !options.deadAir })} />{options.deadAir && <Range label="Pausa máxima" value={settings.silenceThresholdMs} min={350} max={1500} step={50} suffix=" ms" onChange={(value) => changeSettings({ silenceThresholdMs: value })} />}{options.deadAir && <Select label="Sensibilidad al ruido" value={String(settings.silenceNoiseDb)} onChange={(value) => changeSettings({ silenceNoiseDb: Number(value) })} options={[["-35","Conservadora"],["-30","Normal"],["-25","Alta · para ruido de fondo"]]} />}<Toggle enabled={options.transitions} label="Transiciones" detail="Entre escenas" onChange={() => changeOptions({ transitions: !options.transitions })} />{options.transitions && <Select label="Tipo" value={settings.transition} onChange={(value) => changeSettings({ transition: value as typeof settings.transition })} options={[['cut','Corte'],['fade','Fundido'],['dissolve','Disolvencia']]} />}<div className="rounded-xl border border-dashed border-white/8 p-3 opacity-60"><p className="flex items-center gap-2 text-xs"><ImageIcon size={14} />B-roll e imágenes</p><small className="mt-1 block text-[9px] text-zinc-600">Se habilitará al conectar la biblioteca visual.</small></div></div></>}
        {tool === "audio" && <><PanelTitle icon={Volume2} title="Audio" text="Voz clara y golpes precisos" /><div className="mt-4 space-y-4"><Toggle enabled={options.soundEffects} label="Efectos sonoros" detail="En cambios importantes" onChange={() => changeOptions({ soundEffects: !options.soundEffects })} />{options.soundEffects && <Range label="Intensidad" value={Math.round(settings.soundEffectVolume * 100)} min={0} max={100} suffix="%" onChange={(value) => changeSettings({ soundEffectVolume: value / 100 })} />}{options.soundEffects && <Select label="Sonido de los cortes" value={settings.soundPreset} onChange={(value) => changeSettings({ soundPreset: value as typeof settings.soundPreset })} options={[["auto","Según el estilo"],["soft","Suave"],["kinetic","Golpe cinético"],["cinematic","Cinematográfico"],["pop","Marca pop"],["none","Sin sonido"]]} />}<div className="rounded-xl border border-dashed border-white/8 p-3 opacity-60"><p className="flex items-center gap-2 text-xs"><Music2 size={14} />Música</p><small className="mt-1 block text-[9px] text-zinc-600">Pendiente de pistas con licencia.</small></div></div></>}
      </aside>

      <main className="order-1 flex min-h-[540px] flex-col bg-[#07090e] lg:order-none">
        <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
          <div className="relative aspect-[9/16] h-[430px] max-h-[58vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:h-[520px]">
            {previewSrc ? <video key={previewSrc} ref={videoRef} src={previewSrc} aria-label={showingFinal ? "Resultado editado" : "Toma original sin editar"} controls playsInline preload="metadata" onLoadedMetadata={() => setMediaErrorSrc("")} onError={() => setMediaErrorSrc(previewSrc)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="h-full w-full object-contain" /> : <button onClick={props.onUpload} className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_35%,rgba(124,58,237,.18),transparent_45%)] text-center"><span><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-400/10 text-violet-200"><UploadCloud size={24} /></span><strong className="mt-4 block text-sm text-zinc-200">Sube videos para editar</strong><small className="mt-2 block px-7 leading-4 text-zinc-600">Después podrás cortarlos, subtitularlos y aplicar estilos.</small></span></button>}
            {mediaErrorSrc === previewSrc && <p className="absolute inset-x-3 bottom-12 rounded-xl bg-black/90 p-3 text-center text-[10px] leading-4 text-amber-100">{showingFinal ? "Este resultado no se pudo reproducir aquí. Prueba descargarlo o actualizar la biblioteca." : "Esta toma original no se reproduce en este navegador. El render final se exporta como MP4."}</p>}
            {!showingFinal && options.captions && selectedClip?.transcript.trim() && <div className={`pointer-events-none absolute inset-x-5 flex justify-center ${settings.subtitlePosition === "top" ? "top-[12%]" : settings.subtitlePosition === "center" ? "top-1/2 -translate-y-1/2" : "bottom-[10%]"}`}><span className="rounded-lg px-3 py-2 text-center font-black shadow-xl" style={{ color: selectedStyle.subtitle.text, backgroundColor: selectedStyle.subtitle.box, fontSize: `${Math.max(15, settings.subtitleSize * .3)}px`, textTransform: selectedStyle.subtitle.uppercase ? "uppercase" : "none" }}>{selectedClip?.transcript.split(/\s+/).slice(0, 6).join(" ")}</span></div>}
            <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[8px] ${showingFinal ? "bg-emerald-400 text-black" : "bg-black/70 text-zinc-300"}`}>{showingFinal ? resultIsPrevious ? "RESULTADO ANTERIOR" : "RESULTADO EDITADO" : "TOMA ORIGINAL · SIN EDITAR"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/8 px-4 py-3">{activeResult && <div className="flex rounded-xl border border-white/10 bg-white/5 p-1 text-[10px]"><button onClick={() => setPreviewMode("final")} className={`rounded-lg px-3 py-1.5 ${showingFinal ? "bg-emerald-400 font-semibold text-black" : "text-zinc-400"}`}>Resultado editado</button><button onClick={() => setPreviewMode("original")} className={`rounded-lg px-3 py-1.5 ${!showingFinal ? "bg-white font-semibold text-black" : "text-zinc-400"}`}>Toma original</button></div>}<button onClick={togglePlayback} disabled={!previewSrc} className="grid h-9 w-9 place-items-center rounded-full bg-white text-black disabled:opacity-30">{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><span className="text-[10px] text-zinc-400">{showingFinal ? `${Number(resultMetadata.duration_seconds || 0).toFixed(1)} s` : selectedTake ? seconds(selectedTake.durationMs) : "0:00"}</span><span className="rounded-lg bg-white/5 px-2 py-1 text-[9px] text-zinc-500">{showingFinal ? resultStyle : selectedStyle.name}</span></div>
      </main>

      <aside className="order-4 border-t border-white/8 bg-[#0c0f17] p-4 lg:order-none lg:border-l lg:border-t-0">
        <PanelTitle icon={Settings2} title="Director de edición" text="Describe el resultado" />
        <textarea value={objective} onChange={(event) => { setObjective(event.target.value); setJob(null); setDraftPending(true); window.localStorage.setItem(draftPendingKey, "1"); }} disabled={Boolean(busy)} rows={5} className="mt-4 w-full resize-none rounded-xl border border-white/8 bg-black/20 p-3 text-xs leading-5 text-zinc-300 outline-none focus:border-violet-400/40 disabled:opacity-50" placeholder="Ej. Quiero un reel energético, directo y con pausas mínimas…" />
        <div className="mt-4 rounded-xl border border-white/7 bg-black/15 p-3"><p className="text-[10px] font-medium text-zinc-300">Ajustes actuales de edición</p><div className="mt-3 space-y-2 text-[9px] text-zinc-500"><p className="flex justify-between"><span>Estilo</span><b className="text-zinc-300">{selectedStyle.name}</b></p><p className="flex justify-between"><span>Escenas</span><b className="text-zinc-300">{activeTimeline.length}</b></p><p className="flex justify-between"><span>Silencios</span><b className="text-zinc-300">{options.deadAir ? `${settings.silenceThresholdMs} ms` : "No"}</b></p><p className="flex justify-between"><span>Subtítulos</span><b className="text-zinc-300">{options.captions ? `${activeTimeline.filter((clip) => clip.transcript.trim()).length}/${activeTimeline.length}` : "No"}</b></p></div></div>
        {approvedScenes.length > 0 && !hasTranscript && <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[.06] p-3 text-[10px] leading-4 text-amber-100"><strong className="block">Falta texto para subtítulos.</strong><p className="mt-1 text-amber-100/70">Selecciona cada toma en la línea de tiempo y escribe lo que dice. También puedes desactivar subtítulos.</p></div>}
        {job && <div className={`mt-4 rounded-xl border p-3 ${ready ? "border-emerald-400/20 bg-emerald-400/6" : job.status === "failed" ? "border-red-400/20 bg-red-400/6" : job.status === "unconfirmed" ? "border-amber-300/20 bg-amber-300/6" : "border-violet-400/20 bg-violet-400/6"}`}><div className="flex items-center justify-between text-[10px]"><span>{ready ? "MP4 generado" : job.status === "failed" ? "Render falló" : job.stage}</span><b>{job.status === "failed" ? "Error" : job.status === "unconfirmed" ? "Sin confirmar" : `${job.progress || 0}%`}</b></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"><div className={`h-full transition-all ${job.status === "failed" ? "bg-red-400" : job.status === "unconfirmed" ? "bg-amber-300" : "bg-gradient-to-r from-violet-500 to-cyan-400"}`} style={{ width: `${job.status === "failed" || job.status === "unconfirmed" ? 0 : Math.max(2, Number(job.progress || 0))}%` }} /></div>{job.error && <p className="mt-2 text-[9px] leading-4 text-red-200">{job.error}</p>}</div>}
        {job?.contract?.skill_manifest?.decisions && <details className="mt-4 rounded-xl border border-white/8 bg-black/15 p-3"><summary className="cursor-pointer text-xs text-zinc-300">Decisiones de las skills ({job.contract.skill_manifest.decisions.length})</summary><div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{job.contract.skill_manifest.decisions.map((decision: Row) => <p key={decision.skillId} className="border-t border-white/5 pt-2 text-[10px] leading-4 text-zinc-500"><strong className="block text-zinc-300">{decision.skillId} · {decision.execution === "render" ? "render" : decision.execution === "pending" ? "pendiente" : decision.execution === "plan" ? "plan" : "parcial"}</strong>{decision.summary}</p>)}</div></details>}
        {!ready && <button onClick={available.length ? (needsPlan ? plan : render) : props.onUpload} disabled={busy !== ""} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 px-4 py-3 text-xs font-semibold disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={15} /> : available.length ? (needsPlan ? <Sparkles size={15} /> : <Film size={15} />) : <Plus size={15} />}{busy === "plan" ? "Creando edición…" : busy === "render" ? "Renderizando…" : available.length ? (needsPlan ? "Crear edición" : "Renderizar MP4") : "Subir videos"}</button>}
        {activeResult && <a href={`${resultSrc}?download=1`} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-black"><Download size={15} />Descargar resultado MP4</a>}
        {error && <p className="mt-4 rounded-xl bg-red-400/8 p-3 text-[10px] leading-4 text-red-200">{error}</p>}
      </aside>
    </div>

    <div className="border-t border-white/8 bg-[#0b0e15] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Línea de tiempo manual</p><p className="text-[10px] text-zinc-500">Ordena, recorta y escribe lo que realmente se dice antes de exportar.</p></div><div className="flex items-center gap-2"><span className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-zinc-400">{activeTimeline.length} de {timeline.length} tomas</span><button onClick={applySuggestedOrder} disabled={Boolean(busy) || !editorialPlan.reliableOrder} className="rounded-lg border border-violet-400/30 px-2 py-1.5 text-[10px] text-violet-200 disabled:opacity-40">Aplicar orden del libreto</button></div></div>
      <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Orden de las tomas">
        {timeline.map((clip, index) => <div key={clip.takeId} className={`min-w-[165px] max-w-[190px] flex-1 rounded-xl border p-2 ${selectedClip?.takeId === clip.takeId ? "border-violet-400 bg-violet-400/10" : "border-white/10 bg-white/[.03]"} ${clip.included ? "" : "opacity-50"}`}>
          <button onClick={() => { setSelectedTakeId(clip.takeId); setPreviewMode("original"); }} className="w-full text-left" aria-label={`Editar toma ${index + 1}: ${clip.title}`}><span className="text-[10px] text-violet-300">{index + 1} · {Math.max(.2, clip.trimEndSeconds - clip.trimStartSeconds).toFixed(1)} s</span><strong className="mt-1 block truncate text-xs">{clip.title}</strong><small className="mt-1 block truncate text-[9px] text-zinc-500">{clip.transcript || "Sin texto hablado"}</small></button>
          <div className="mt-2 flex items-center justify-between gap-1 border-t border-white/10 pt-2 text-[10px]"><button onClick={() => moveClip(clip.takeId, -1)} disabled={Boolean(busy) || index === 0} aria-label={`Mover ${clip.title} a la izquierda`} className="rounded bg-white/5 px-2 py-1 disabled:opacity-30">←</button><button onClick={() => moveClip(clip.takeId, 1)} disabled={Boolean(busy) || index === timeline.length - 1} aria-label={`Mover ${clip.title} a la derecha`} className="rounded bg-white/5 px-2 py-1 disabled:opacity-30">→</button><button onClick={() => updateClip(clip.takeId, { included: !clip.included })} disabled={Boolean(busy)} className="rounded bg-white/5 px-2 py-1">{clip.included ? "Excluir" : "Incluir"}</button></div>
        </div>)}
      </div>
      {selectedClip && <div className="mt-3 grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div><p className="text-xs font-semibold">Editar {selectedClip.title}</p><p className="mt-1 text-[10px] text-zinc-500">Los cambios se guardan en este navegador y se aplican al próximo MP4.</p><div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[10px] text-zinc-400">Inicio (s)<input type="number" min={0} max={Math.max(0, selectedClip.trimEndSeconds - .2)} step="0.1" value={selectedClip.trimStartSeconds} disabled={Boolean(busy)} onChange={(event) => updateClip(selectedClip.takeId, { trimStartSeconds: Math.max(0, Math.min(selectedClip.trimEndSeconds - .2, Number(event.target.value) || 0)) })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label>
          <label className="text-[10px] text-zinc-400">Final (s)<input type="number" min={selectedClip.trimStartSeconds + .2} max={selectedClip.duration} step="0.1" value={selectedClip.trimEndSeconds} disabled={Boolean(busy)} onChange={(event) => updateClip(selectedClip.takeId, { trimEndSeconds: Math.max(selectedClip.trimStartSeconds + .2, Math.min(selectedClip.duration, Number(event.target.value) || selectedClip.duration)) })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label>
        </div></div>
        <div className="space-y-2"><label className="block text-[10px] text-zinc-400">Texto hablado para subtítulos<textarea value={selectedClip.transcript} onChange={(event) => updateClip(selectedClip.takeId, { transcript: event.target.value, captionCues: [] })} disabled={Boolean(busy)} maxLength={1000} rows={2} placeholder="Escribe o pega las palabras de esta toma" className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-[#151822] p-2 text-xs leading-5 text-white" /></label><div className="flex flex-wrap items-center gap-2"><label className="cursor-pointer rounded-lg border border-violet-400/25 px-2 py-1.5 text-[10px] text-violet-200">Importar .srt, .vtt o .txt<input type="file" accept=".srt,.vtt,.txt,text/plain,text/vtt" disabled={Boolean(busy)} className="sr-only" onChange={(event) => { void importTranscript(selectedClip, event.target.files?.[0]); event.target.value = ""; }} /></label>{selectedClip.captionCues.length > 0 && <span className="text-[10px] text-emerald-300">{selectedClip.captionCues.length} subtítulos con tiempos</span>}</div><label className="block text-[10px] text-zinc-400">Rótulo visual opcional<input value={selectedClip.label} onChange={(event) => updateClip(selectedClip.takeId, { label: event.target.value })} disabled={Boolean(busy)} maxLength={120} placeholder="Ej. Lechona tradicional" className="mt-1 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label></div>
      </div>}
    </div>
  </section>;
}

function PanelTitle({ icon: Icon, title, text }: { icon: typeof Film; title: string; text: string }) { return <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-violet-300"><Icon size={16} /></span><span><strong className="block text-sm font-medium">{title}</strong><small className="text-[9px] text-zinc-600">{text}</small></span></div>; }
function Range({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) { return <label className="block text-[10px] text-zinc-500"><span className="flex justify-between"><span>{label}</span><b className="text-zinc-300">{value}{suffix}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-violet-500" /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <label className="block text-[10px] text-zinc-500">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-white/8 bg-[#111521] px-3 py-2.5 text-xs text-zinc-300 outline-none">{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>; }
