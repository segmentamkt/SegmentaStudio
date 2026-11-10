"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Captions, Check, ChevronLeft, Download, Film, ImageIcon, Layers3,
  LoaderCircle, Music2, Pause, Play, Plus, Settings2, Sparkles,
  Type, UploadCloud, Volume2, WandSparkles, Zap, SlidersHorizontal,
} from "lucide-react";
import { EDITOR_STYLES, type EditorStyleId } from "../lib/editor-presets";
import { loadSkillProfiles } from "../lib/studio-skills";
import { preproductionSchema } from "../lib/preproduction-plan";
import { planFromScript } from "../lib/editorial-director";
import { parseCaptionCues, retimeEditedCue, splitCueAt, type CaptionCue } from "../lib/caption-cues";
// Only the pure planner: the drawing module uses Node APIs and stays on the server.
import { planKineticCaptions } from "../lib/skills/subtitulos-cineticos/plan";
import { transcribeTakeInBrowser } from "../lib/browser-transcription";
import { getCaptionGenerationTargets, mergeCaptionGenerationResult } from "../lib/caption-generation";
import { AutomaticCaptions, type CaptionTask } from "./automatic-captions";
import { EDITOR_TOOL_CATALOG } from "../lib/editor-tool-catalog";
import { MediaReviewPanel } from "./media-review";
import type { MediaReviewReceipt } from "../lib/media-review";
import { alignReviewedTimeline } from "../lib/reviewed-timeline";
import { repairUnknownTimelineDuration } from "../lib/editor-media-duration";
import { runAutomaticEdit, type AutomaticEditStage } from "../lib/automatic-edit";
import { parseRenderPreview, type RenderPreview } from "../lib/render-preview";
import { EditingProgress } from "./editing-progress";
import { SalaEdicion, type SalaClip } from "./sala/sala-edicion";
import { decodeSpeechWav, SPEECH_SAMPLE_RATE } from "../lib/transcription-core";
import { VisualResourcesPanel } from "./visual-resources-panel";
import { VISUAL_RESOURCE_CATALOG, VISUAL_RESOURCE_LAYOUTS, normalizeVisualResources, recommendVisualResources, resourceImageSrc, validateVisualResourceBudget, type VisualResource, type VisualResourceImage } from "../lib/visual-resources";
import { fitVisualResources } from "../lib/visual-resource-editing";

// Session, scene, take and job rows share the editor surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// Browser storage is a draft backup; it must never turn a completed server job into a failure.
function saveEditorDraft(key: string, value: string) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}
function removeEditorDraft(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* Server result remains available. */ }
}
type ToolTab = "media" | "styles" | "text" | "effects" | "audio" | "video" | "catalog" | "resources";
type TimelineClip = { segmentId: string; takeId: string; sceneId: string; title: string; duration: number; included: boolean; trimStartSeconds: number; trimEndSeconds: number; playbackSpeed: number; audioVolume: number; brightness: number; contrast: number; saturation: number; transcript: string; label: string; captionCues: CaptionCue[]; visualResources: VisualResource[]; resourcesReviewed: boolean };

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

async function streamRender(job: Row, onProgress: (progress: number, stage: string) => void, onPreview?: (preview: RenderPreview) => void): Promise<Row> {
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
      const event = JSON.parse(line) as { type: string; progress?: number; stage?: string; job?: Row; error?: string; preview?: unknown };
      if (event.type === "progress") {
        keepProgress();
        onProgress(Number(event.progress || 0), String(event.stage || "Procesando video"));
      }
      if (event.type === "preview") {
        const preview = parseRenderPreview(event.preview);
        if (preview) { keepProgress(); onPreview?.(preview); }
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

function draftNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function ToolButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Film; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`flex min-w-[68px] flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-[10px] transition ${active ? "bg-violet-500 text-white" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"}`}><Icon size={17} /><span>{label}</span></button>;
}

function Toggle({ enabled, label, detail, onChange }: { enabled: boolean; label: string; detail: string; onChange: () => void }) {
  return <button onClick={onChange} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left ${enabled ? "border-violet-400/20 bg-violet-400/8" : "border-white/7 bg-black/15"}`}><span><strong className="block text-xs font-medium">{label}</strong><small className="mt-1 block leading-4 text-zinc-600">{detail}</small></span><span className={`relative h-5 w-9 shrink-0 rounded-full transition ${enabled ? "bg-violet-500" : "bg-zinc-800"}`}><i className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${enabled ? "left-[18px]" : "left-0.5"}`} /></span></button>;
}

export function EditorStudio(props: {
  initialSessionId?: string;
  initialResultId?: string;
  initialTakeId?: string;
  initialManualSegmentation?: boolean;
  portfolioId: string;
  sessions: Row[];
  scenes: Row[];
  takes: Row[];
  editJobs: Row[];
  preproductionPlans: Row[];
  onRefresh: () => Promise<void>;
  onBack: () => void;
  onUpload: () => void;
  onAddToCurrent: (sessionId: string) => void;
}) {
  const available = useMemo(() => props.sessions.filter((session) => session.portfolioId === props.portfolioId && props.takes.some((take) => take.sessionId === session.id)), [props.sessions, props.takes, props.portfolioId]);
  const [sessionChoice, setSessionId] = useState(props.initialSessionId || available[0]?.id || "");
  const sessionId = available.some((item) => item.id === sessionChoice) ? sessionChoice : available[0]?.id || "";
  const gallerySessionId = props.initialSessionId || props.takes.find((take) => take.id === props.initialTakeId)?.sessionId || "";
  const galleryEntryKey = props.initialTakeId ? `${gallerySessionId}:${props.initialTakeId}:${Boolean(props.initialManualSegmentation)}` : "";
  const [appliedGalleryEntry, setAppliedGalleryEntry] = useState("");
  const galleryEntryPending = Boolean(galleryEntryKey && appliedGalleryEntry !== galleryEntryKey && gallerySessionId === sessionId);
  const [segmentationFocus, setSegmentationFocus] = useState("");
  const [reviewState, setReviewState] = useState<{ key: string; review: MediaReviewReceipt | null; valid: boolean; error: string }>({ key: "", review: null, valid: false, error: "" });
  const [reviewReload, setReviewReload] = useState(0);
  const [manualReviewSession, setManualReviewSession] = useState("");
  const reviewSourceKey = JSON.stringify([
    sessionId,
    props.scenes.filter((scene) => scene.sessionId === sessionId).map((scene) => [scene.id, scene.position, scene.selectedTakeId]),
    props.takes.filter((take) => take.sessionId === sessionId).map((take) => [take.id, take.sceneId, take.status, take.objectKey, take.durationMs, take.bytes, take.mimeType]),
    reviewReload,
  ]);
  const reviewLoaded = reviewState.key === reviewSourceKey;
  const reviewConfirmed = reviewLoaded && reviewState.valid && Boolean(reviewState.review?.orderedTakeIds.length);
  const review = reviewConfirmed ? reviewState.review : null;
  const galleryTakeNeedsReview = galleryEntryPending && reviewLoaded && !review?.orderedTakeIds.includes(props.initialTakeId!);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    void request<{ review: MediaReviewReceipt | null; valid: boolean }>(`/api/media-review?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setReviewState({ key: reviewSourceKey, ...result, error: "" }); })
      .catch((reason) => { if (!controller.signal.aborted) setReviewState({ key: reviewSourceKey, review: null, valid: false, error: reason instanceof Error ? reason.message : "No pudimos cargar la revisión." }); });
    return () => controller.abort();
  }, [sessionId, reviewSourceKey]);
  const [style, setStyle] = useState<EditorStyleId>("kiko-impacto");
  const [tool, setTool] = useState<ToolTab>("media");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [resourceMessage, setResourceMessage] = useState("");
  const [draftStorageWarning, setDraftStorageWarning] = useState(false);
  const [objective, setObjective] = useState("Reel vertical profesional: gancho fuerte, ritmo claro y cierre con autoridad.");
  const [options, setOptions] = useState({ captions: false, deadAir: true, transitions: true, soundEffects: true, labels: true, broll: true });
  const initialStyle = EDITOR_STYLES[0];
  const [settings, setSettings] = useState({ subtitleSize: initialStyle.subtitle.size, subtitlePosition: initialStyle.subtitle.position, silenceThresholdMs: initialStyle.execution.silenceThresholdMs, silenceNoiseDb: -30, noiseReduction: "off" as "off" | "light" | "medium", transition: initialStyle.transition, soundEffectVolume: initialStyle.execution.soundEffectVolume, soundPreset: "auto" as "auto" | "none" | "soft" | "kinetic" | "cinematic" | "pop" });
  const [localJob, setJob] = useState<Row | null | undefined>(undefined);
  const [selectedResultId, setSelectedResultId] = useState(props.initialResultId || "");
  useEffect(() => { setSelectedResultId(props.initialResultId || ""); }, [props.initialResultId]);
  const [lastResult, setLastResult] = useState<Row | null>(null);
  const [previewMode, setPreviewMode] = useState<"final" | "original" | "live">("final");
  const latestJob = props.editJobs.find((item) => item.id === selectedResultId && item.sessionId === sessionId)
    || props.editJobs.find((item) => item.sessionId === sessionId) || null;
  const parsedPreproduction = preproductionSchema.safeParse(props.preproductionPlans.find((item) => item.sessionId === sessionId)?.contract);
  const preproduction = parsedPreproduction.success ? parsedPreproduction.data : null;
  const job = localJob === undefined || (localJob && localJob.sessionId !== sessionId) ? latestJob : localJob;
  const ephemeralStorageKey = `segmenta.edit-job.v1:${props.portfolioId}:${sessionId}`;
  const resultStorageKey = `segmenta.latest-result.v1:${props.portfolioId}:${sessionId}`;
  const [busy, setBusy] = useState<"transcribe" | "plan" | "render" | "">("");
  const [error, setError] = useState("");
  const [automaticRunning, setAutomaticRunning] = useState(false);
  const [automaticStage, setAutomaticStage] = useState<AutomaticEditStage | "error" | "cancelled" | "idle">("idle");
  const automaticRunRef = useRef<AbortController | null>(null);
  const [automaticRequest, setAutomaticRequest] = useState<{ sessionId: string; reviewId: string } | null>(null);
  // Sala de edición: snapshot of the montage when it opens, so an export in progress never restarts the agents.
  const [salaClips, setSalaClips] = useState<Array<SalaClip & { takeId: string }> | null>(null);
  const [livePreviews, setLivePreviews] = useState<RenderPreview[]>([]);
  const [livePreviewIndex, setLivePreviewIndex] = useState(0);
  const [transcriptionStage, setTranscriptionStage] = useState("");
  const [transcriptionTasks, setTranscriptionTasks] = useState<CaptionTask[]>([]);
  const transcriptionRunRef = useRef<AbortController | null>(null);
  const [selectedTakeId, setSelectedTakeId] = useState("");
  const [timeline, setTimeline] = useState<TimelineClip[]>([]);
  const timelineRef = useRef<TimelineClip[]>([]);
  const undoRef = useRef<TimelineClip[][]>([]);
  const redoRef = useRef<TimelineClip[][]>([]);
  const [, setHistoryVersion] = useState(0);
  const [splitPoint, setSplitPoint] = useState(0);
  const [timelineReadyKey, setTimelineReadyKey] = useState("");
  const [preferencesReadyKey, setPreferencesReadyKey] = useState("");
  const [draftPending, setDraftPending] = useState(false);
  const [scriptDraft, setScriptDraft] = useState("");
  const [savingScript, setSavingScript] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mediaErrorSrc, setMediaErrorSrc] = useState("");
  const [previewTime, setPreviewTime] = useState(0);
  const [overlayEditor, setOverlayEditor] = useState<"caption" | "label" | null>(null);
  const [overlayDraft, setOverlayDraft] = useState("");
  const [overlayCueIndex, setOverlayCueIndex] = useState(-1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captionPreviewSeekRef = useRef<{ segmentId: string; seconds: number } | null>(null);

  const approvedScenes = props.scenes.filter((scene) => scene.sessionId === sessionId && props.takes.some((take) => take.id === scene.selectedTakeId && take.status === "approved")).sort((a, b) => a.position - b.position);
  const approvedTakes = approvedScenes.map((scene) => props.takes.find((take) => take.id === scene.selectedTakeId)).filter(Boolean) as Row[];
  const timelineStorageKey = `segmenta.timeline.v1:${props.portfolioId}:${sessionId}`;
  const preferencesStorageKey = `segmenta.editor-preferences.v1:${props.portfolioId}:${sessionId}`;
  const draftPendingKey = `segmenta.timeline-pending.v1:${props.portfolioId}:${sessionId}`;
  const timelineReviewKey = `segmenta.timeline-review.v1:${props.portfolioId}:${sessionId}`;
  const sourceSignature = approvedScenes.map((scene) => `${scene.id}:${scene.position}:${scene.selectedTakeId}:${scene.script || ""}`).join("|");

  useEffect(() => {
    setAutomaticRequest((current) => current?.sessionId === sessionId ? current : null);
  }, [sessionId]);

  useEffect(() => {
    setAutomaticRunning(false); setAutomaticStage("idle"); setLivePreviews([]); setBusy("");
    return () => { automaticRunRef.current?.abort(); automaticRunRef.current = null; };
  }, [timelineStorageKey, review?.id, manualReviewSession]);

  useEffect(() => {
    setTranscriptionTasks([]); setTranscriptionStage("");
    setBusy((current) => current === "transcribe" ? "" : current);
    return () => {
      const controller = transcriptionRunRef.current;
      transcriptionRunRef.current = null;
      controller?.abort();
    };
  }, [timelineStorageKey, sourceSignature, review?.id, manualReviewSession]);

  useEffect(() => {
    if (!review) return;
    const defaults = approvedScenes.flatMap((scene) => {
      const take = props.takes.find((item) => item.id === scene.selectedTakeId);
      if (!take) return [];
      const duration = Math.max(.2, Number(take.durationMs || 0) / 1000);
      return [{ segmentId: take.id, takeId: take.id, sceneId: scene.id, title: String(scene.title || "Toma"), duration, included: true,
        trimStartSeconds: 0, trimEndSeconds: duration, playbackSpeed: 1, audioVolume: 1, brightness: 0, contrast: 1, saturation: 1,
        transcript: String(scene.script || ""), label: "", captionCues: [] as CaptionCue[], visualResources: [] as VisualResource[], resourcesReviewed: false }];
    });
    let saved: TimelineClip[] = [];
    let savedReviewId = "";
    try { saved = selectedResultId && window.localStorage.getItem(draftPendingKey) !== "1" ? [] : JSON.parse(window.localStorage.getItem(timelineStorageKey) || "[]") as TimelineClip[]; }
    catch { /* Keep the original approved order if the local draft is corrupt. */ }
    try { savedReviewId = window.localStorage.getItem(timelineReviewKey) || ""; } catch { /* Use the confirmed order. */ }
    if (!Array.isArray(saved) || !saved.length) {
      savedReviewId = String(latestJob?.contract?.media_review?.id || "");
      const contractClips = latestJob?.contract?.clips;
      if (Array.isArray(contractClips)) saved = contractClips.map((clip: Row, index: number) => ({
        segmentId: `${String(clip.id)}:${index}`, takeId: String(clip.id), sceneId: String(clip.scene_id || ""),
        trimStartSeconds: clip.trim_start_seconds, trimEndSeconds: clip.trim_end_seconds,
        playbackSpeed: clip.playback_speed, audioVolume: clip.audio_volume,
        brightness: clip.brightness, contrast: clip.contrast, saturation: clip.saturation,
        transcript: clip.transcript, label: clip.label, captionCues: clip.caption_cues,
        visualResources: clip.visual_resources || [], resourcesReviewed: clip.visual_resources_reviewed === true || Boolean(clip.visual_resources?.length),
      })) as TimelineClip[];
    }
    const byId = new Map(defaults.map((clip) => [clip.takeId, clip]));
    const seenTakes = new Set<string>();
    const seenSegments = new Set<string>();
    const restored = Array.isArray(saved) ? saved.flatMap((clip) => {
      const original = byId.get(clip.takeId);
      if (!original) return [];
      const segmentId = String(clip.segmentId || clip.takeId);
      if (seenSegments.has(segmentId)) return [];
      seenSegments.add(segmentId);
      seenTakes.add(clip.takeId);
      // A duration repaired on the server (or in another tab) must also replace
      // the old placeholder draft. Real manual trims retain the source duration.
      if (clip.duration <= .2 && original.duration > .2) clip = repairUnknownTimelineDuration([clip], clip.takeId, original.duration)[0];
      let visualResources: VisualResource[] = [];
      try {
        const parsed = normalizeVisualResources(clip.visualResources || [], { durationSeconds: original.duration });
        visualResources = fitVisualResources(parsed, Math.max(0, Number(clip.trimStartSeconds) || 0), Math.min(original.duration, Number(clip.trimEndSeconds) || original.duration));
      } catch { /* Ignore invalid image data without losing the video or subtitles. */ }
      return [{ ...original, segmentId, included: clip.included !== false, visualResources, resourcesReviewed: clip.resourcesReviewed === true,
        trimStartSeconds: Math.max(0, Math.min(original.duration - .2, Number(clip.trimStartSeconds) || 0)),
        trimEndSeconds: Math.max(.2, Math.min(original.duration, Number(clip.trimEndSeconds) || original.duration)),
        playbackSpeed: draftNumber(clip.playbackSpeed, 1, .5, 2), audioVolume: draftNumber(clip.audioVolume, 1, 0, 2),
        brightness: draftNumber(clip.brightness, 0, -.2, .2), contrast: draftNumber(clip.contrast, 1, .8, 1.3), saturation: draftNumber(clip.saturation, 1, .5, 1.5),
        transcript: String(clip.transcript ?? original.transcript).slice(0, 1000), label: String(clip.label || "").slice(0, 120),
        captionCues: Array.isArray(clip.captionCues) ? clip.captionCues.slice(0, 100) : [] }];
    }) : [];
    const restoredTimeline = [...restored, ...[...byId.values()].filter((clip) => !seenTakes.has(clip.takeId))];
    const next = savedReviewId === review.id ? restoredTimeline : alignReviewedTimeline(restoredTimeline, review.orderedTakeIds);
    try { saveEditorDraft(timelineReviewKey, review.id); } catch { /* Draft persistence can be unavailable. */ }
    timelineRef.current = next;
    undoRef.current = [];
    redoRef.current = [];
    setHistoryVersion((value) => value + 1);
    setTimeline(next);
    setTimelineReadyKey(timelineStorageKey);
  // Only refresh the draft when approved source material changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineStorageKey, sourceSignature, latestJob?.id, review?.id]);

  useEffect(() => {
    let saved: Row | null = null;
    try { saved = selectedResultId && window.localStorage.getItem(draftPendingKey) !== "1" ? null : JSON.parse(window.localStorage.getItem(preferencesStorageKey) || "null") as Row | null; }
    catch { /* Restore the saved render settings if this local draft is corrupt. */ }
    const contract = latestJob?.contract;
    const source = saved || contract;
    if (source) {
      const nextStyle = String(source.style || "");
      if (EDITOR_STYLES.some((item) => item.id === nextStyle)) setStyle(nextStyle as EditorStyleId);
      setObjective(String(source.objective || "Reel vertical profesional: gancho fuerte, ritmo claro y cierre con autoridad."));
      if (saved) {
        if (saved.options) setOptions({ ...saved.options, broll: saved.resourceFeatureVersion === 1 ? saved.options.broll === true : true });
        if (saved.settings) setSettings((current) => ({ ...current, ...saved.settings }));
      } else if (contract) {
        const snapshot = contract.style_snapshot || {};
        setOptions({ captions: contract.captions?.enabled !== false, deadAir: contract.dead_air?.remove !== false,
          transitions: contract.effects?.transitions !== false, soundEffects: contract.effects?.sound_effects !== false,
          labels: contract.effects?.labels !== false, broll: contract.clips?.some((clip: Row) => Array.isArray(clip.visual_resources)) ? contract.effects?.images_or_broll === true : true });
        setSettings({ subtitleSize: draftNumber(snapshot.subtitle?.size, initialStyle.subtitle.size, 38, 100),
          subtitlePosition: ["top", "center", "chest", "bottom"].includes(snapshot.subtitle?.position) ? snapshot.subtitle.position : "bottom",
          silenceThresholdMs: draftNumber(contract.dead_air?.threshold_ms, initialStyle.execution.silenceThresholdMs, 350, 1500),
          silenceNoiseDb: draftNumber(contract.dead_air?.noise_db, -30, -35, -25),
          noiseReduction: ["off", "light", "medium"].includes(snapshot.execution?.noiseReduction) ? snapshot.execution.noiseReduction : "off",
          transition: ["cut", "fade", "dissolve"].includes(snapshot.transition) ? snapshot.transition : "cut",
          soundEffectVolume: draftNumber(snapshot.execution?.soundEffectVolume, initialStyle.execution.soundEffectVolume, 0, 1),
          soundPreset: ["auto", "none", "soft", "kinetic", "cinematic", "pop"].includes(snapshot.execution?.soundPreset) ? snapshot.execution.soundPreset : "auto" });
      }
    } else if (preproduction) {
      setStyle(preproduction.style);
      setObjective(preproduction.description);
      setOptions({ captions: preproduction.technical.captions && preproduction.skills.includes("subtitulos"), deadAir: preproduction.technical.removeSilence && preproduction.skills.includes("recortes"), transitions: preproduction.technical.transitions && preproduction.skills.includes("transiciones"), soundEffects: preproduction.technical.soundEffects && preproduction.skills.includes("audio_fx"), labels: preproduction.technical.labels && preproduction.skills.includes("superposiciones"), broll: true });
      setSettings((current) => ({ ...current, silenceThresholdMs: preproduction.technical.silenceThresholdMs, noiseReduction: preproduction.skills.includes("sonido") ? preproduction.technical.noiseReduction : "off", transition: EDITOR_STYLES.find((item) => item.id === preproduction.style)?.transition || "cut" }));
    } else if (available.find((item) => item.id === sessionId)?.title?.startsWith("Copia del MP4 ·")) {
      setOptions((current) => ({ ...current, captions: false }));
    }
    setPreferencesReadyKey(preferencesStorageKey);
  // Restore preferences once per selected project, without overwriting edits on a job refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferencesStorageKey, latestJob?.id]);

  useEffect(() => {
    if (preferencesReadyKey === preferencesStorageKey) {
      saveEditorDraft(preferencesStorageKey, JSON.stringify({ style, objective, options, settings, resourceFeatureVersion: 1 }));
    }
  }, [preferencesReadyKey, preferencesStorageKey, style, objective, options, settings]);

  useEffect(() => {
    if (timelineReadyKey === timelineStorageKey) setDraftStorageWarning(!saveEditorDraft(timelineStorageKey, JSON.stringify(timeline)));
  }, [timeline, timelineReadyKey, timelineStorageKey]);

  useEffect(() => {
    try { setDraftPending(window.localStorage.getItem(draftPendingKey) === "1"); } catch { setDraftPending(false); }
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
    if (localJob === null) removeEditorDraft(ephemeralStorageKey);
    else if (localJob?.ephemeral && localJob.sessionId === sessionId) saveEditorDraft(ephemeralStorageKey, JSON.stringify(localJob));
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
      saveEditorDraft(resultStorageKey, JSON.stringify(lastResult));
    }
  }, [lastResult, resultStorageKey, sessionId]);

  const chooseStyle = (nextStyle: EditorStyleId) => {
    if (busy || automaticRunning) return;
    const preset = EDITOR_STYLES.find((item) => item.id === nextStyle) || EDITOR_STYLES[0];
    setStyle(nextStyle);
    setSettings((current) => ({ ...current, subtitleSize: preset.subtitle.size, subtitlePosition: preset.subtitle.position, silenceThresholdMs: preset.execution.silenceThresholdMs, silenceNoiseDb: -30, transition: preset.transition, soundEffectVolume: preset.execution.soundEffectVolume, soundPreset: "auto" }));
    setJob(null);
    setDraftPending(true);
    saveEditorDraft(draftPendingKey, "1");
  };

  const changeOptions = (next: Partial<typeof options>) => {
    if (busy || automaticRunning) return;
    setOptions((current) => ({ ...current, ...next }));
    setJob(null);
    setDraftPending(true);
    saveEditorDraft(draftPendingKey, "1");
  };

  const changeSettings = (next: Partial<typeof settings>) => {
    if (busy || automaticRunning) return;
    setSettings((current) => ({ ...current, ...next }));
    setJob(null);
    setDraftPending(true);
    saveEditorDraft(draftPendingKey, "1");
  };

  const changeTimeline = (next: TimelineClip[] | ((current: TimelineClip[]) => TimelineClip[])) => {
    if (busy || automaticRunning) return;
    const current = timelineRef.current;
    const updated = typeof next === "function" ? next(current) : next;
    if (updated === current) return false;
    try { validateVisualResourceBudget(updated.filter((clip) => clip.included).flatMap((clip) => clip.visualResources)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Revisa las imágenes del montaje."); return false; }
    undoRef.current = [...undoRef.current.slice(-29), current];
    redoRef.current = [];
    timelineRef.current = updated;
    setTimeline(updated);
    setHistoryVersion((value) => value + 1);
    setJob(null);
    setDraftPending(true);
    saveEditorDraft(draftPendingKey, "1");
    return true;
  };

  const undoTimeline = () => {
    if (busy || !undoRef.current.length) return;
    const previous = undoRef.current.pop()!;
    redoRef.current.push(timelineRef.current);
    timelineRef.current = previous;
    setTimeline(previous);
    setHistoryVersion((value) => value + 1);
    setJob(null); setDraftPending(true); saveEditorDraft(draftPendingKey, "1");
  };

  const redoTimeline = () => {
    if (busy || !redoRef.current.length) return;
    const next = redoRef.current.pop()!;
    undoRef.current.push(timelineRef.current);
    timelineRef.current = next;
    setTimeline(next);
    setHistoryVersion((value) => value + 1);
    setJob(null); setDraftPending(true); saveEditorDraft(draftPendingKey, "1");
  };

  const updateClip = (segmentId: string, patch: Partial<TimelineClip>) => changeTimeline((current) => current.map((clip) => {
    if (clip.segmentId !== segmentId) return clip;
    const next = { ...clip, ...patch };
    if (patch.trimStartSeconds !== undefined || patch.trimEndSeconds !== undefined) next.visualResources = fitVisualResources(next.visualResources, next.trimStartSeconds, next.trimEndSeconds);
    return next;
  }));

  const moveClip = (segmentId: string, offset: number) => changeTimeline((current) => {
    const next = [...current];
    const from = next.findIndex((clip) => clip.segmentId === segmentId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= next.length) return current;
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });

  const selectedSession = available.find((item) => item.id === sessionId);
  const activeTimeline = timeline.filter((clip) => clip.included);
  const editorialPlan = useMemo(() => planFromScript(scriptDraft, timeline.filter((clip) => clip.included).map((clip) => ({ id: clip.segmentId, title: clip.title, transcript: clip.transcript }))), [scriptDraft, timeline]);
  useEffect(() => {
    setScriptDraft(String(selectedSession?.script || ""));
  }, [sessionId, selectedSession?.script]);
  const selectedStyle = EDITOR_STYLES.find((item) => item.id === style) || EDITOR_STYLES[0];
  // A gallery request names a source take, while the editor selects a segment.
  // Do not flash a different source while approval or draft restoration finishes.
  const selectedClip = galleryEntryPending ? timeline.find((clip) => clip.takeId === props.initialTakeId)
    : timeline.find((clip) => clip.segmentId === selectedTakeId) || timeline[0];
  const selectedTake = approvedTakes.find((take) => take.id === selectedClip?.takeId) || (galleryEntryPending ? undefined : approvedTakes[0]);
  const selectedSegmentId = selectedClip?.segmentId;
  useEffect(() => {
    if (!galleryEntryPending || !reviewConfirmed || galleryTakeNeedsReview || manualReviewSession === sessionId
        || timelineReadyKey !== timelineStorageKey) return;
    const clip = timeline.find((item) => item.takeId === props.initialTakeId && item.included)
      || timeline.find((item) => item.takeId === props.initialTakeId);
    if (!clip) return;
    setSelectedTakeId(clip.segmentId);
    setPreviewMode("original"); setOverlayEditor(null);
    captionPreviewSeekRef.current = { segmentId: clip.segmentId, seconds: clip.trimStartSeconds };
    setPreviewTime(clip.trimStartSeconds);
    if (props.initialManualSegmentation) { setTool("video"); setSegmentationFocus(clip.segmentId); }
    setAppliedGalleryEntry(galleryEntryKey);
  }, [galleryEntryPending, galleryEntryKey, reviewConfirmed, galleryTakeNeedsReview, manualReviewSession, sessionId, timelineReadyKey, timelineStorageKey, timeline, props.initialTakeId, props.initialManualSegmentation]);
  useEffect(() => {
    if (!segmentationFocus || selectedSegmentId !== segmentationFocus || !reviewConfirmed || manualReviewSession === sessionId || tool !== "video") return;
    const frame = window.requestAnimationFrame(() => {
      const heading = document.getElementById("editor-manual-segmentation-title");
      const panel = document.getElementById("editor-manual-segmentation");
      if (!heading || !panel) return;
      heading.focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      setSegmentationFocus("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [segmentationFocus, selectedSegmentId, reviewConfirmed, manualReviewSession, sessionId, tool]);
  const previewCueIndex = selectedClip?.captionCues.findIndex((cue) => previewTime >= cue.startSeconds && previewTime < cue.endSeconds) ?? -1;
  const previewCue = previewCueIndex >= 0 ? selectedClip?.captionCues[previewCueIndex] : undefined;
  const cueWords = previewCue?.text.trim().split(/\s+/).filter(Boolean) || [];
  const cardSize = Math.max(1, selectedStyle.subtitle.maxWords);
  const cardCount = Math.ceil(cueWords.length / cardSize);
  const cardProgress = previewCue ? (previewTime - previewCue.startSeconds) / Math.max(.01, previewCue.endSeconds - previewCue.startSeconds) : 0;
  const cardIndex = Math.min(Math.max(0, cardCount - 1), Math.floor(cardProgress * cardCount));
  const previewCaption = cueWords.slice(cardIndex * cardSize, (cardIndex + 1) * cardSize).join(" ");
  // Skill «Subtítulos cinéticos»: the editor shows the same single word, timing and color as the MP4.
  const kineticCaptions = selectedStyle.subtitle.mode === "palabra";
  const kineticPreviewWords = useMemo(() => kineticCaptions && selectedClip ? planKineticCaptions(selectedClip.captionCues, { uppercase: selectedStyle.subtitle.uppercase }) : [], [kineticCaptions, selectedClip, selectedStyle.subtitle.uppercase]);
  const kineticPreviewWord = kineticPreviewWords.find((word) => previewTime >= word.startSeconds && previewTime < word.endSeconds);
  // Audio for the editing room: the same 16 kHz window the recognizer uses; a take without audio stays silent.
  const loadSalaAudio = useCallback(async (clip: SalaClip, signal: AbortSignal) => {
    const takeId = (clip as SalaClip & { takeId?: string }).takeId;
    if (!takeId) return null;
    const start = Math.max(0, clip.window.start);
    const params = new URLSearchParams({ startSeconds: String(start), endSeconds: String(Math.min(clip.window.end, start + 120)) });
    const response = await fetch(`/api/media/${encodeURIComponent(takeId)}/audio?${params}`, { cache: "no-store", signal });
    if (!response.ok) return null;
    return { samples: decodeSpeechWav(await response.arrayBuffer()), sampleRate: SPEECH_SAMPLE_RATE };
  }, []);
  const layeredStyle = style === "ia-en-capas";
  const layeredHeader = (selectedClip?.label || (!/^edici[oó]n de \d+ videos?$/i.test(String(selectedSession?.title || "")) ? String(selectedSession?.title || "") : "") || scriptDraft.split(/\n/).map((line) => line.replace(/[*#_]/g, "").trim()).find(Boolean) || "").slice(0, 56);
  const previewCaptionWords = previewCaption.trim().split(/\s+/).filter(Boolean);
  useEffect(() => {
    const clip = timelineRef.current.find((item) => item.segmentId === selectedSegmentId);
    if (clip) setSplitPoint(Number(((clip.trimStartSeconds + clip.trimEndSeconds) / 2).toFixed(1)));
  }, [selectedSegmentId]);
  const needsPlan = !job || draftPending || job.contract?.media_review?.id !== review?.id;
  const ready = job?.status === "ready" && !needsPlan;
  const previousReadyJob = props.editJobs.find((item) => item.sessionId === sessionId && item.status === "ready");
  const activeResult = ready ? job : latestJob?.status === "ready" ? latestJob : previousReadyJob || (lastResult?.sessionId === sessionId ? lastResult : null);
  const resultIsPrevious = Boolean(activeResult && (needsPlan || job?.status !== "ready"));
  const showingFinal = Boolean(activeResult && previewMode === "final");
  const resultSrc = activeResult ? `/api/editor/output/${activeResult.id}` : "";
  const livePreview = livePreviews.find((item) => item.clipIndex === livePreviewIndex) || livePreviews.at(-1);
  const showingLive = Boolean(livePreview && previewMode === "live");
  const showingRendered = showingFinal || showingLive;
  const previewSrc = showingLive ? livePreview!.videoDataUrl : showingFinal ? resultSrc : selectedTake ? `/api/media/${selectedTake.id}` : "";
  useEffect(() => {
    if (!videoRef.current || showingRendered || !selectedClip) return;
    videoRef.current.playbackRate = selectedClip.playbackSpeed;
    videoRef.current.volume = Math.min(1, selectedClip.audioVolume);
  }, [selectedClip, showingRendered, previewSrc]);
  useEffect(() => {
    const seek = captionPreviewSeekRef.current;
    const video = videoRef.current;
    if (!seek || showingRendered || selectedSegmentId !== seek.segmentId || !video || video.readyState < 1) return;
    video.pause(); video.currentTime = seek.seconds; setPreviewTime(seek.seconds);
    captionPreviewSeekRef.current = null;
  }, [timeline, selectedSegmentId, showingRendered]);
  const resultMetadata = activeResult?.resultMetadata || {};
  const resultStyle = EDITOR_STYLES.find((item) => item.id === resultMetadata.style_id)?.name || "Estilo no registrado";
  const missingTimedTakes = [...new Set(activeTimeline.filter((clip) => !clip.captionCues.length).map((clip) => clip.takeId))];
  const showCaptionTools = () => {
    setTool("text");
    document.getElementById("editor-workbench")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const reviewCaptionText = () => {
    setPreviewMode("original");
    document.getElementById("editor-caption-text")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const transcribeMissingTakes = async (scope: "missing" | "selected" = "missing", signal?: AbortSignal): Promise<boolean> => {
    if (busy || transcriptionRunRef.current || !reviewConfirmed || signal?.aborted) return false;
    const controller = new AbortController();
    transcriptionRunRef.current = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const isCurrent = () => transcriptionRunRef.current === controller && !controller.signal.aborted;
    setBusy("transcribe"); setError(""); setTool("text"); setTranscriptionStage("Preparando subtítulos automáticos…");
    let targets: ReturnType<typeof getCaptionGenerationTargets> = [];
    setTranscriptionTasks([]);
    const updateTask = (takeId: string, patch: Partial<CaptionTask>) => {
      if (isCurrent()) setTranscriptionTasks((current) => current.map((item) => item.takeId === takeId ? { ...item, ...patch } : item));
    };
    let generated = 0;
    let failed = 0;
    try {
      // Old uploads may have no duration. Resolve it from the actual file before
      // treating the 0.2-second UI placeholder as an intentional trim.
      const unknown = [...new Set(timelineRef.current.filter((clip) => (scope === "selected" ? clip.segmentId === selectedClip?.segmentId : clip.included) &&
        !(Number(props.takes.find((take) => take.id === clip.takeId)?.durationMs) > 0)).map((clip) => clip.takeId))];
      for (const takeId of unknown) {
        setTranscriptionStage("Comprobando la duración real del video…");
        const response = await fetch(`/api/media/${encodeURIComponent(takeId)}/audio`, { method: "HEAD", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("No pudimos leer la duración de una toma. Tu material y los subtítulos anteriores se conservan.");
        const duration = Number(response.headers.get("X-Source-Duration-Seconds"));
        if (!(duration > 0) || !Number.isFinite(duration)) throw new Error("No pudimos medir la duración del video. Intenta subir de nuevo únicamente esa toma.");
        if (!isCurrent()) return false;
        const repaired = repairUnknownTimelineDuration(timelineRef.current, takeId, duration);
        timelineRef.current = repaired; setTimeline(repaired);
        saveEditorDraft(timelineStorageKey, JSON.stringify(repaired));
      }
      targets = getCaptionGenerationTargets(timelineRef.current, { scope, selectedSegmentId: selectedClip?.segmentId });
      setTranscriptionTasks(targets.map((target) => ({ takeId: target.takeId, title: timelineRef.current.find((clip) => clip.takeId === target.takeId)?.title || "Toma", status: "pending" })));
      for (const [index, target] of targets.entries()) {
        if (!isCurrent()) break;
        updateTask(target.takeId, { status: "processing", detail: "Preparando audio", percent: undefined });
        try {
          const result = await transcribeTakeInBrowser({
            takeId: target.takeId, durationSeconds: target.durationSeconds, ranges: target.ranges, maxWords: selectedStyle.subtitle.maxWords, signal: controller.signal,
            onProgress: (stage, percent) => {
              if (!isCurrent()) return;
              setTranscriptionStage(`Toma ${index + 1} de ${targets.length} · ${stage}`);
              updateTask(target.takeId, { detail: stage, percent });
            },
          });
          if (!isCurrent()) break;
          const current = timelineRef.current;
          const merged = mergeCaptionGenerationResult(current, target, result);
          if (merged.updatedSegmentIds.length) {
            undoRef.current = [...undoRef.current.slice(-29), current]; redoRef.current = [];
            timelineRef.current = merged.timeline; setTimeline(merged.timeline); setHistoryVersion((value) => value + 1);
            setOptions((currentOptions) => ({ ...currentOptions, captions: true }));
            setPreviewMode("original");
            {
              const first = merged.timeline.find((clip) => clip.segmentId === merged.updatedSegmentIds[0])!;
              captionPreviewSeekRef.current = { segmentId: first.segmentId, seconds: first.captionCues[0].startSeconds + .01 };
              setSelectedTakeId(first.segmentId);
            }
            generated += merged.updatedSegmentIds.length;
            setJob(null); setDraftPending(true);
            try {
              // Save every completed take so a later failure/cancellation never loses earlier work.
              if (!saveEditorDraft(timelineStorageKey, JSON.stringify(merged.timeline)) || !saveEditorDraft(draftPendingKey, "1")) {
                setError("Los subtítulos están en pantalla. Este navegador no pudo guardar el borrador; mantén la pestaña abierta hasta terminar la exportación.");
              }
            } catch { setError("Los subtítulos están listos en pantalla, pero este navegador no pudo guardar el borrador. Evita cerrar la pestaña antes de preparar la edición."); }
          }
          const problems = [...merged.failedSegments.map((item) => item.message), ...(merged.skippedSegmentIds.length ? ["Se conservó un segmento que cambió durante la generación."] : [])];
          if (problems.length) failed++;
          updateTask(target.takeId, { status: problems.length ? "error" : "done", detail: problems.length ? [...new Set(problems)].join(" ") : "Subtítulos generados. Revisa las palabras.", percent: undefined });
        } catch (reason) {
          if (!isCurrent()) break;
          failed++;
          updateTask(target.takeId, { status: "error", detail: reason instanceof Error ? reason.message : "No pudimos transcribir esta toma.", percent: undefined });
        }
      }
      if (transcriptionRunRef.current === controller) setTranscriptionStage(controller.signal.aborted
        ? `Generación detenida. Se conserva${generated === 1 ? "" : "n"} ${generated} segmento${generated === 1 ? "" : "s"} generado${generated === 1 ? "" : "s"}; puedes continuar con los pendientes.`
        : failed ? `Se generó${generated === 1 ? "" : " un total de"} ${generated} segmento${generated === 1 ? "" : "s"}. Revisa las tomas con aviso y vuelve a intentar las pendientes.`
        : `Subtítulos listos en ${generated} ${generated === 1 ? "segmento" : "segmentos"}. Continuando con la edición…`);
      return isCurrent() && !failed;
    } catch (reason) {
      if (isCurrent()) {
        const message = reason instanceof Error ? reason.message : "No pudimos preparar la voz de esta toma.";
        setError(message); setTranscriptionStage(message);
      }
      return false;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (transcriptionRunRef.current === controller) { transcriptionRunRef.current = null; setBusy(""); }
    }
  };
  const openOverlayEditor = (kind: "caption" | "label") => {
    if (!selectedClip || busy) return;
    videoRef.current?.pause();
    const futureCueIndex = selectedClip.captionCues.findIndex((cue) => cue.startSeconds > previewTime);
    const nextCueIndex = previewCueIndex >= 0 ? previewCueIndex : selectedClip.captionCues.length ? futureCueIndex >= 0 ? futureCueIndex : selectedClip.captionCues.length - 1 : -1;
    setOverlayCueIndex(nextCueIndex);
    setOverlayDraft(kind === "label" ? selectedClip.label : nextCueIndex >= 0 ? selectedClip.captionCues[nextCueIndex].text : selectedClip.transcript);
    setOverlayEditor(kind);
  };
  const applyOverlayEditor = () => {
    if (!selectedClip || !overlayEditor) return;
    if (overlayEditor === "label") updateClip(selectedClip.segmentId, { label: overlayDraft.trim() });
    else if (overlayCueIndex >= 0) {
      // Keep per-word timing when the correction keeps the same number of words.
      const captionCues = selectedClip.captionCues.map((cue, index) => index === overlayCueIndex ? retimeEditedCue(cue, overlayDraft.trim()) : cue);
      updateClip(selectedClip.segmentId, { captionCues, transcript: captionCues.map((cue) => cue.text).filter(Boolean).join(" ") });
    } else updateClip(selectedClip.segmentId, { transcript: overlayDraft.trim(), captionCues: [] });
    setOverlayEditor(null);
  };
  const changeScriptDraft = (value: string) => {
    if (busy || automaticRunning || savingScript) return;
    setScriptDraft(value.slice(0, 6_000));
    setJob(null);
    setDraftPending(true);
    saveEditorDraft(draftPendingKey, "1");
  };

  const ensureScriptSaved = async (deferRefresh = false) => {
    const script = scriptDraft.trim();
    if (script === String(selectedSession?.script || "").trim()) return;
    await request("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_session_script", sessionId, script }) });
    if (!deferRefresh) await props.onRefresh();
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
    updateClip(clip.segmentId, { transcript, captionCues: cues.map((cue) => ({ ...cue, endSeconds: Math.min(clip.duration, cue.endSeconds) })) });
    setError("");
  };

  const applySuggestedOrder = () => {
    if (!editorialPlan.reliableOrder) return;
    const ranks = new Map(editorialPlan.suggestedClipIds.map((id, index) => [id, index]));
    changeTimeline((current) => [...current].sort((a, b) => (ranks.get(a.segmentId) ?? 999) - (ranks.get(b.segmentId) ?? 999)));
  };

  const splitClip = () => {
    if (!selectedClip || busy) return;
    if (timelineRef.current.length >= 12) { setError("El render cloud admite hasta 12 segmentos. Excluye alguno antes de dividir."); return; }
    const cut = Number(splitPoint);
    if (!Number.isFinite(cut) || cut - selectedClip.trimStartSeconds < .2 || selectedClip.trimEndSeconds - cut < .2) {
      setError("El punto de corte debe dejar al menos 0,2 segundos a cada lado."); return;
    }
    const words = selectedClip.transcript.trim().split(/\s+/).filter(Boolean);
    const fraction = (cut - selectedClip.trimStartSeconds) / (selectedClip.trimEndSeconds - selectedClip.trimStartSeconds);
    const wordIndex = Math.max(1, Math.min(words.length - 1, Math.round(words.length * fraction)));
    const leftCues = selectedClip.captionCues.map((cue) => splitCueAt(cue, cut, "left")).filter((cue) => cue.text && cue.endSeconds - cue.startSeconds >= .1);
    const rightCues = selectedClip.captionCues.map((cue) => splitCueAt(cue, cut, "right")).filter((cue) => cue.text && cue.endSeconds - cue.startSeconds >= .1);
    const left = { ...selectedClip, trimEndSeconds: cut, transcript: leftCues.length ? leftCues.map((cue) => cue.text).join(" ") : words.slice(0, wordIndex).join(" "), captionCues: leftCues, visualResources: fitVisualResources(selectedClip.visualResources, selectedClip.trimStartSeconds, cut) };
    const right = { ...selectedClip, segmentId: crypto.randomUUID(), trimStartSeconds: cut, transcript: rightCues.length ? rightCues.map((cue) => cue.text).join(" ") : words.slice(wordIndex).join(" "), label: "", captionCues: rightCues, visualResources: fitVisualResources(selectedClip.visualResources, cut, selectedClip.trimEndSeconds).map((item) => ({ ...item, id: crypto.randomUUID() })) };
    if (!changeTimeline((current) => current.flatMap((clip) => clip.segmentId === selectedClip.segmentId ? [left, right] : [clip]))) return;
    setSelectedTakeId(right.segmentId);
    setError("");
  };

  const duplicateClip = () => {
    if (!selectedClip || busy) return;
    if (timelineRef.current.length >= 12) { setError("El render cloud admite hasta 12 segmentos."); return; }
    const copy = { ...selectedClip, segmentId: crypto.randomUUID(), visualResources: selectedClip.visualResources.map((item) => ({ ...item, id: crypto.randomUUID() })) };
    if (!changeTimeline((current) => { const index = current.findIndex((clip) => clip.segmentId === selectedClip.segmentId); const next = [...current]; next.splice(index + 1, 0, copy); return next; })) return;
    setSelectedTakeId(copy.segmentId);
  };

  const changeResources = (segmentId: string, resources: VisualResource[]) => {
    const clip = timelineRef.current.find((item) => item.segmentId === segmentId);
    if (!clip || busy || automaticRunning) return;
    try {
      const normalized = normalizeVisualResources(resources, { durationSeconds: clip.duration, trimStartSeconds: clip.trimStartSeconds, trimEndSeconds: clip.trimEndSeconds });
      if (updateClip(segmentId, { visualResources: normalized, resourcesReviewed: true })) { setResourceMessage(""); setError(""); setPreviewMode("original"); return true; }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Revisa la imagen."); }
  };

  const addVisualResource = (segmentId: string, image: VisualResourceImage) => {
    const clip = timelineRef.current.find((item) => item.segmentId === segmentId);
    if (!clip || busy || automaticRunning) return;
    const start = Math.min(clip.trimEndSeconds - .15, Math.max(clip.trimStartSeconds, segmentId === selectedClip?.segmentId ? previewTime : clip.trimStartSeconds));
    const keyword = image.kind === "builtin" ? VISUAL_RESOURCE_CATALOG.find((asset) => asset.id === image.assetId)!.title : image.title.slice(0, 60);
    if (changeResources(segmentId, [...clip.visualResources, { id: crypto.randomUUID(), keyword, startSeconds: start, endSeconds: Math.min(clip.trimEndSeconds, start + 2.6), layout: "corner", image }])) changeOptions({ broll: true });
  };

  const replaceVisualResource = (segmentId: string, id: string, image: VisualResourceImage) => {
    const clip = timelineRef.current.find((item) => item.segmentId === segmentId);
    if (!clip?.visualResources.some((item) => item.id === id)) return;
    changeResources(segmentId, clip.visualResources.map((item) => item.id === id ? { ...item, image } : item));
  };

  const seekVisualResource = (segmentId: string, time: number) => {
    videoRef.current?.pause();
    captionPreviewSeekRef.current = { segmentId, seconds: time };
    if (selectedClip?.segmentId === segmentId && !showingRendered && videoRef.current) { videoRef.current.currentTime = time; captionPreviewSeekRef.current = null; }
    setSelectedTakeId(segmentId); setPreviewMode("original"); setOverlayEditor(null); setPreviewTime(time);
    videoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const applyVisualRecommendations = (automatic = false) => {
    if (!automatic && (busy || automaticRunning)) return;
    const current = timelineRef.current;
    const proposals = recommendVisualResources(current);
    const next = current.map((clip) => !clip.included || clip.resourcesReviewed || clip.visualResources.length || !clip.captionCues.length || !proposals[clip.segmentId]?.length ? clip : { ...clip, visualResources: proposals[clip.segmentId] || [], resourcesReviewed: true });
    const count = Object.values(proposals).reduce((sum, resources) => sum + resources.length, 0);
    if (automatic) {
      undoRef.current = [...undoRef.current.slice(-29), current]; redoRef.current = [];
      timelineRef.current = next; setTimeline(next); setHistoryVersion((value) => value + 1);
      setDraftPending(true); saveEditorDraft(draftPendingKey, "1");
    } else { changeTimeline(next); changeOptions({ broll: true }); setPreviewMode("original"); }
    setResourceMessage(count ? `${count} imágenes añadidas en los momentos de voz correspondientes.` : "No hay nuevas coincidencias. Puedes elegir una imagen o subir una foto; tus decisiones anteriores se conservan.");
  };

  const plan = async (draft: TimelineClip[] = timelineRef.current, planOptions = options, signal?: AbortSignal, automaticCaptions = false): Promise<Row | null> => {
    const activeDraft = draft.filter((clip) => clip.included);
    const scriptPlan = planFromScript(scriptDraft, activeDraft.map((clip) => ({ id: clip.segmentId, title: clip.title, transcript: clip.transcript })));
    const isCurrent = () => !signal?.aborted;
    if (!reviewConfirmed) { setManualReviewSession(sessionId); return null; }
    if (!activeDraft.length) { setError("Activa al menos una toma en la línea de tiempo."); return null; }
    if (activeDraft.length > 12) { setError("Este montaje admite hasta 12 segmentos activos. Desactiva o elimina algunos cortes de la línea de tiempo; tus originales se conservan."); return null; }
    if (planOptions.captions && activeDraft.some((clip) => !clip.transcript.trim() || !clip.captionCues.length)) {
      setError("Para exportar subtítulos sincronizados, escucha las tomas con IA local o importa SRT/VTT con tiempos. No repartiremos el libreto a ciegas.");
      return null;
    }
    setBusy("plan"); setError("");
    try {
      signal?.throwIfAborted();
      await ensureScriptSaved(Boolean(signal));
      signal?.throwIfAborted();
      const orderedTimeline = draft;
      const labels = new Map<string, string>();
      if (planOptions.labels && scriptPlan.reliableOrder) {
        for (const resource of scriptPlan.resources) {
          if (!resource.generatedLabel || labels.size >= 5) continue;
          const match = scriptPlan.matches.filter((item) => item.beatIndex === resource.beatIndex)
            .sort((a, b) => a.sequenceOffset - b.sequenceOffset)[0];
          if (match && !labels.has(match.clipId)) labels.set(match.clipId, resource.generatedLabel.slice(0, 56));
        }
      }
      const plannedTimeline = labels.size
        ? orderedTimeline.map((clip) => clip.label.trim() || !labels.has(clip.segmentId) ? clip : { ...clip, label: labels.get(clip.segmentId)! })
        : orderedTimeline;
      const effectiveSkills: Partial<Record<string, boolean>> = { subtitulos: planOptions.captions, recortes: planOptions.deadAir, audio_fx: planOptions.soundEffects, transiciones: planOptions.transitions, superposiciones: planOptions.labels, generador: planOptions.broll };
      const skillProfiles = loadSkillProfiles(props.portfolioId).map((profile) => preproduction
        ? { ...profile, enabled: effectiveSkills[profile.id] ?? preproduction.skills.includes(profile.id) }
        : profile).map((profile) => profile.id === "generador" ? { ...profile, enabled: planOptions.broll } : profile).map((profile) => automaticCaptions && profile.id === "subtitulos"
          ? { ...profile, enabled: true, settings: { ...profile.settings, enabled: true } } : profile);
      const result = await request<{ job: Row }>("/api/editor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, style, objective, options: planOptions, settings, timeline: plannedTimeline.filter((clip) => clip.included), skillProfiles }), signal });
      signal?.throwIfAborted();
      if (plannedTimeline !== timelineRef.current) {
        undoRef.current = [...undoRef.current.slice(-29), timelineRef.current];
        redoRef.current = [];
        timelineRef.current = plannedTimeline;
        setTimeline(plannedTimeline);
        setHistoryVersion((value) => value + 1);
      }
      setJob(result.job);
      setSelectedResultId(result.job.id);
      setDraftPending(false);
      removeEditorDraft(draftPendingKey);
      if (result.job.ephemeral) saveEditorDraft(ephemeralStorageKey, JSON.stringify(result.job));
      else if (!signal) await props.onRefresh();
      return result.job;
    } catch (reason) { if (isCurrent()) setError(reason instanceof Error ? reason.message : "No se pudo crear el plan."); return null; }
    finally { if (isCurrent()) setBusy(""); }
  };

  const render = async (preparedJob?: Row, signal?: AbortSignal): Promise<Row | null> => {
    if (!reviewConfirmed) { setManualReviewSession(sessionId); return null; }
    const renderJob = preparedJob || job;
    if (!renderJob) return null;
    const isCurrent = () => !signal?.aborted;
    signal?.throwIfAborted();
    setBusy("render"); setError(""); setLivePreviews([]); setPreviewMode("original");
    setJob({ ...renderJob, status: "processing", progress: 0, stage: "Enviando el plan al servidor", error: null });
    try {
      const completedJob = await streamRender(renderJob, (progress, stage) => {
        if (isCurrent()) setJob((current) => ({ ...(current || renderJob), status: "processing", progress, stage, error: null }));
      }, (preview) => {
        if (!isCurrent()) return;
        setLivePreviews((current) => [...current.filter((item) => item.clipIndex !== preview.clipIndex), preview].slice(-12));
        setLivePreviewIndex(preview.clipIndex); setPreviewMode("live");
      });
      signal?.throwIfAborted();
      setJob(completedJob);
      if (completedJob.ephemeral) saveEditorDraft(ephemeralStorageKey, JSON.stringify(completedJob));
      if (completedJob.status === "ready") {
        saveEditorDraft(resultStorageKey, JSON.stringify(completedJob));
        setLastResult(completedJob); setPreviewMode("final"); setDraftPending(false);
        removeEditorDraft(draftPendingKey);
      }
      if (!completedJob.ephemeral && !signal) await props.onRefresh();
      return completedJob.status === "ready" ? completedJob : null;
    } catch (reason) {
      if (!isCurrent()) return null;
      const message = reason instanceof Error ? reason.message : "No se pudo renderizar el video.";
      setError(message);
      setJob((current) => ({ ...(current || renderJob), status: reason instanceof RenderStatusUnconfirmedError ? "unconfirmed" : "failed", stage: reason instanceof RenderStatusUnconfirmedError ? "Resultado sin confirmar" : "Render falló", progress: 0, error: message }));
      return null;
    }
    finally { if (isCurrent()) setBusy(""); }
  };

  const editAutomatically = async () => {
    if (busy || automaticRunRef.current) return;
    if (!reviewConfirmed) { setManualReviewSession(sessionId); return; }
    if (!timelineRef.current.some((clip) => clip.included)) { setError("Incluye al menos una toma para editar."); return; }
    if (job?.status === "processing" || job?.status === "unconfirmed") {
      setError("Hay una exportación sin confirmar. Comprueba Mis videos antes de iniciar otra."); return;
    }
    const controller = new AbortController();
    automaticRunRef.current = controller; setAutomaticRunning(true); setError(""); setOverlayEditor(null);
    setPreviewMode("original"); setLivePreviews([]);
    document.getElementById("editor-live-progress")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const automaticOptions = { ...options, captions: true };
    setOptions(automaticOptions);
    let completed = false;
    try {
      await runAutomaticEdit({
        signal: controller.signal,
        transcribe: () => transcribeMissingTakes("missing", controller.signal),
        addResources: automaticOptions.broll ? () => applyVisualRecommendations(true) : undefined,
        captureDraft: () => timelineRef.current,
        prepare: (draft) => plan(draft, automaticOptions, controller.signal, true),
        render: (preparedJob) => render(preparedJob, controller.signal),
        onStage: setAutomaticStage,
      });
      completed = true;
    } catch (reason) {
      if (automaticRunRef.current !== controller) return;
      setAutomaticStage(controller.signal.aborted ? "cancelled" : "error");
      if (!controller.signal.aborted) setError((current) => current || (reason instanceof Error ? reason.message : "La edición se detuvo. Tus avances se conservan."));
    } finally {
      if (automaticRunRef.current === controller) { automaticRunRef.current = null; setAutomaticRunning(false); setBusy(""); }
      if (completed) void props.onRefresh().catch(() => { /* The ready result is already visible. */ });
    }
  };

  useEffect(() => {
    if (!automaticRequest || automaticRequest.sessionId !== sessionId || automaticRequest.reviewId !== review?.id
      || timelineReadyKey !== timelineStorageKey || preferencesReadyKey !== preferencesStorageKey || !timeline.length) return;
    setAutomaticRequest(null);
    void editAutomatically();
  // A confirmed review is a one-shot intent, never an automatic rerun when drafts/jobs change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automaticRequest, sessionId, review?.id, timelineReadyKey, preferencesReadyKey, timeline.length]);

  const togglePlayback = async () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      try { await videoRef.current.play(); setPlaying(true); }
      catch { setMediaErrorSrc(previewSrc); }
    }
    else { videoRef.current.pause(); setPlaying(false); }
  };

  if (selectedSession && (!reviewConfirmed || manualReviewSession === sessionId || galleryTakeNeedsReview)) return <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0c12] sm:rounded-3xl">
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
      <button onClick={props.onBack} aria-label="Volver a proyectos" className="grid h-10 w-10 place-items-center rounded-xl border border-white/10"><ChevronLeft size={18} /></button>
      <div className="min-w-0 flex-1"><p className="text-xs text-violet-300">Antes de editar</p><h2 className="truncate text-sm font-semibold">{selectedSession.title}</h2></div>
      <select aria-label="Proyecto por revisar" value={sessionId} onChange={(event) => { transcriptionRunRef.current?.abort(); setSessionId(event.target.value); setJob(undefined); setManualReviewSession(""); }} className="max-w-full rounded-xl border border-white/10 bg-[#151822] p-2 text-xs sm:max-w-[220px]">{available.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
    </header>
    {galleryEntryPending && <p role="status" className="border-b border-violet-400/15 bg-violet-400/5 px-4 py-3 text-xs leading-5 text-violet-100">Para segmentar el video que elegiste en la galería, aprueba esa toma y confirma el orden. Después abrirás sus controles de recorte y división.</p>}
    {!reviewLoaded ? <p role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-400"><LoaderCircle size={18} className="animate-spin" />Cargando revisión de tomas…</p> : reviewState.error ? <div role="alert" className="p-6"><p className="text-sm text-red-200">{reviewState.error}</p><button onClick={() => setReviewReload((value) => value + 1)} className="mt-4 rounded-xl bg-violet-500 px-4 py-3 text-sm">Reintentar</button></div> : <MediaReviewPanel
      key={`${sessionId}:${reviewReload}`}
      session={{ id: String(selectedSession.id), title: selectedSession.title, script: selectedSession.script }}
      scenes={props.scenes.filter((scene) => scene.sessionId === sessionId).map((scene) => ({ id: String(scene.id), sessionId, title: scene.title, script: scene.script, position: scene.position, selectedTakeId: scene.selectedTakeId }))}
      takes={props.takes.filter((take) => take.sessionId === sessionId).map((take) => ({ id: String(take.id), sceneId: String(take.sceneId), sessionId, status: take.status, durationMs: take.durationMs, createdAt: take.createdAt }))}
      onBack={() => reviewConfirmed && !galleryTakeNeedsReview ? setManualReviewSession("") : props.onBack()}
      offerAutomaticEdit={!(props.initialManualSegmentation && gallerySessionId === sessionId)}
      onConfirmed={async (confirmedReview, automatic) => {
        setJob(null); setDraftPending(true); saveEditorDraft(draftPendingKey, "1");
        await props.onRefresh();
        setAutomaticRequest(automatic ? { sessionId, reviewId: confirmedReview.id } : null);
        setManualReviewSession(""); setReviewReload((value) => value + 1);
      }}
    />}
  </section>;

  return <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0c12] shadow-2xl sm:rounded-3xl">
    <header className="flex flex-wrap items-center gap-3 border-b border-white/8 bg-[#0d1018] px-3 py-2.5 sm:px-4">
      <button onClick={props.onBack} className="grid h-9 w-9 place-items-center rounded-xl text-zinc-500 hover:bg-white/5 hover:text-white"><ChevronLeft size={18} /></button>
      <div className="min-w-0"><p className="truncate text-sm font-medium">{selectedSession?.title || "Nuevo proyecto"}</p><p className="text-[9px] text-zinc-600">{selectedSession ? "Guardado automáticamente" : "Añade material para comenzar"}</p></div>
      {available.length ? <select disabled={Boolean(busy || automaticRunning)} value={sessionId} onChange={(event) => { transcriptionRunRef.current?.abort(); setSessionId(event.target.value); setJob(undefined); setSelectedTakeId(""); setOverlayEditor(null); }} className="ml-auto max-w-[170px] rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-zinc-300 outline-none">{available.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : <span className="ml-auto rounded-xl border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-[10px] text-amber-200">Sin material</span>}
      <span className="hidden rounded-xl border border-white/8 px-3 py-2 text-[10px] text-zinc-500 sm:inline">9:16 · 1080p</span>
      {ready ? <a href={`${resultSrc}?download=1`} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black"><Download size={14} />Descargar MP4</a> : available.length ? <button onClick={() => void editAutomatically()} disabled={busy !== "" || automaticRunning} className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={14} /> : <Sparkles size={14} />}{automaticRunning ? "Editando automáticamente…" : busy === "render" ? "Exportando…" : "Editar automáticamente"}</button> : <button onClick={props.onUpload} className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold"><Plus size={14} />Subir videos</button>}
    </header>

    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-2 text-[11px] text-zinc-400"><span className="flex items-center gap-2"><Check size={14} className="text-emerald-300" />Orden confirmado · {activeTimeline.length} escenas</span><button disabled={Boolean(busy || automaticRunning)} onClick={() => setManualReviewSession(sessionId)} className="rounded-lg px-2 py-2 text-violet-200 disabled:opacity-40">Cambiar tomas u orden</button></div>

    {activeResult && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-400/20 bg-emerald-400/[.08] px-4 py-4 sm:px-6"><div><p className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><Check size={16} />{resultIsPrevious ? "Resultado anterior disponible" : "Resultado editado listo"}</p><p className="mt-1 text-xs text-zinc-400">{resultIsPrevious ? "Esta versión todavía no incluye los cambios pendientes. Prepara y renderiza una nueva versión." : resultMetadata.recoveredFromStorage ? "El MP4 apareció en la biblioteca tras perderse la conexión. Reprodúcelo completo para comprobar el resultado." : "El MP4 pasó una comprobación inicial de video y audio. Revísalo completo antes de publicarlo."}</p>{!resultMetadata.recoveredFromStorage && <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-300"><span>{resultStyle}</span><span>· {Number(resultMetadata.duration_seconds || 0).toFixed(1)} s finales</span><span>· {Number(resultMetadata.caption_count || 0)} subtítulos</span><span>· {Number(resultMetadata.effect_count || 0)} efectos</span><span>· {Number(resultMetadata.image_count || 0)} imágenes</span><span>· {Number(resultMetadata.removed_silence_seconds || 0).toFixed(1)} s de silencio retirado</span></div>}</div><div className="flex w-full flex-wrap gap-2 sm:w-auto"><button onClick={() => { setPreviewMode("original"); document.getElementById("editor-workbench")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="flex-1 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white sm:flex-none">Seguir editando</button><button onClick={() => setPreviewMode("final")} className="flex-1 rounded-xl bg-emerald-400 px-3 py-2 text-xs font-semibold text-black sm:flex-none">Ver resultado</button><a href={`${resultSrc}?download=1`} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-300/30 px-3 py-2 text-xs text-emerald-100 sm:flex-none"><Download size={14} />Descargar</a></div></div>}
    {draftStorageWarning && <p role="alert" className="border-b border-amber-300/20 bg-amber-300/10 px-4 py-3 text-xs text-amber-100">Este navegador no tiene espacio para guardar los últimos cambios del borrador. Mantén la pestaña abierta y exporta el MP4 antes de salir. Tus videos originales se conservan.</p>}
    {selectedSession?.title?.startsWith("Copia del MP4 ·") && <div className="border-b border-amber-300/20 bg-amber-300/[.06] px-4 py-3 text-xs leading-5 text-amber-100 sm:px-6">Estás editando una copia del MP4 exportado. Puedes recortar, ajustar audio/color y añadir nuevos elementos; los subtítulos, sonidos y efectos ya incrustados no se pueden separar. Puedes generar subtítulos nuevos desde el audio en Texto → Subtítulos automáticos.</div>}
    {job?.status === "failed" && <div className="border-b border-red-400/20 bg-red-400/[.08] px-4 py-4 text-sm text-red-100 sm:px-6"><strong>La edición no se completó. No existe un MP4 final de este intento.</strong><p className="mt-1 text-xs text-red-200/80">{job.error || error || "Revisa el mensaje y vuelve a intentar el render."}</p></div>}
    {job?.status === "unconfirmed" && <div className="border-b border-amber-300/20 bg-amber-300/[.07] px-4 py-4 text-sm text-amber-100 sm:px-6"><strong>No pudimos confirmar el resultado de este intento.</strong><p className="mt-1 text-xs text-amber-100/80">{job.error || "Abre Mis videos para ver si apareció el MP4 antes de reintentar."}</p></div>}
    {job?.ephemeral && <div className="border-b border-amber-300/15 bg-amber-300/[.04] px-4 py-2.5 text-[11px] text-amber-100/80 sm:px-6">El plan y el progreso de esta edición solo se conservan en este navegador. El MP4 terminado aparecerá en Mis videos de esta misma sesión.</div>}
    {!automaticRunning && automaticStage === "idle" && options.captions && missingTimedTakes.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300/20 bg-amber-300/[.06] px-4 py-3 text-[11px] text-amber-100 sm:px-6"><span>Faltan tiempos de voz en {missingTimedTakes.length} {missingTimedTakes.length === 1 ? "toma" : "tomas"}. Puedes seguir sin subtítulos y añadirlos más tarde.</span><div className="flex flex-wrap gap-2"><button onClick={() => changeOptions({ captions: false })} className="rounded-lg border border-amber-200/30 px-3 py-2 font-semibold text-amber-100">Seguir sin subtítulos</button><button onClick={() => { setTool("text"); document.getElementById("editor-workbench")?.scrollIntoView({ behavior: "smooth" }); }} className="rounded-lg bg-violet-500 px-3 py-2 font-semibold text-white">Sincronizar subtítulos</button></div></div>}

    {selectedSession && <details id="editor-script" className="scroll-mt-24 border-b border-white/8 bg-[#10131e] p-4 sm:p-5" aria-label="Dirección por libreto"><summary className="cursor-pointer text-xs font-medium text-zinc-300">Libreto y recursos (opcional)</summary>
      <div className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[.17em] text-violet-300">Dirección editorial</p><h2 className="mt-1 text-base font-semibold">Libreto y recursos del video</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">El libreto es opcional. Si lo añades, puede ayudar a proponer el orden y los apoyos; también puedes ordenar las tomas manualmente.</p></div><span className={`rounded-full px-3 py-1 text-[10px] ${scriptDraft.trim() ? "bg-emerald-400/10 text-emerald-200" : "bg-white/5 text-zinc-400"}`}>{scriptDraft.trim() ? "Libreto cargado" : "Libreto opcional"}</span></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div><label className="block text-xs text-zinc-300">Libreto (opcional)<textarea value={scriptDraft} onChange={(event) => changeScriptDraft(event.target.value)} maxLength={6_000} rows={7} placeholder="Puedes pegar el libreto ahora o continuar sin él. Separa ideas o escenas con líneas en blanco." className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/25 p-3 text-xs leading-5 text-white outline-none focus:border-violet-400/50" /></label><div className="mt-2 flex flex-wrap items-center gap-2"><label className="cursor-pointer rounded-lg border border-white/15 px-3 py-2 text-[11px] text-zinc-200">Subir .txt o .md<input type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={(event) => { void importScript(event.target.files?.[0]); event.target.value = ""; }} /></label><button onClick={() => void saveScript()} disabled={savingScript || scriptDraft.trim() === String(selectedSession.script || "").trim()} className="rounded-lg bg-violet-500 px-3 py-2 text-[11px] font-semibold disabled:opacity-40">{savingScript ? "Guardando…" : "Guardar libreto"}</button><span className="text-[10px] text-zinc-500">{scriptDraft.length}/6000 caracteres</span></div></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold">Orden propuesto por el libreto</p><p className="mt-1 text-[10px] text-zinc-500">{editorialPlan.matches.filter((match) => match.beatIndex !== null).length}/{activeTimeline.length} tomas vinculadas · {editorialPlan.beats.length} partes del relato</p></div><button onClick={applySuggestedOrder} disabled={!editorialPlan.reliableOrder || Boolean(busy || automaticRunning)} className="rounded-lg bg-violet-500 px-3 py-2 text-[10px] font-semibold disabled:opacity-40">Aplicar orden</button></div>
          {!editorialPlan.reliableOrder && <p className="mt-3 rounded-lg bg-amber-300/10 p-2 text-[10px] leading-4 text-amber-100">{editorialPlan.transcriptCoverage < 1 ? "Falta texto hablado en una o más tomas; el sistema no puede reconocer su lugar con seguridad." : editorialPlan.repeatedBeats.length ? "Hay tomas que coinciden con la misma parte del libreto. Revisa si se repiten." : "El texto de las tomas no coincide lo suficiente con el libreto para imponer un orden."}</p>}
          {editorialPlan.beats.length > 0 && <ol className="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-[10px]">{editorialPlan.beats.map((beat) => { const match = editorialPlan.matches.find((item) => item.beatIndex === beat.index); const clip = activeTimeline.find((item) => item.segmentId === match?.clipId); return <li key={beat.index} className="flex gap-2 rounded-lg bg-white/[.04] p-2"><span className="font-semibold text-violet-300">{beat.index + 1}.</span><span className="min-w-0"><span className="block truncate text-zinc-300">{beat.text}</span><small className={clip ? "text-emerald-300" : "text-amber-200"}>{clip ? `${clip.title} · coincidencia ${match?.confidence}` : "Falta toma o transcripción"}</small></span></li>; })}</ol>}
        </div>
      </div>
      {editorialPlan.resources.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-semibold">Recursos recomendados para esta historia</p><div className="flex gap-2 overflow-x-auto pb-1">{editorialPlan.resources.map((resource) => { const match = editorialPlan.matches.find((item) => item.beatIndex === resource.beatIndex); return <article key={resource.id} className="min-w-[210px] max-w-[240px] flex-1 rounded-xl border border-white/10 bg-black/20 p-3"><span className={`text-[9px] font-semibold uppercase tracking-wide ${resource.needsMedia ? "text-amber-200" : "text-cyan-200"}`}>{resource.needsMedia ? "Requiere imagen o toma propia" : "Generable como rótulo"}</span><strong className="mt-1 block text-xs">{resource.title}</strong><p className="mt-1 text-[10px] leading-4 text-zinc-500">{resource.detail}</p>{resource.generatedLabel && <button onClick={() => match && updateClip(match.clipId, { label: resource.generatedLabel || "" })} disabled={!match || Boolean(busy || automaticRunning)} className="mt-2 rounded-lg border border-cyan-300/25 px-2 py-1.5 text-[10px] text-cyan-200 disabled:opacity-40">{match ? `Aplicar a ${activeTimeline.find((clip) => clip.segmentId === match.clipId)?.title || "toma"}` : "Falta vincular la toma"}</button>}</article>; })}</div></div>}
      </div>
    </details>}

    {selectedSession && activeTimeline.length > 0 && <div className="hidden items-center justify-between gap-3 border-b border-[#FF7A00]/20 bg-gradient-to-r from-[#FF7A00]/[.08] to-violet-500/[.06] px-6 py-3 lg:flex">
      <div className="min-w-0"><p className="text-sm font-semibold text-white">Sala de edición en vivo</p>
        <p className="text-xs text-zinc-400">{style === "segmenta-cinetico" ? "Mira a los agentes cortar, subtitular y revisar tu video sobre la línea de tiempo, con el mismo plan que aplica el render." : "Disponible con el estilo Segmenta cinético: sus agentes usan las skills de cortes y subtítulos."}</p></div>
      {style === "segmenta-cinetico"
        ? <button type="button" disabled={Boolean(busy) && !automaticRunning} onClick={() => setSalaClips(activeTimeline.map((clip) => ({
            id: clip.segmentId, takeId: clip.takeId, title: clip.title, videoUrl: `/api/media/${clip.takeId}`,
            window: { start: clip.trimStartSeconds, end: clip.trimEndSeconds }, cues: clip.captionCues,
            script: String(approvedScenes.find((scene) => scene.id === clip.sceneId)?.script || ""),
          })))} className="shrink-0 rounded-xl bg-[#FF7A00] px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">Abrir la sala de edición</button>
        : <button type="button" onClick={() => chooseStyle("segmenta-cinetico")} disabled={Boolean(busy || automaticRunning)} className="shrink-0 rounded-xl border border-[#FF7A00]/50 px-4 py-2 text-xs font-semibold text-[#FFB066] disabled:opacity-40">Usar Segmenta cinético</button>}
    </div>}
    {salaClips && <SalaEdicion projectName={String(selectedSession?.title || "Proyecto")} styleName={selectedStyle.name} uppercase={selectedStyle.subtitle.uppercase} soundEffects={options.soundEffects}
      clips={salaClips} loadAudio={loadSalaAudio}
      onExport={automaticRunning || automaticStage === "done" ? undefined : () => void editAutomatically()}
      exportLabel={automaticRunning ? "Exportando…" : automaticStage === "done" ? "MP4 listo" : "Exportar MP4"}
      exportStatus={automaticRunning ? `${automaticStage === "captions" ? "Generando subtítulos que faltan" : automaticStage === "render" ? `Renderizando: ${job?.stage || "preparando"} · ${Math.round(Number(job?.progress || 0))} %` : "Preparando la exportación"}` : automaticStage === "done" ? "MP4 listo. Cierra la sala para verlo en «Resultado editado»." : automaticStage === "error" && error ? error : undefined}
      onClose={() => setSalaClips(null)} />}
    <EditingProgress resourcesEnabled={options.broll} resourcesStage={resourceMessage} stage={automaticStage} running={automaticRunning} captionStage={transcriptionStage}
      tasks={transcriptionTasks} renderStage={job?.stage || ""} renderProgress={Number(job?.progress || 0)}
      previews={livePreviews} selectedPreviewIndex={showingLive ? livePreview?.clipIndex : undefined}
      onSelectPreview={(index) => { setLivePreviewIndex(index); setPreviewMode("live"); }}
      onStop={() => { automaticRunRef.current?.abort(); transcriptionRunRef.current?.abort(); }}
      onStart={() => void editAutomatically()} disabled={Boolean(busy || automaticRunning) || !activeTimeline.length}
      error={error} />
    <div id="editor-workbench" className="scroll-mt-24 grid min-h-[670px] xl:grid-cols-[78px_250px_minmax(320px,1fr)_260px]">
      <nav className="order-2 flex overflow-x-auto border-t border-white/8 bg-[#0d1018] p-1.5 xl:order-none xl:flex-col xl:border-r xl:border-t-0 xl:p-2">
        <ToolButton active={tool === "media"} icon={Film} label="Medios" onClick={() => setTool("media")} />
        <ToolButton active={tool === "video"} icon={SlidersHorizontal} label="Video" onClick={() => setTool("video")} />
        <ToolButton active={tool === "styles"} icon={WandSparkles} label="Estilos" onClick={() => setTool("styles")} />
        <ToolButton active={tool === "text"} icon={Type} label="Texto" onClick={() => setTool("text")} />
        <ToolButton active={tool === "resources"} icon={ImageIcon} label="Recursos" onClick={() => setTool("resources")} />
        <ToolButton active={tool === "effects"} icon={Zap} label="Efectos" onClick={() => setTool("effects")} />
        <ToolButton active={tool === "audio"} icon={Volume2} label="Audio" onClick={() => setTool("audio")} />
        <ToolButton active={tool === "catalog"} icon={Layers3} label="Herramientas" onClick={() => setTool("catalog")} />
      </nav>

      <aside className="order-3 max-h-[430px] overflow-y-auto border-t border-white/8 bg-[#0c0f17] p-4 xl:order-none xl:max-h-none xl:border-r xl:border-t-0"><fieldset disabled={Boolean(busy || automaticRunning) && tool !== "text"} className="contents">
        {tool === "resources" && <VisualResourcesPanel key={sessionId} clips={timeline} selectedClip={selectedClip} enabled={options.broll} disabled={Boolean(busy || automaticRunning)} message={resourceMessage} onToggle={() => changeOptions({ broll: !options.broll })} onRecommend={() => applyVisualRecommendations()} onAdd={addVisualResource} onReplace={replaceVisualResource} onChange={changeResources} onSeek={seekVisualResource} />}
        {tool === "media" && <><PanelTitle icon={Layers3} title="Tus escenas" text={`${approvedTakes.length} clips listos`} /><button onClick={() => props.onAddToCurrent(sessionId)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-violet-400/25 bg-violet-400/5 px-3 py-3 text-xs text-violet-200"><Plus size={15} />Añadir a este proyecto</button><div className="mt-4 grid grid-cols-2 gap-2">{approvedTakes.map((take, index) => <button key={take.id} onClick={() => { setSelectedTakeId(timeline.find((clip) => clip.takeId === take.id)?.segmentId || ""); setPreviewMode("original"); setOverlayEditor(null); }} className={`overflow-hidden rounded-xl border text-left ${selectedTake?.id === take.id ? "border-violet-400" : "border-white/8"}`}><div className="relative aspect-[9/12] bg-black"><video src={`/api/media/${take.id}`} muted preload="metadata" className="h-full w-full object-cover" /><span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[8px]">{seconds(take.durationMs)}</span></div><p className="truncate px-2 py-2 text-[9px] text-zinc-400">{approvedScenes[index]?.title || `Clip ${index + 1}`}</p></button>)}</div></>}
        {tool === "video" && <><PanelTitle icon={SlidersHorizontal} title="Video y color" text={selectedClip ? `Ajustes de ${selectedClip.title}` : "Selecciona una toma"} />{selectedClip && <div className="mt-5 space-y-5"><p className="text-[10px] leading-4 text-zinc-500">Cada control se aplica a esta toma al renderizar. La vista previa del color es aproximada.</p><Range label="Velocidad" value={selectedClip.playbackSpeed} min={.5} max={2} step={.05} suffix="×" onChange={(value) => updateClip(selectedClip.segmentId, { playbackSpeed: value })} /><Range label="Brillo" value={Math.round(selectedClip.brightness * 100)} min={-20} max={20} suffix="%" onChange={(value) => updateClip(selectedClip.segmentId, { brightness: value / 100 })} /><Range label="Contraste" value={Math.round(selectedClip.contrast * 100)} min={80} max={130} suffix="%" onChange={(value) => updateClip(selectedClip.segmentId, { contrast: value / 100 })} /><Range label="Saturación" value={Math.round(selectedClip.saturation * 100)} min={50} max={150} suffix="%" onChange={(value) => updateClip(selectedClip.segmentId, { saturation: value / 100 })} /><button onClick={() => updateClip(selectedClip.segmentId, { playbackSpeed: 1, brightness: 0, contrast: 1, saturation: 1 })} className="w-full rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300">Restablecer ajustes</button></div>}</>}
        {tool === "styles" && <>
          <PanelTitle icon={WandSparkles} title="Estilos" text="Cambia toda la edición" />
          <div className="mt-4 space-y-2">{EDITOR_STYLES.map((item) => <button key={item.id} onClick={() => chooseStyle(item.id)} className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${style === item.id ? "border-violet-400/40 bg-violet-400/10" : "border-white/7 bg-black/15"}`}><span className="h-12 w-9 shrink-0 rounded-lg" style={{ background: `linear-gradient(145deg,${item.palette[0]},${item.palette[1]})` }} /><span className="min-w-0"><strong className="block truncate text-xs">{item.name}</strong><small className="mt-1 block truncate text-[9px] text-zinc-600">{item.reference}</small></span>{style === item.id && <Check className="ml-auto text-violet-300" size={14} />}</button>)}</div>
          {layeredStyle && <div className="mt-4 rounded-xl border border-yellow-300/25 bg-yellow-300/[.04] p-3"><p className="text-[10px] font-semibold text-yellow-200">Vista del estilo IA en capas</p><div className="relative mx-auto mt-3 aspect-[9/16] w-28 overflow-hidden rounded-lg bg-gradient-to-br from-slate-500 via-slate-800 to-black"><span className="absolute inset-x-2 top-4 rounded bg-black/90 px-1 py-1 text-center text-[8px] font-black text-white">El poder de la IA</span><span className="absolute inset-x-2 bottom-10 text-center text-[12px] font-black leading-3 text-white drop-shadow-lg">Y ESO LO <span className="text-yellow-300">CAMBIA</span></span></div><p className="mt-3 text-[10px] leading-4 text-zinc-400">Encabezado oscuro, subtítulos blanco y amarillo, cortes secos y acentos de sonido. El encabezado usa el título o un rótulo; los subtítulos necesitan tiempos de voz para aparecer en el MP4.</p><a href="https://www.instagram.com/reel/DfYILmwt3cL/" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] text-yellow-200 underline">Ver reel de referencia</a>{missingTimedTakes.length ? <button onClick={() => { setTool("text"); void transcribeMissingTakes(); }} disabled={Boolean(busy || automaticRunning)} className="mt-3 w-full rounded-lg bg-yellow-300 px-3 py-2 text-[10px] font-semibold text-black disabled:opacity-50">Generar subtítulos automáticos</button> : !options.captions ? <button onClick={() => changeOptions({ captions: true })} className="mt-3 w-full rounded-lg bg-yellow-300 px-3 py-2 text-[10px] font-semibold text-black">Activar subtítulos</button> : null}</div>}
        </>}
        {tool === "text" && <>
          <PanelTitle icon={Captions} title="Subtítulos" text="Sincronizados con la voz de cada toma" />
          <div className="mt-4 space-y-4">
            <AutomaticCaptions busy={busy === "transcribe"} disabled={Boolean(busy || automaticRunning) || !reviewConfirmed}
              missingCount={missingTimedTakes.length} completedCount={activeTimeline.filter((clip) => clip.captionCues.length > 0).length} totalCount={activeTimeline.length}
              selectedTitle={selectedClip?.title} selectedHasCaptions={Boolean(selectedClip?.captionCues.length)} tasks={transcriptionTasks} stage={transcriptionStage}
              onGenerate={() => void transcribeMissingTakes()} onGenerateSelected={() => void transcribeMissingTakes("selected")}
              onCancel={() => { automaticRunRef.current?.abort(); transcriptionRunRef.current?.abort(); }} onReview={reviewCaptionText} />
            <fieldset disabled={Boolean(busy || automaticRunning)} className="contents"><Toggle enabled={options.captions} label="Mostrar subtítulos" detail="Se activan al terminar la generación" onChange={() => changeOptions({ captions: !options.captions })} />
            <Range label="Tamaño" value={settings.subtitleSize} min={38} max={100} suffix="px" onChange={(value) => changeSettings({ subtitleSize: value })} />
            <Select label="Posición" value={settings.subtitlePosition} onChange={(value) => changeSettings({ subtitlePosition: value as typeof settings.subtitlePosition })} options={[["top","Arriba"],["center","Centro"],["chest","Pecho (bajo el rostro)"],["bottom","Abajo"]]} />
            <Toggle enabled={options.labels} label="Título inicial" detail="Muestra el nombre del proyecto" onChange={() => changeOptions({ labels: !options.labels })} /></fieldset>
          </div>
        </>}
        {tool === "effects" && <><PanelTitle icon={Zap} title="Efectos" text="Movimiento sin complicaciones" /><div className="mt-4 space-y-3"><Toggle enabled={options.deadAir} label="Cortar silencios" detail="Elimina pausas largas" onChange={() => changeOptions({ deadAir: !options.deadAir })} />{options.deadAir && <Range label="Pausa máxima" value={settings.silenceThresholdMs} min={350} max={1500} step={50} suffix=" ms" onChange={(value) => changeSettings({ silenceThresholdMs: value })} />}{options.deadAir && <Select label="Sensibilidad al ruido" value={String(settings.silenceNoiseDb)} onChange={(value) => changeSettings({ silenceNoiseDb: Number(value) })} options={[["-35","Conservadora"],["-30","Normal"],["-25","Alta · para ruido de fondo"]]} />}<Toggle enabled={options.transitions} label="Transiciones" detail="Entre escenas" onChange={() => changeOptions({ transitions: !options.transitions })} />{options.transitions && <Select label="Tipo" value={settings.transition} onChange={(value) => changeSettings({ transition: value as typeof settings.transition })} options={[['cut','Corte'],['fade','Fundido'],['dissolve','Fundido a negro']]} />}<button type="button" onClick={() => setTool("resources")} className="w-full rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3 text-left"><span className="flex items-center gap-2 text-xs text-cyan-100"><ImageIcon size={14} />Imágenes por palabras</span><small className="mt-1 block text-[10px] text-zinc-400">Detectar, añadir y ajustar apoyos visuales →</small></button></div></>}
        {tool === "audio" && <><PanelTitle icon={Volume2} title="Audio" text="Voz clara y golpes precisos" /><div className="mt-4 space-y-4">{selectedClip && <><Range label={`Volumen de ${selectedClip.title}`} value={Math.round(selectedClip.audioVolume * 100)} min={0} max={200} step={5} suffix="%" onChange={(value) => updateClip(selectedClip.segmentId, { audioVolume: value / 100 })} /><button onClick={() => updateClip(selectedClip.segmentId, { audioVolume: selectedClip.audioVolume === 0 ? 1 : 0 })} className="w-full rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300">{selectedClip.audioVolume === 0 ? "Activar voz" : "Silenciar toma"}</button></>}<Select label="Reducción de ruido de voz" value={settings.noiseReduction} onChange={(value) => changeSettings({ noiseReduction: value as typeof settings.noiseReduction })} options={[["off","Apagada"],["light","Suave"],["medium","Media"]]} /><Toggle enabled={options.soundEffects} label="Efectos sonoros" detail="En cambios importantes" onChange={() => changeOptions({ soundEffects: !options.soundEffects })} />{options.soundEffects && <Range label="Intensidad" value={Math.round(settings.soundEffectVolume * 100)} min={0} max={100} suffix="%" onChange={(value) => changeSettings({ soundEffectVolume: value / 100 })} />}{options.soundEffects && <Select label="Sonido de los cortes" value={settings.soundPreset} onChange={(value) => changeSettings({ soundPreset: value as typeof settings.soundPreset })} options={[["auto","Según el estilo"],["soft","Suave"],["kinetic","Golpe cinético"],["cinematic","Cinematográfico"],["pop","Marca pop"],["none","Sin sonido"]]} />}<div className="rounded-xl border border-dashed border-white/8 p-3 opacity-60"><p className="flex items-center gap-2 text-xs"><Music2 size={14} />Música</p><small className="mt-1 block text-[9px] text-zinc-600">Pendiente de pistas con licencia.</small></div></div></>}
        {tool === "catalog" && <><PanelTitle icon={Layers3} title="Mapa de herramientas" text="Guía completa · 15 categorías" /><p className="mt-3 text-[10px] leading-4 text-zinc-400">Disponible: la función descrita modifica el MP4. Parcial: existe una versión limitada. En desarrollo: aún no está conectada al render.</p><input type="search" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Buscar herramienta…" className="mt-4 w-full rounded-xl border border-white/10 bg-[#151822] p-2.5 text-xs text-white outline-none" /><div className="mt-4 space-y-2">{EDITOR_TOOL_CATALOG.map((category) => { const matches = category.tools.filter((item) => `${item.name} ${item.section} ${item.description}`.toLocaleLowerCase("es").includes(catalogSearch.toLocaleLowerCase("es"))); if (!matches.length) return null; return <details key={category.id} open={Boolean(catalogSearch)} className="rounded-xl border border-white/10 bg-white/[.02] p-2"><summary className="cursor-pointer text-xs font-medium">{category.id}. {category.name} <span className="text-zinc-500">({matches.length})</span></summary><div className="mt-2 space-y-2">{matches.map((item, index) => <div key={`${item.section}-${item.name}-${index}`} className="rounded-lg bg-black/20 p-2"><p className="text-[11px] text-zinc-200">{item.name}</p><p className="mt-1 text-[9px] leading-4 text-zinc-500">{item.description}</p><span className={`mt-1 inline-block text-[9px] ${item.status === "ready" ? "text-emerald-300" : item.status === "partial" ? "text-cyan-300" : "text-amber-200"}`}>{item.status === "ready" ? "Disponible" : item.status === "partial" ? "Parcial" : "En desarrollo"}</span></div>)}</div></details>; })}</div></>}
      </fieldset></aside>

      <main className="order-1 flex min-h-[540px] flex-col bg-[#07090e] xl:order-none">
        <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
          <div className="relative aspect-[9/16] h-[430px] max-h-[58vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:h-[520px]">
            {previewSrc ? <video key={`${previewSrc}:${showingFinal ? "final" : selectedClip?.segmentId}`} ref={videoRef} src={previewSrc} aria-label={showingLive ? "Escena procesada durante la edición" : showingFinal ? "Resultado editado" : "Vista previa de la toma original"} autoPlay={showingLive} muted={showingLive} loop={showingLive} controls playsInline preload="metadata" onLoadedMetadata={(event) => { setMediaErrorSrc(""); if (!showingRendered && selectedClip) { const seek = captionPreviewSeekRef.current;
              const start = seek?.segmentId === selectedClip.segmentId ? seek.seconds : selectedClip.trimStartSeconds;
              event.currentTarget.currentTime = start; if (seek?.segmentId === selectedClip.segmentId) captionPreviewSeekRef.current = null;
              event.currentTarget.playbackRate = selectedClip.playbackSpeed; event.currentTarget.volume = Math.min(1, selectedClip.audioVolume); setPreviewTime(start); } else setPreviewTime(event.currentTarget.currentTime); }} onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} onError={() => setMediaErrorSrc(previewSrc)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="h-full w-full object-contain" style={!showingRendered && selectedClip ? { filter: `brightness(${1 + selectedClip.brightness}) contrast(${selectedClip.contrast}) saturate(${selectedClip.saturation})` } : undefined} /> : <button onClick={props.onUpload} className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_35%,rgba(124,58,237,.18),transparent_45%)] text-center"><span><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-400/10 text-violet-200"><UploadCloud size={24} /></span><strong className="mt-4 block text-sm text-zinc-200">Sube videos para editar</strong><small className="mt-2 block px-7 leading-4 text-zinc-600">Después podrás cortarlos, subtitularlos y aplicar estilos.</small></span></button>}
            {previewSrc && mediaErrorSrc === previewSrc && <p className="absolute inset-x-3 bottom-12 rounded-xl bg-black/90 p-3 text-center text-[10px] leading-4 text-amber-100">{showingLive ? "Esta muestra no pudo reproducirse. La exportación completa sigue en proceso." : showingFinal ? "Este resultado no se pudo reproducir aquí. Prueba descargarlo o actualizar la biblioteca." : "Esta toma original no se reproduce en este navegador. El render final se exporta como MP4."}</p>}
            {!showingRendered && selectedClip && options.broll && selectedClip.visualResources.filter((item) => previewTime >= item.startSeconds && previewTime < item.endSeconds).map((item) => {
              const geometry = VISUAL_RESOURCE_LAYOUTS[item.layout];
              return <button key={item.id} type="button" aria-label={`Editar imagen ${item.keyword}`} onClick={() => setTool("resources")} className="absolute overflow-hidden border border-white/80 shadow-lg" style={{ left: `${geometry.x / 10.8}%`, top: `${geometry.y / 19.2}%`, width: `${geometry.width / 10.8}%`, height: `${geometry.height / 19.2}%`, borderRadius: 7 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resourceImageSrc(item.image)} alt={`Apoyo visual: ${item.keyword}`} className="h-full w-full object-cover" />
              </button>;
            })}
            {!showingRendered && selectedClip && options.labels && (layeredStyle || previewTime - selectedClip.trimStartSeconds < 2.6) && <button type="button" onClick={() => openOverlayEditor("label")} className="absolute inset-x-9 top-[7%] mx-auto max-w-[80%] rounded-lg border border-dashed border-violet-200/60 bg-black/85 px-3 py-2 text-center text-sm font-black text-white shadow-xl" aria-label="Editar rótulo sobre el video">{layeredStyle ? layeredHeader || "＋ Añadir encabezado" : selectedClip.label || "＋ Añadir rótulo"}</button>}
            {!showingRendered && selectedClip && options.captions && kineticCaptions && <button type="button" onClick={() => openOverlayEditor("caption")} className={`absolute inset-x-5 mx-auto max-w-[90%] -translate-y-1/2 rounded-lg border border-dashed border-transparent px-3 py-1 text-center italic leading-none hover:border-violet-200/50 ${settings.subtitlePosition === "top" ? "top-[19%]" : settings.subtitlePosition === "center" ? "top-[47%]" : settings.subtitlePosition === "bottom" ? "top-[79%]" : "top-[64%]"}`} style={{ fontFamily: "Montserrat, var(--font-sans), sans-serif", fontWeight: kineticPreviewWord?.style === "enfasis" ? 900 : kineticPreviewWord?.style === "ligera" ? 300 : 800, fontSize: `${Math.round((kineticPreviewWord?.style === "enfasis" ? 138 : kineticPreviewWord?.style === "ligera" ? 92 : 112) * .27)}px`, color: kineticPreviewWord?.style === "enfasis" ? "#FF7A00" : "#FFFFFF", textShadow: kineticPreviewWord?.style === "enfasis" ? "0 0 16px rgba(255,122,0,.85), 0 3px 8px rgba(0,0,0,.6)" : "0 3px 8px rgba(0,0,0,.6)" }} aria-label="Editar subtítulo sobre el video">{kineticPreviewWord?.text || (selectedClip.captionCues.length ? "" : <span className="text-sm not-italic">＋ Escribir subtítulo</span>)}</button>}
            {!showingRendered && selectedClip && options.captions && !kineticCaptions && <button type="button" onClick={() => openOverlayEditor("caption")} className={`absolute inset-x-5 mx-auto max-w-[90%] rounded-lg border border-dashed border-violet-200/50 px-3 py-2 text-center font-black shadow-xl ${layeredStyle ? "bottom-[22%]" : settings.subtitlePosition === "top" ? "top-[12%]" : settings.subtitlePosition === "center" ? "top-1/2 -translate-y-1/2" : "bottom-[10%]"}`} style={{ color: selectedStyle.subtitle.text, backgroundColor: layeredStyle ? "rgba(0,0,0,.34)" : selectedStyle.subtitle.box, fontSize: `${Math.max(15, settings.subtitleSize * .3)}px`, textTransform: selectedStyle.subtitle.uppercase ? "uppercase" : "none" }} aria-label="Editar subtítulo sobre el video">{layeredStyle && previewCaptionWords.length ? <>{previewCaptionWords.slice(0, -1).join(" ")}{previewCaptionWords.length > 1 && <br />}<span className="text-yellow-300">{previewCaptionWords[previewCaptionWords.length - 1]}</span></> : previewCaption || (selectedClip.captionCues.length ? "Editar subtítulos" : "＋ Escribir subtítulo")}</button>}
            {!showingRendered && selectedClip && overlayEditor && <form onSubmit={(event) => { event.preventDefault(); applyOverlayEditor(); }} className="absolute inset-x-3 top-1/2 z-10 -translate-y-1/2 rounded-xl border border-violet-300/50 bg-[#10121e]/95 p-3 shadow-2xl"><label className="block text-xs font-semibold text-white">{overlayEditor === "label" ? "Rótulo de esta toma" : overlayCueIndex >= 0 ? "Subtítulo en este momento" : "Texto hablado de esta toma"}<textarea autoFocus value={overlayDraft} onChange={(event) => setOverlayDraft(event.target.value)} maxLength={overlayEditor === "label" ? 120 : overlayCueIndex >= 0 ? 250 : 1000} rows={overlayEditor === "label" ? 2 : 4} className="mt-2 w-full resize-y rounded-lg border border-white/20 bg-black/40 p-2 text-xs font-normal text-white outline-none focus:border-violet-300" /></label><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setOverlayEditor(null)} className="rounded-lg border border-white/20 px-3 py-2 text-xs text-zinc-300">Cancelar</button><button type="submit" className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white">Aplicar al video</button></div></form>}
            <span className={`pointer-events-none absolute left-3 top-3 rounded-full px-2.5 py-1 text-[8px] ${showingFinal ? "bg-emerald-400 text-black" : "bg-black/70 text-zinc-300"}`}>{showingLive ? `MUESTRA REAL · ESCENA ${livePreview!.clipIndex + 1}` : showingFinal ? resultIsPrevious ? "RESULTADO ANTERIOR" : "RESULTADO EDITADO" : "VISTA PREVIA · TEXTO EDITABLE"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/8 px-4 py-3">{activeResult && <div className="flex rounded-xl border border-white/10 bg-white/5 p-1 text-[10px]"><button onClick={() => setPreviewMode("final")} className={`rounded-lg px-3 py-1.5 ${showingFinal ? "bg-emerald-400 font-semibold text-black" : "text-zinc-400"}`}>Resultado editado</button><button onClick={() => setPreviewMode("original")} className={`rounded-lg px-3 py-1.5 ${!showingRendered ? "bg-white font-semibold text-black" : "text-zinc-400"}`}>Toma original</button></div>}<button onClick={togglePlayback} disabled={!previewSrc} className="grid h-9 w-9 place-items-center rounded-full bg-white text-black disabled:opacity-30">{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><span className="text-[10px] text-zinc-400">{showingLive ? `${livePreview!.durationSeconds.toFixed(1)} s de muestra` : showingFinal ? `${Number(resultMetadata.duration_seconds || 0).toFixed(1)} s` : selectedTake ? seconds(selectedTake.durationMs) : "0:00"}</span><span className="rounded-lg bg-white/5 px-2 py-1 text-[9px] text-zinc-500">{showingFinal ? resultStyle : selectedStyle.name}</span></div>
      </main>

      <aside id="editor-export" className="order-4 scroll-mt-24 border-t border-white/8 bg-[#0c0f17] p-4 xl:order-none xl:border-l xl:border-t-0">
        <PanelTitle icon={Settings2} title="Director de edición" text="Describe el resultado" />
        <textarea value={objective} maxLength={2000} onChange={(event) => { setObjective(event.target.value); setJob(null); setDraftPending(true); saveEditorDraft(draftPendingKey, "1"); }} disabled={Boolean(busy || automaticRunning)} rows={5} className="mt-4 w-full resize-none rounded-xl border border-white/8 bg-black/20 p-3 text-xs leading-5 text-zinc-300 outline-none focus:border-violet-400/40 disabled:opacity-50" placeholder="Ej. Quiero un reel energético, directo y con pausas mínimas…" />
        <div className="mt-4 rounded-xl border border-white/7 bg-black/15 p-3"><p className="text-[10px] font-medium text-zinc-300">Ajustes actuales de edición</p><div className="mt-3 space-y-2 text-[9px] text-zinc-500"><p className="flex justify-between"><span>Estilo</span><b className="text-zinc-300">{selectedStyle.name}</b></p><p className="flex justify-between"><span>Escenas</span><b className="text-zinc-300">{activeTimeline.length}</b></p><p className="flex justify-between"><span>Silencios</span><b className="text-zinc-300">{options.deadAir ? `${settings.silenceThresholdMs} ms` : "No"}</b></p><p className="flex justify-between"><span>Subtítulos</span><b className="text-zinc-300">{options.captions ? `${activeTimeline.filter((clip) => clip.transcript.trim()).length}/${activeTimeline.length}` : "No"}</b></p></div></div>
        {missingTimedTakes.length > 0 && <div className="mt-3 rounded-xl border border-violet-400/20 bg-violet-400/[.06] p-3 text-[11px] leading-5 text-violet-100"><strong className="block">Crea subtítulos desde el audio.</strong><p className="mt-1 text-zinc-400">No necesitas escribir el libreto. Genera el texto y corrige cualquier palabra antes de exportar.</p><button type="button" onClick={() => { showCaptionTools(); void transcribeMissingTakes(); }} disabled={Boolean(busy || automaticRunning)} className="mt-2 rounded-lg bg-violet-500 px-3 py-2 font-semibold text-white disabled:opacity-40">Generar subtítulos automáticos</button></div>}
        {job && <div className={`mt-4 rounded-xl border p-3 ${ready ? "border-emerald-400/20 bg-emerald-400/6" : job.status === "failed" ? "border-red-400/20 bg-red-400/6" : job.status === "unconfirmed" ? "border-amber-300/20 bg-amber-300/6" : "border-violet-400/20 bg-violet-400/6"}`}><div className="flex items-center justify-between text-[10px]"><span>{ready ? "MP4 generado" : job.status === "failed" ? "Render falló" : job.stage}</span><b>{job.status === "failed" ? "Error" : job.status === "unconfirmed" ? "Sin confirmar" : `${job.progress || 0}%`}</b></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"><div className={`h-full transition-all ${job.status === "failed" ? "bg-red-400" : job.status === "unconfirmed" ? "bg-amber-300" : "bg-gradient-to-r from-violet-500 to-cyan-400"}`} style={{ width: `${job.status === "failed" || job.status === "unconfirmed" ? 0 : Math.max(2, Number(job.progress || 0))}%` }} /></div>{job.error && <p className="mt-2 text-[9px] leading-4 text-red-200">{job.error}</p>}</div>}
        {job?.contract?.skill_manifest?.decisions && <details className="mt-4 rounded-xl border border-white/8 bg-black/15 p-3"><summary className="cursor-pointer text-xs text-zinc-300">Decisiones de las skills ({job.contract.skill_manifest.decisions.length})</summary><div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{job.contract.skill_manifest.decisions.map((decision: Row) => <p key={decision.skillId} className="border-t border-white/5 pt-2 text-[10px] leading-4 text-zinc-500"><strong className="block text-zinc-300">{decision.skillId} · {decision.execution === "render" ? "render" : decision.execution === "pending" ? "pendiente" : decision.execution === "plan" ? "plan" : "parcial"}</strong>{decision.summary}</p>)}</div></details>}
        <details className="mt-3 rounded-xl border border-white/10 p-3 text-xs text-zinc-400"><summary className="cursor-pointer">Control manual (opcional)</summary><p className="mt-2 text-[10px] leading-4">Conserva tus ajustes y exporta sin la secuencia automática.</p><div className="mt-3 flex flex-wrap gap-2"><button disabled={Boolean(busy || automaticRunning)} onClick={() => void plan()} className="rounded-lg border border-white/15 px-2 py-2 disabled:opacity-40">Preparar plan</button><button disabled={Boolean(busy || automaticRunning) || needsPlan} onClick={() => void render()} className="rounded-lg border border-white/15 px-2 py-2 disabled:opacity-40">Exportar plan</button></div></details>
        {activeResult && <a href={`${resultSrc}?download=1`} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-black"><Download size={15} />Descargar resultado MP4</a>}
        {error && <p className="mt-4 rounded-xl bg-red-400/8 p-3 text-[10px] leading-4 text-red-200">{error}</p>}
      </aside>
    </div>

    <div id="editor-manual-segmentation" role="region" aria-labelledby="editor-manual-segmentation-title" className="scroll-mt-24 border-t border-white/8 bg-[#0b0e15] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 id="editor-manual-segmentation-title" tabIndex={-1} className="rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-violet-300">Segmentar video</h3><p className="text-[10px] text-zinc-500">Línea de tiempo manual · recorta el inicio y final, divide en partes y ordena tus segmentos. El video original se conserva.</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-zinc-400">{activeTimeline.length} de {timeline.length} segmentos</span><button onClick={undoTimeline} disabled={Boolean(busy || automaticRunning) || !undoRef.current.length} className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] text-zinc-300 disabled:opacity-30">Deshacer</button><button onClick={redoTimeline} disabled={Boolean(busy || automaticRunning) || !redoRef.current.length} className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] text-zinc-300 disabled:opacity-30">Rehacer</button><button onClick={applySuggestedOrder} disabled={Boolean(busy || automaticRunning) || !editorialPlan.reliableOrder} className="rounded-lg border border-violet-400/30 px-2 py-1.5 text-[10px] text-violet-200 disabled:opacity-40">Aplicar orden del libreto</button></div></div>
      <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Orden de las tomas">
        {timeline.map((clip, index) => <div key={clip.segmentId} className={`min-w-[165px] max-w-[190px] flex-1 rounded-xl border p-2 ${selectedClip?.segmentId === clip.segmentId ? "border-violet-400 bg-violet-400/10" : "border-white/10 bg-white/[.03]"} ${clip.included ? "" : "opacity-50"}`}>
          <button onClick={() => { setSelectedTakeId(clip.segmentId); setPreviewMode("original"); setOverlayEditor(null); }} className="w-full text-left" aria-label={`Editar toma ${index + 1}: ${clip.title}`}><span className="text-[10px] text-violet-300">{index + 1} · {Math.max(.1, (clip.trimEndSeconds - clip.trimStartSeconds) / clip.playbackSpeed).toFixed(1)} s · {clip.playbackSpeed}×</span><strong className="mt-1 block truncate text-xs">{clip.title}</strong><small className="mt-1 block truncate text-[9px] text-zinc-500">{clip.transcript || "Sin texto hablado"}</small></button>
          <div className="mt-2 flex items-center justify-between gap-1 border-t border-white/10 pt-2 text-[10px]"><button onClick={() => moveClip(clip.segmentId, -1)} disabled={Boolean(busy || automaticRunning) || index === 0} aria-label={`Mover ${clip.title} a la izquierda`} className="rounded bg-white/5 px-2 py-1 disabled:opacity-30">←</button><button onClick={() => moveClip(clip.segmentId, 1)} disabled={Boolean(busy || automaticRunning) || index === timeline.length - 1} aria-label={`Mover ${clip.title} a la derecha`} className="rounded bg-white/5 px-2 py-1 disabled:opacity-30">→</button><button onClick={() => updateClip(clip.segmentId, { included: !clip.included })} disabled={Boolean(busy || automaticRunning)} className="rounded bg-white/5 px-2 py-1">{clip.included ? "Excluir" : "Incluir"}</button></div>
        </div>)}
      </div>
      {selectedClip && <div className="mt-3 grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div><p className="text-xs font-semibold">Editar {selectedClip.title}</p><p className="mt-1 text-[10px] text-zinc-500">Los cambios se guardan en este navegador y se aplican al próximo MP4.</p><div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[10px] text-zinc-400">Inicio (s)<input type="number" min={0} max={Math.max(0, selectedClip.trimEndSeconds - .2)} step="0.1" value={selectedClip.trimStartSeconds} disabled={Boolean(busy || automaticRunning)} onChange={(event) => updateClip(selectedClip.segmentId, { trimStartSeconds: Math.max(0, Math.min(selectedClip.trimEndSeconds - .2, Number(event.target.value) || 0)) })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label>
          <label className="text-[10px] text-zinc-400">Final (s)<input type="number" min={selectedClip.trimStartSeconds + .2} max={selectedClip.duration} step="0.1" value={selectedClip.trimEndSeconds} disabled={Boolean(busy || automaticRunning)} onChange={(event) => updateClip(selectedClip.segmentId, { trimEndSeconds: Math.max(selectedClip.trimStartSeconds + .2, Math.min(selectedClip.duration, Number(event.target.value) || selectedClip.duration)) })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label>
        </div><div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-[100px] flex-1 text-[10px] text-zinc-400">Dividir en segundo<input type="number" min={selectedClip.trimStartSeconds + .2} max={selectedClip.trimEndSeconds - .2} step="0.1" value={splitPoint} disabled={Boolean(busy || automaticRunning)} onChange={(event) => setSplitPoint(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label><button onClick={splitClip} disabled={Boolean(busy || automaticRunning) || timeline.length >= 12} className="rounded-lg border border-violet-400/30 px-3 py-2 text-[10px] text-violet-200 disabled:opacity-30">Dividir</button><button onClick={duplicateClip} disabled={Boolean(busy || automaticRunning) || timeline.length >= 12} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-zinc-300 disabled:opacity-30">Duplicar</button></div><p className="mt-2 text-[9px] leading-4 text-zinc-500">Después de dividir, revisa el texto hablado de cada parte.</p></div>
        <div id="editor-caption-text" className="scroll-mt-24 space-y-2"><label className="block text-[10px] text-zinc-400">Texto hablado para subtítulos<textarea value={selectedClip.transcript} onChange={(event) => updateClip(selectedClip.segmentId, { transcript: event.target.value, captionCues: [] })} disabled={Boolean(busy || automaticRunning)} readOnly={selectedClip.captionCues.length > 0} maxLength={1000} rows={2} placeholder="Genera subtítulos automáticos o importa SRT/VTT con tiempos" className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-[#151822] p-2 text-xs leading-5 text-white" /></label><div className="flex flex-wrap items-center gap-2"><label className="cursor-pointer rounded-lg border border-violet-400/25 px-2 py-1.5 text-[10px] text-violet-200">Importar .srt, .vtt o .txt<input type="file" accept=".srt,.vtt,.txt,text/plain,text/vtt" disabled={Boolean(busy || automaticRunning)} className="sr-only" onChange={(event) => { void importTranscript(selectedClip, event.target.files?.[0]); event.target.value = ""; }} /></label>{selectedClip.captionCues.length > 0 && <span className="text-[10px] text-emerald-300">{selectedClip.captionCues.length} subtítulos con tiempos</span>}</div>{selectedClip.captionCues.length > 0 && <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-white/10 p-2"><p className="mb-2 text-[9px] text-zinc-500">Corrige cada tarjeta sin perder los tiempos de voz.</p>{selectedClip.captionCues.map((cue, index) => <label key={`${selectedClip.segmentId}-${index}`} className="flex items-center gap-2 text-[9px] text-zinc-500"><span className="w-16 shrink-0 tabular-nums">{cue.startSeconds.toFixed(1)}–{cue.endSeconds.toFixed(1)} s</span><input aria-label={`Subtítulo ${index + 1} de ${selectedClip.title}`} value={cue.text} maxLength={250} disabled={Boolean(busy || automaticRunning)} onChange={(event) => { const captionCues = selectedClip.captionCues.map((item, cueIndex) => cueIndex === index ? { ...item, text: event.target.value } : item); const transcript = captionCues.map((item) => item.text).join(" "); if (transcript.length <= 1_000) updateClip(selectedClip.segmentId, { captionCues, transcript }); }} className="min-w-0 flex-1 rounded border border-white/10 bg-[#151822] px-2 py-1.5 text-[10px] text-white" /></label>)}</div>}<label className="block text-[10px] text-zinc-400">Rótulo visual opcional<input value={selectedClip.label} onChange={(event) => updateClip(selectedClip.segmentId, { label: event.target.value })} disabled={Boolean(busy || automaticRunning)} maxLength={120} placeholder="Ej. Lechona tradicional" className="mt-1 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label></div>
      </div>}
    </div>
  </section>;
}

function PanelTitle({ icon: Icon, title, text }: { icon: typeof Film; title: string; text: string }) { return <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-violet-300"><Icon size={16} /></span><span><strong className="block text-sm font-medium">{title}</strong><small className="text-[9px] text-zinc-600">{text}</small></span></div>; }
function Range({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) { return <label className="block text-[10px] text-zinc-500"><span className="flex justify-between"><span>{label}</span><b className="text-zinc-300">{value}{suffix}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-violet-500" /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <label className="block text-[10px] text-zinc-500">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-white/8 bg-[#111521] px-3 py-2.5 text-xs text-zinc-300 outline-none">{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>; }
