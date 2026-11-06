"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture, ArrowLeft, Camera, Check, CheckCircle2, ChevronRight, Circle,
  Cloud, Film, FlipHorizontal2, FolderOpen, Library, LoaderCircle, Mic,
  Plus, RotateCcw, Sparkles, Square, Trash2, UploadCloud, UserRound, Video, X,
} from "lucide-react";
import { Upload } from "tus-js-client";
import { InstallAppButton } from "../components/install-app-button";
import { EditorStudio } from "../components/editor-studio";
import { PreproductionPlanner } from "../components/preproduction-planner";
import { AccountAccess } from "../components/account-access";
import { PenguinGuide } from "../components/penguin-guide";
import { RenderResults, type RenderOutput } from "../components/render-results";
import { WORKSPACE_NAV, WorkspaceStudio, type WorkspaceView } from "../components/workspace-studio";
import { createClient as createSupabaseClient } from "../lib/supabase/browser";
import type { GuideAction } from "../lib/penguin-guide";
import { preproductionSchema, type PreproductionPlan } from "../lib/preproduction-plan";

// The studio API combines several database-backed row shapes in one dashboard.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Dashboard = {
  user: Row;
  accounts: Row[];
  portfolios: Row[];
  sessions: Row[];
  scenes: Row[];
  takes: Row[];
  editJobs: Row[];
  preproductionPlans: Row[];
};

const accentClasses: Record<string, string> = {
  violet: "from-violet-500 to-indigo-500",
  cyan: "from-cyan-400 to-blue-500",
  rose: "from-rose-400 to-fuchsia-500",
  amber: "from-amber-300 to-orange-500",
};

type StudioView = "record" | "library" | "edit" | WorkspaceView;
const STUDIO_NAV: Array<{ id: StudioView; label: string }> = [
  { id: "summary", label: "Inicio" }, { id: "record", label: "Crear video" },
  { id: "library", label: "Mis videos" }, { id: "edit", label: "Editor" },
  ...WORKSPACE_NAV.filter((item) => item.id !== "summary"),
];

async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
  return data as T;
}

function videoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const timeout = window.setTimeout(() => finish(0), 15_000);
    const finish = (duration: number) => {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      if (Number.isFinite(duration) && duration >= .2) resolve(duration);
      else reject(new Error("No pudimos leer la duración del MP4. Reprodúcelo y vuelve a intentarlo."));
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(0);
    video.src = url;
  });
}

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  return status === "approved" ? "Aprobada" : status === "blooper" ? "Blooper" : status === "rejected" ? "Descartada" : "Pendiente";
}

function isVideoFile(file: File) {
  return /\.(mp4|mov|m4v|webm)$/i.test(file.name) || ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"].includes(file.type);
}

function videoMimeType(blob: Blob) {
  const name = blob instanceof File ? blob.name : "";
  if (/\.mov$/i.test(name)) return "video/quicktime";
  if (/\.webm$/i.test(name)) return "video/webm";
  if (/\.(mp4|m4v)$/i.test(name)) return "video/mp4";
  return blob.type === "video/quicktime" || blob.type === "video/webm" ? blob.type : "video/mp4";
}

function fileTitle(file: File) {
  return file.name.replace(/\.(mp4|mov|m4v|webm)$/i, "").trim().slice(0, 80) || "Video importado";
}

function SceneTranscriptEditor({ sceneId, initialScript, onSave }: { sceneId: string; initialScript: string; onSave: (sceneId: string, text: string) => Promise<void> }) {
  const [draft, setDraft] = useState(initialScript);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (draft.trim() === initialScript.trim()) return;
    setSaving(true); setError("");
    try { await onSave(sceneId, draft); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el texto."); }
    finally { setSaving(false); }
  };
  return <div className="mt-5"><label htmlFor="scene-transcript" className="text-xs font-medium text-zinc-300">Texto hablado de esta escena</label><textarea id="scene-transcript" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} rows={4} maxLength={1000} placeholder="Pega aquí el texto que se usará para los subtítulos. Puedes hacerlo después de subir el video." className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white outline-none focus:border-violet-400/40" /><p className="mt-1 text-[10px] text-zinc-600">{saving ? "Guardando texto…" : "Se guarda al salir del campo. Sin texto, el render no inventará subtítulos."}</p>{error && <p className="mt-1 text-[10px] text-red-300">{error}</p>}</div>;
}

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<StudioView>("summary");
  const [portfolioId, setPortfolioId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [editorSessionId, setEditorSessionId] = useState("");
  const [editorResultId, setEditorResultId] = useState("");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [showNewSession, setShowNewSession] = useState(false);
  const [planStage, setPlanStage] = useState(false);
  const [editingPlanSessionId, setEditingPlanSessionId] = useState("");
  const [showNewPortfolio, setShowNewPortfolio] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [portfolioForm, setPortfolioForm] = useState({ name: "", niche: "", essence: "", accent: "violet" });
  const [saving, setSaving] = useState(false);
  const [addingScene, setAddingScene] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newUploadInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prompterRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef("");
  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [teleprompter, setTeleprompter] = useState(true);
  const [scrollSpeed, setScrollSpeed] = useState(2);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [batchUpload, setBatchUpload] = useState<{ current: number; total: number; file: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api<Dashboard>("/api/studio");
      setData(next);
      setPortfolioId((current) => current && next.portfolios.some((item) => item.id === current) ? current : next.portfolios[0]?.id || "");
      setSessionId((current) => current && next.sessions.some((item) => item.id === current) ? current : next.sessions[0]?.id || "");
      setError("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo abrir Segmenta Studio.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const openStudio = async () => {
      try {
        if (active) await refresh();
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "No se pudo abrir Segmenta Studio.");
        setLoading(false);
      }
    };
    openStudio();
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    const access = new URLSearchParams(window.location.search).get("access");
    if (access === "1") {
      const frame = window.requestAnimationFrame(() => {
        setShowAccount(true);
      });
      window.history.replaceState(null, "", window.location.pathname);
      return () => window.cancelAnimationFrame(frame);
    }
  }, []);
  useEffect(() => { previewUrlRef.current = previewUrl; }, [previewUrl]);
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const portfolios = data?.portfolios || [];
  const sessions = useMemo(() => (data?.sessions || []).filter((item) => item.portfolioId === portfolioId), [data, portfolioId]);
  const activeSession = sessions.find((item) => item.id === sessionId) || sessions[0];
  const sessionScenes = useMemo(() => (data?.scenes || []).filter((item) => item.sessionId === activeSession?.id).sort((a, b) => a.position - b.position), [data, activeSession]);
  const activeScene = sessionScenes[Math.min(sceneIndex, Math.max(0, sessionScenes.length - 1))];
  const currentPortfolio = portfolios.find((item) => item.id === portfolioId) || portfolios[0];
  const approvedCount = sessionScenes.filter((scene) => scene.selectedTakeId).length;
  const guideSessionIds = new Set(sessions.map((item) => item.id));
  const guideContext = {
    view,
    projectCount: sessions.length,
    approvedCount: (data?.scenes || []).filter((scene) => guideSessionIds.has(scene.sessionId) && scene.selectedTakeId).length,
    readyCount: (data?.editJobs || []).filter((job) => guideSessionIds.has(job.sessionId) && job.status === "ready").length,
  };

  const guideAction = (action: GuideAction) => {
    if (action.destination === "upload") newUploadInputRef.current?.click();
    else setView(action.destination === "projects" ? "projects" : action.destination);
  };

  const continueOutput = async (output: RenderOutput) => {
    const original = output.sessionId && sessions.find((item) => item.id === output.sessionId);
    const hasEditableSources = Boolean(original
      && (data?.scenes || []).some((scene) => scene.sessionId === original.id && scene.selectedTakeId)
      && (data?.editJobs || []).some((job) => job.id === output.id && job.sessionId === original.id && job.status === "ready" && Array.isArray(job.contract?.clips) && job.contract.clips.length));
    if (original && hasEditableSources) {
      const draftBaselineKey = `segmenta.draft-baseline.v1:${original.portfolioId}:${original.id}`;
      const previousBaseline = window.localStorage.getItem(draftBaselineKey);
      if (previousBaseline && previousBaseline !== output.id) {
        window.localStorage.removeItem(`segmenta.timeline.v1:${original.portfolioId}:${original.id}`);
        window.localStorage.removeItem(`segmenta.editor-preferences.v1:${original.portfolioId}:${original.id}`);
        window.localStorage.removeItem(`segmenta.timeline-pending.v1:${original.portfolioId}:${original.id}`);
      }
      window.localStorage.setItem(draftBaselineKey, output.id);
      setPortfolioId(original.portfolioId);
      setEditorSessionId(original.id);
      setEditorResultId(output.id);
      setSessionId(original.id);
      setView("edit");
      return;
    }
    if (!portfolioId) throw new Error("Selecciona un portafolio antes de continuar.");
    const durationSeconds = await videoDuration(output.previewUrl);
    const result = await api<{ session: { id: string; portfolioId: string } }>(`/api/editor/outputs/${output.id}/continue`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolioId, sourceSessionId: output.sessionId, durationSeconds }),
    });
    await refresh();
    setPortfolioId(result.session.portfolioId);
    setSessionId(result.session.id);
    setEditorSessionId(result.session.id);
    setEditorResultId("");
    setView("edit");
  };

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async (nextFacing = facing) => {
    setError("");
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no permite usar la cámara. Abre la aplicación desde Safari o Chrome actualizado.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setError("No pudimos abrir la cámara. Permite cámara y micrófono en el navegador y vuelve a intentarlo.");
    }
  }, [facing, stopCamera]);

  const toggleCamera = async () => {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    await startCamera(next);
  };

  const clearRecording = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setRecordedBlob(null);
    setElapsed(0);
    setUploadProgress(0);
    chunksRef.current = [];
  }, [previewUrl]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
  }, []);

  const beginRecording = async () => {
    if (!cameraReady || !streamRef.current) return startCamera();
    clearRecording();
    setCountdown(3);
    for (let value = 3; value > 0; value -= 1) {
      setCountdown(value);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    setCountdown(0);
    const supported = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    try {
      const recorder = new MediaRecorder(streamRef.current, { ...(supported ? { mimeType: supported } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || supported || "video/webm" });
        setRecordedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
      };
      if (prompterRef.current) prompterRef.current.scrollTop = 0;
      startedAtRef.current = Date.now();
      recorder.start(1000);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const value = Date.now() - startedAtRef.current;
        setElapsed(value);
        if (value >= 180_000 && recorder.state === "recording") stopRecording();
      }, 200);
    } catch {
      setError("La cámara abrió, pero este navegador no pudo iniciar la grabación.");
    }
  };

  useEffect(() => {
    if (!recording || !teleprompter) return;
    const timer = setInterval(() => { if (prompterRef.current) prompterRef.current.scrollTop += scrollSpeed * 0.35; }, 50);
    return () => clearInterval(timer);
  }, [recording, teleprompter, scrollSpeed]);

  const uploadBlobToScene = async (blob: Blob, sessionId: string, sceneId: string, durationMs: number, status: "approved" | "blooper", onProgress: (percent: number) => void) => {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Tu sesión venció. Vuelve a iniciar sesión.");
    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const projectId = new URL(projectUrl).hostname.split(".")[0];
    const mimeType = videoMimeType(blob);
    const extension = mimeType.includes("quicktime") ? "mov" : mimeType.includes("webm") ? "webm" : "mp4";
    const objectKey = `${session.user.id}/${sessionId}/${sceneId}/${crypto.randomUUID()}.${extension}`;
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(blob, {
        endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${session.access_token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024,
        metadata: { bucketName: "kiko-videos", objectName: objectKey, contentType: mimeType, cacheControl: "3600" },
        onError: (reason) => reject(reason),
        onProgress: (uploaded, total) => onProgress(Math.max(1, Math.round((uploaded / total) * 96))),
        onSuccess: () => resolve(),
      });
      upload.findPreviousUploads().then((previous) => {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch(reject);
    });
    onProgress(98);
    await api("/api/takes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectKey, sceneId, sessionId, durationMs, status, bytes: blob.size, mimeType }) });
    onProgress(100);
  };

  const uploadTake = async (status: "approved" | "blooper") => {
    if (!recordedBlob || !activeScene || !activeSession) throw new Error("No hay una toma lista para subir.");
    await uploadBlobToScene(recordedBlob, activeSession.id, activeScene.id, elapsed, status, setUploadProgress);
  };

  const beginNewUpload = async (files: FileList | null) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (selected.length > 12) return setError("Puedes subir hasta 12 videos por proyecto.");
    if (selected.some((file) => !isVideoFile(file))) return setError("Selecciona solo videos MP4, MOV o WebM.");
    if (!portfolioId) return setError("No pudimos identificar el portafolio. Recarga el estudio e inténtalo otra vez.");
    setUploading(true); setUploadProgress(0); setError("");
    let current = 0;
    try {
      const result = await api<{ session: { id: string }; scenes: Array<{ id: string }> }>("/api/studio", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_session", portfolioId, title: selected.length === 1 ? fileTitle(selected[0]) : `Edición de ${selected.length} videos`, script: "", sceneCount: selected.length, sceneTitles: selected.map(fileTitle) }),
      });
      setSessionId(result.session.id); setView("library");
      await refresh();
      for (const [index, file] of selected.entries()) {
        current = index + 1;
        setBatchUpload({ current, total: selected.length, file: file.name });
        const url = URL.createObjectURL(file);
        let durationMs = 0;
        try { durationMs = Math.round((await videoDuration(url)) * 1000); }
        catch { /* The video remains uploadable even when this browser cannot read its duration. */ }
        finally { URL.revokeObjectURL(url); }
        await uploadBlobToScene(file, result.session.id, result.scenes[index].id, durationMs, "approved", setUploadProgress);
        await refresh();
        setUploadProgress(0);
      }
      await api("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete_session", sessionId: result.session.id }) });
      await refresh();
      setEditorSessionId(result.session.id); setEditorResultId(""); setView("edit");
    } catch (reason) {
      setError(`La carga se detuvo en el video ${current || 1}. ${reason instanceof Error ? reason.message : "Inténtalo nuevamente."} Los videos anteriores permanecen en el proyecto.`);
    } finally { setBatchUpload(null); setUploading(false); setUploadProgress(0); }
  };

  const importIntoCurrentSession = async (files: FileList | null) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (!activeSession) return setError("Selecciona un proyecto antes de añadir videos.");
    if (selected.some((file) => !isVideoFile(file))) return setError("Selecciona solo videos MP4, MOV o WebM.");
    const openScenes = sessionScenes.filter((scene) => !scene.selectedTakeId);
    if (selected.length > openScenes.length + 12 - sessionScenes.length) return setError("Este proyecto admite hasta 12 videos. Usa «Subir videos» para crear otro proyecto.");
    setUploading(true); setUploadProgress(0); setError("");
    let current = 0;
    try {
      for (const file of selected) {
        current += 1;
        setBatchUpload({ current, total: selected.length, file: file.name });
        const scene = openScenes.shift() || (await api<{ scene: { id: string } }>("/api/studio", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add_scene", sessionId: activeSession.id, title: fileTitle(file) }),
        })).scene;
        const url = URL.createObjectURL(file);
        let durationMs = 0;
        try { durationMs = Math.round((await videoDuration(url)) * 1000); }
        catch { /* Import remains available even if metadata needs later inspection. */ }
        finally { URL.revokeObjectURL(url); }
        await uploadBlobToScene(file, activeSession.id, scene.id, durationMs, "approved", setUploadProgress);
        await refresh();
        setUploadProgress(0);
      }
      setEditorSessionId(activeSession.id); setEditorResultId(""); setView("edit");
    } catch (reason) {
      setError(`La carga se detuvo en el video ${current || 1}. ${reason instanceof Error ? reason.message : "Inténtalo nuevamente."} Los videos anteriores permanecen en el proyecto.`);
    } finally { setBatchUpload(null); setUploading(false); setUploadProgress(0); }
  };

  const classifyRecording = async (status: "approved" | "blooper") => {
    setUploading(true); setUploadProgress(1); setError("");
    try {
      await uploadTake(status);
      await refresh();
      clearRecording();
      if (status === "approved" && sceneIndex < sessionScenes.length - 1) setSceneIndex((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la toma.");
    } finally { setUploading(false); }
  };

  const discardPreview = () => {
    clearRecording();
  };

  const createSession = async (preproductionPlan?: PreproductionPlan) => {
    if (!portfolioId) return setError("Crea o selecciona un portafolio antes de subir videos.");
    setSaving(true); setError("");
    try {
      const result = await api<{ session: { id: string } }>("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_session", portfolioId, title, script, ...(preproductionPlan ? { preproductionPlan } : {}) }) });
      setSessionId(result.session.id); setTitle(""); setScript(""); setShowNewSession(false); setPlanStage(false); setSceneIndex(0);
      await refresh();
      setView("record");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear la grabación."); }
    finally { setSaving(false); }
  };

  const importNewSessionScript = async (file?: File) => {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 30_000) return setError("Sube un libreto .txt o .md de hasta 30 KB.");
    const content = await file.text();
    if (content.length > 6_000) return setError("El libreto admite hasta 6.000 caracteres.");
    setScript(content);
    setError("");
  };

  const closeSessionDialog = () => {
    setShowNewSession(false);
    setPlanStage(false);
  };

  const saveExistingPlan = async (preproductionPlan: PreproductionPlan) => {
    setSaving(true); setError("");
    try {
      await api("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_preproduction_plan", sessionId: editingPlanSessionId, preproductionPlan }) });
      setEditingPlanSessionId("");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el plan."); }
    finally { setSaving(false); }
  };

  const createPortfolio = async () => {
    setSaving(true); setError("");
    try {
      const result = await api<{ portfolio: { id: string } }>("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_portfolio", ...portfolioForm }) });
      setPortfolioId(result.portfolio.id); setSessionId(""); setSceneIndex(0); setPortfolioForm({ name: "", niche: "", essence: "", accent: "violet" }); setShowNewPortfolio(false);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear el portafolio."); }
    finally { setSaving(false); }
  };

  const removeTake = async (id: string) => {
    try { await api("/api/takes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo eliminar la toma."); }
  };

  const removeSession = async (id: string) => {
    if (!confirm("¿Eliminar esta grabación y todas sus tomas?")) return;
    try { await api("/api/studio", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id }) }); setSessionId(""); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo eliminar la grabación."); }
  };

  const addScene = async () => {
    if (!activeSession) return;
    setAddingScene(true); setError("");
    try {
      await api("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_scene", sessionId: activeSession.id }) });
      clearRecording();
      await refresh();
      setSceneIndex(sessionScenes.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo añadir la escena."); }
    finally { setAddingScene(false); }
  };

  const saveSceneScript = async (sceneId: string, text: string) => {
    await api("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_scene_script", sceneId, script: text }) });
    await refresh();
  };

  if (loading && !data) return <main className="grid min-h-screen place-items-center bg-[#070910] text-white"><div className="text-center"><LoaderCircle className="mx-auto animate-spin text-violet-300" /><p className="mt-3 text-sm text-zinc-500">Abriendo tu estudio en la nube…</p></div></main>;

  return (
    <main className="min-h-screen bg-[#070910] pb-24 text-white">
      <input ref={newUploadInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.webm" multiple className="hidden" aria-label="Seleccionar videos para un proyecto nuevo" onChange={(event) => { void beginNewUpload(event.currentTarget.files); event.currentTarget.value = ""; }} />
      <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.webm" multiple className="hidden" aria-label="Seleccionar videos para esta producción" onChange={(event) => { void importIntoCurrentSession(event.currentTarget.files); event.currentTarget.value = ""; }} />
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#070910]/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-4 py-3 sm:flex-nowrap sm:gap-3 sm:px-7">
          <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400"><Film size={19} /></span>
            <div><p className="text-sm font-semibold sm:text-base">Segmenta Studio</p><p className="text-[9px] uppercase tracking-[.22em] text-zinc-500">Editor cloud</p></div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
            <InstallAppButton />
            <div className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/8 px-3 py-2 text-xs text-emerald-300 md:flex"><Cloud size={13} />Guardado en nube</div>
            <select value={portfolioId} onChange={(event) => { setPortfolioId(event.target.value); setSessionId(""); setSceneIndex(0); }} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs outline-none sm:max-w-[260px] sm:flex-none sm:text-sm">
              {portfolios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button onClick={() => setShowNewPortfolio(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-zinc-300" aria-label="Nuevo portafolio"><Plus size={17} /></button>
            <button onClick={() => setShowAccount(true)} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-400/10 px-3 text-xs font-medium text-violet-100" aria-label="Cuenta y acceso"><UserRound size={16} /><span className="hidden sm:inline">Cuenta</span></button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1650px] gap-5 px-3 py-3 sm:px-7 sm:py-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="hidden lg:block"><div className="sticky top-24 rounded-3xl border border-white/8 bg-white/[.025] p-3"><p className="px-3 pb-3 pt-2 text-[9px] font-bold uppercase tracking-[.2em] text-zinc-600">Segmenta Studio</p><nav className="space-y-1">{STUDIO_NAV.map((item) => <button key={item.id} onClick={() => setView(item.id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-xs transition ${view === item.id ? "bg-violet-400/15 font-medium text-violet-100" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"}`}>{item.label}</button>)}</nav><div className="mt-4 rounded-2xl border border-amber-300/10 bg-amber-300/5 p-3"><p className="text-[10px] font-medium text-amber-200">Motor híbrido</p><p className="mt-1 text-[9px] leading-4 text-zinc-600">Nube para proyectos y dirección. Motor local para las capacidades avanzadas aún no migradas.</p></div></div></aside>
        <div className="min-w-0">
        <nav className="mb-3 flex gap-1 overflow-x-auto rounded-2xl border border-white/8 bg-white/[.025] p-1.5 lg:hidden">{STUDIO_NAV.map((item) => <button key={item.id} onClick={() => setView(item.id)} className={`shrink-0 rounded-xl px-3 py-2 text-[10px] ${view === item.id ? "bg-violet-500 text-white" : "text-zinc-500"}`}>{item.label}</button>)}</nav>
        {error && <div className="mb-5 flex items-start justify-between rounded-2xl border border-red-400/20 bg-red-400/8 p-4 text-sm text-red-100"><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-violet-400/20 bg-violet-400/[.07] p-2.5 sm:mb-5 sm:p-3">
          <div className="min-w-0 pl-1"><strong className="block text-xs font-medium text-white sm:text-sm">¿Ya tienes videos grabados?</strong><span className="block truncate text-[10px] text-zinc-500 sm:text-xs">Sube varios MP4, MOV o WebM a un proyecto nuevo.</span></div>
          <button onClick={() => newUploadInputRef.current?.click()} disabled={uploading || saving} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-3 text-xs font-semibold text-white disabled:opacity-40 sm:px-5 sm:text-sm"><UploadCloud size={16} />Subir videos</button>
        </div>
        <section className={`mb-3 overflow-hidden rounded-2xl bg-gradient-to-r sm:mb-5 sm:rounded-3xl ${view === "record" || view === "edit" ? "hidden sm:block" : ""} ${accentClasses[currentPortfolio?.accent] || accentClasses.violet} p-[1px]`}>
          <div className="flex flex-col justify-between gap-3 rounded-[15px] bg-[#0c0f18]/95 p-3.5 sm:gap-4 sm:rounded-[23px] sm:p-5 sm:flex-row sm:items-center">
            <div className="min-w-0"><p className="truncate text-[9px] font-bold uppercase tracking-[.18em] text-violet-300 sm:text-[10px]">{currentPortfolio?.niche}</p><h1 className="mt-0.5 truncate text-lg font-semibold sm:mt-1 sm:text-2xl">{currentPortfolio?.name || "Tu portafolio"}</h1><p className="mt-0.5 truncate text-xs text-zinc-500 sm:mt-1 sm:text-sm">{currentPortfolio?.essence}</p></div>
            <div className="flex w-full min-w-0 rounded-2xl border border-white/8 bg-black/25 p-1 sm:w-auto">
              <button onClick={() => setView("record")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs sm:gap-2 sm:px-4 sm:text-sm ${view === "record" ? "bg-white text-black" : "text-zinc-400"}`}><Camera size={15} />Grabar</button>
              <button onClick={() => setView("library")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs sm:gap-2 sm:px-4 sm:text-sm ${view === "library" ? "bg-white text-black" : "text-zinc-400"}`}><Library size={15} />Tomas</button>
              <button onClick={() => setView("edit")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs sm:gap-2 sm:px-4 sm:text-sm ${view === "edit" ? "bg-white text-black" : "text-zinc-400"}`}><Sparkles size={15} />Editor</button>
            </div>
          </div>
        </section>

        {WORKSPACE_NAV.some((item) => item.id === view) ? <WorkspaceStudio view={view as WorkspaceView} portfolioId={portfolioId} portfolio={currentPortfolio} sessions={data?.sessions || []} scenes={data?.scenes || []} onOpenEditor={() => setView("edit")} onOpenResults={() => setView("library")} /> : view === "edit" ? <EditorStudio initialSessionId={editorSessionId} initialResultId={editorResultId} portfolioId={portfolioId} sessions={data?.sessions || []} scenes={data?.scenes || []} takes={data?.takes || []} editJobs={data?.editJobs || []} preproductionPlans={data?.preproductionPlans || []} onRefresh={refresh} onBack={() => setView("record")} onUpload={() => newUploadInputRef.current?.click()} onAddToCurrent={(id) => { setSessionId(id); setSceneIndex(Math.max(0, (data?.scenes || []).filter((scene) => scene.sessionId === id).length - 1)); setView("record"); }} /> : view === "record" ? (
          !sessions.length ? <section className="overflow-hidden rounded-2xl border border-white/8 bg-white/[.025] sm:rounded-3xl">
            <div className="bg-[radial-gradient(circle_at_100%_0%,rgba(124,58,237,.18),transparent_42%)] p-5 sm:p-10">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-400/12 text-violet-200"><Video size={20} /></span>
              <p className="mt-5 text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">Tu primer rodaje</p>
              <h2 className="mt-1 text-2xl font-semibold leading-tight">Graba en orden, sin guardar errores</h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-500">Sube videos o graba con la cámara. El libreto y el plan de edición puedes añadirlos después.</p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[10px] text-zinc-400 sm:max-w-lg sm:text-xs">
                <span className="rounded-xl border border-white/8 bg-black/20 px-2 py-3"><b className="mb-1 block text-violet-300">1</b>Subir</span>
                <span className="rounded-xl border border-white/8 bg-black/20 px-2 py-3"><b className="mb-1 block text-violet-300">2</b>Editar</span>
                <span className="rounded-xl border border-white/8 bg-black/20 px-2 py-3"><b className="mb-1 block text-violet-300">3</b>Exportar</span>
              </div>
              <button onClick={() => setShowNewSession(true)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-3.5 text-sm font-semibold sm:w-auto"><Plus size={17} />Crear mi primera grabación</button>
            </div>
          </section> :
          <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_330px]">
            <aside className="space-y-4">
              <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-zinc-600">Producciones</p><h2 className="mt-1 font-medium">Tus grabaciones</h2></div><button onClick={() => setShowNewSession(true)} className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500 text-white"><Plus size={16} /></button></div>
              <div className="space-y-2">
                {sessions.map((item) => {
                  const scenesForItem = (data?.scenes || []).filter((scene) => scene.sessionId === item.id);
                  const done = scenesForItem.filter((scene) => scene.selectedTakeId).length;
                  return <button key={item.id} onClick={() => { setSessionId(item.id); setSceneIndex(0); }} className={`w-full rounded-2xl border p-4 text-left transition ${activeSession?.id === item.id ? "border-violet-400/35 bg-violet-400/10" : "border-white/8 bg-white/[.025]"}`}><div className="flex items-start justify-between gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5"><Video size={16} /></span><span className="text-[10px] text-zinc-600">{done}/{scenesForItem.length}</span></div><h3 className="mt-3 truncate text-sm font-medium">{item.title}</h3><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-violet-400" style={{ width: `${scenesForItem.length ? (done / scenesForItem.length) * 100 : 0}%` }} /></div></button>;
                })}
                {!sessions.length && <button onClick={() => setShowNewSession(true)} className="w-full rounded-2xl border border-dashed border-violet-400/25 bg-violet-400/5 p-6 text-center text-sm text-violet-200"><Plus className="mx-auto mb-2" />Crear la primera grabación</button>}
              </div>
            </aside>

            <section className="min-w-0">
              {activeSession && activeScene ? <>
                <div className="mx-auto mb-3 flex max-w-[480px] items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[.03] px-3 py-2.5"><span className="min-w-0 truncate text-xs text-zinc-400">{activeScene.title}</span><button onClick={() => fileInputRef.current?.click()} disabled={recording || uploading || Boolean(previewUrl)} className="flex shrink-0 items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-400/10 px-3 py-2 text-xs font-medium text-violet-100 disabled:opacity-40"><UploadCloud size={15} />Añadir videos</button></div>
                <div className="relative mx-auto aspect-[9/16] max-h-[76vh] w-full max-w-[480px] overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl">
                  {previewUrl ? <video src={previewUrl} controls playsInline className="h-full w-full object-contain" /> : <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`} />}
                  {!cameraReady && !previewUrl && <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_25%,rgba(124,58,237,.22),transparent_55%)]"><div className="max-w-sm px-7 text-center"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-white/5"><Camera size={28} className="text-violet-200" /></span><h2 className="mt-5 text-xl font-semibold">Graba o importa tu video</h2><p className="mt-2 text-sm leading-6 text-zinc-500">Puedes grabar desde el celular o subir el video que ya tienes. La carga se reanuda si tu conexión se interrumpe.</p><div className="mt-6 grid gap-2 sm:grid-cols-2"><button onClick={() => startCamera()} className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black">Activar cámara</button><button onClick={() => fileInputRef.current?.click()} className="rounded-2xl border border-violet-300/30 bg-violet-400/10 px-4 py-3 text-sm font-semibold text-violet-100"><UploadCloud className="mr-2 inline" size={16} />Subir video</button></div></div></div>}
                  {cameraReady && !previewUrl && teleprompter && <div className="pointer-events-none absolute inset-x-5 top-[15%] h-[42%] overflow-hidden rounded-2xl bg-black/48 px-5 py-6 text-center backdrop-blur-sm"><div ref={prompterRef} className="h-full overflow-hidden scroll-smooth"><div className="h-[35%]" /><p className="text-xl font-semibold leading-8 text-white drop-shadow sm:text-2xl sm:leading-10">{activeScene.script}</p><div className="h-[70%]" /></div></div>}
                  {cameraReady && !previewUrl && <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4"><span className={`rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur ${recording ? "bg-red-500 text-white" : "bg-black/45 text-zinc-200"}`}>{recording ? `● REC ${formatTime(elapsed)}` : activeScene.title}</span><button onClick={toggleCamera} disabled={recording} className="grid h-10 w-10 place-items-center rounded-full bg-black/45 backdrop-blur disabled:opacity-40"><FlipHorizontal2 size={17} /></button></div>}
                  {countdown > 0 && <div className="absolute inset-0 grid place-items-center bg-black/30 text-8xl font-black">{countdown}</div>}
                  {uploading && <div className="absolute inset-0 grid place-items-center bg-black/80 p-8 text-center"><div className="w-full max-w-xs"><UploadCloud className="mx-auto text-violet-300" size={32} /><p className="mt-4 font-medium">Guardando la toma en la nube</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" style={{ width: `${uploadProgress}%` }} /></div><p className="mt-2 text-xs text-zinc-500">{uploadProgress}% · no cierres esta pantalla</p></div></div>}
                  {cameraReady && !previewUrl && <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-6 bg-gradient-to-t from-black via-black/65 to-transparent px-5 pb-7 pt-16"><button onClick={() => setTeleprompter((value) => !value)} className={`grid h-11 w-11 place-items-center rounded-full border ${teleprompter ? "border-violet-300 bg-violet-400/20" : "border-white/15 bg-black/30"}`}><Sparkles size={17} /></button><button onClick={recording ? stopRecording : beginRecording} className={`grid h-20 w-20 place-items-center rounded-full border-4 border-white shadow-xl ${recording ? "bg-red-500" : "bg-white"}`}>{recording ? <Square size={25} fill="white" /> : <Circle size={54} className="text-red-500" fill="currentColor" />}</button><span className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/30"><Mic size={17} /></span></div>}
                  {previewUrl && !uploading && <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent p-5 pt-20"><p className="mb-4 text-center text-sm font-medium">¿Qué hacemos con esta toma?</p><div className="grid grid-cols-3 gap-2"><button onClick={discardPreview} className="rounded-xl border border-white/15 bg-black/50 px-2 py-3 text-xs"><RotateCcw size={16} className="mx-auto mb-1" />Repetir</button><button onClick={() => classifyRecording("blooper")} className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-2 py-3 text-xs text-amber-200"><Aperture size={16} className="mx-auto mb-1" />Blooper</button><button onClick={() => classifyRecording("approved")} className="rounded-xl bg-emerald-400 px-2 py-3 text-xs font-semibold text-black"><Check size={16} className="mx-auto mb-1" />Aprobar</button></div></div>}
                </div>
                <div className="mx-auto mt-4 flex max-w-[480px] items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[.03] p-3"><label className="text-xs text-zinc-500">Velocidad del libreto</label><input type="range" min="1" max="6" value={scrollSpeed} onChange={(event) => setScrollSpeed(Number(event.target.value))} className="accent-violet-500" /><span className="text-xs text-zinc-500">{scrollSpeed}x</span></div>
              </> : <div className="grid min-h-[320px] place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[.02] p-6 text-center sm:min-h-[560px] sm:p-8"><div><FolderOpen className="mx-auto text-zinc-700" size={36} /><h2 className="mt-4 text-lg font-semibold sm:mt-5 sm:text-xl">Elige una grabación</h2><p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">Selecciona una producción para continuar con sus escenas.</p></div></div>}
            </section>

            <aside className="space-y-4">
              {activeSession && <><section className="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Dirección antes de editar</p><p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-300">{String(data?.preproductionPlans?.find((item) => item.sessionId === activeSession.id)?.contract?.description || "Este proyecto aún no tiene un plan de edición previo.")}</p><button onClick={() => setEditingPlanSessionId(activeSession.id)} className="mt-3 rounded-lg border border-violet-400/30 px-3 py-2 text-xs text-violet-100">Revisar escenas, skills y sonido</button></section><section className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">Plan de rodaje</p><h2 className="mt-1 font-medium">{activeSession.title}</h2></div><button onClick={() => removeSession(activeSession.id)} className="text-zinc-600 hover:text-red-300"><Trash2 size={16} /></button></div><div className="mt-5 space-y-2">{sessionScenes.map((scene, index) => <button key={scene.id} onClick={() => { clearRecording(); setSceneIndex(index); }} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left ${activeScene?.id === scene.id ? "border-violet-400/30 bg-violet-400/10" : "border-white/6 bg-black/15"}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${scene.selectedTakeId ? "bg-emerald-400 text-black" : "bg-white/6 text-zinc-500"}`}>{scene.selectedTakeId ? <Check size={14} /> : index + 1}</span><span className="min-w-0"><strong className="block text-xs font-medium">{scene.title}</strong><small className="block truncate text-zinc-600">{scene.script}</small></span><ChevronRight className="ml-auto shrink-0 text-zinc-700" size={14} /></button>)}</div><button onClick={addScene} disabled={addingScene || sessionScenes.length >= 12 || uploading || Boolean(previewUrl)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-violet-400/25 px-3 py-2.5 text-xs text-violet-200 disabled:opacity-40">{addingScene ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}Añadir escena para otro video</button><SceneTranscriptEditor key={activeScene.id} sceneId={activeScene.id} initialScript={String(activeScene.script || "")} onSave={saveSceneScript} /><div className="mt-5 flex items-center justify-between text-xs text-zinc-500"><span>{approvedCount} de {sessionScenes.length} aprobadas</span><span>{Math.round((approvedCount / Math.max(1, sessionScenes.length)) * 100)}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${(approvedCount / Math.max(1, sessionScenes.length)) * 100}%` }} /></div><button onClick={() => setView("edit")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black"><CheckCircle2 size={16} />Ir al editor</button></section><section className="rounded-3xl border border-cyan-400/15 bg-cyan-400/5 p-5"><p className="flex items-center gap-2 text-sm font-medium text-cyan-200"><Cloud size={16} />Flujo conectado</p><p className="mt-2 text-xs leading-5 text-zinc-500">Las tomas aprobadas conservan el orden del libreto. Bloopers queda separado y no entra al montaje principal.</p></section></>}
            </aside>
          </div>
        ) : (
          <section>
            <RenderResults sessions={sessions} editableOutputIds={(data?.editJobs || []).filter((job) => job.status === "ready" && sessions.some((item) => item.id === job.sessionId && (data?.scenes || []).some((scene) => scene.sessionId === item.id && scene.selectedTakeId)) && Array.isArray(job.contract?.clips) && job.contract.clips.length).map((job) => job.id)} onEditOutput={continueOutput} />
            <div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">Biblioteca cloud</p><h2 className="mt-1 text-2xl font-semibold">Tomas de {currentPortfolio?.name}</h2></div><div className="hidden gap-2 sm:flex"><button onClick={() => setView("edit")} className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold"><Sparkles size={15} />Abrir editor</button><button onClick={() => setView("record")} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm"><ArrowLeft size={15} />Volver a grabar</button></div></div>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{sessions.map((session) => { const sceneRows = (data?.scenes || []).filter((scene) => scene.sessionId === session.id); const allTakes = (data?.takes || []).filter((take) => take.sessionId === session.id); return <article key={session.id} className="rounded-3xl border border-white/8 bg-white/[.03] p-5"><div className="flex items-start justify-between"><div><span className={`rounded-full px-2.5 py-1 text-[10px] ${session.status === "ready_for_edit" ? "bg-emerald-400/10 text-emerald-300" : "bg-violet-400/10 text-violet-300"}`}>{session.status === "ready_for_edit" ? "Lista para edición" : "En grabación"}</span><h3 className="mt-3 font-medium">{session.title}</h3><p className="mt-1 text-xs text-zinc-600">{sceneRows.filter((scene) => scene.selectedTakeId).length}/{sceneRows.length} escenas aprobadas · {allTakes.filter((take) => take.status === "blooper").length} bloopers</p></div><button onClick={() => removeSession(session.id)} className="text-zinc-700 hover:text-red-300"><Trash2 size={16} /></button></div><div className="mt-5 grid grid-cols-3 gap-2">{allTakes.slice(0, 6).map((take) => <div key={take.id} className="group relative aspect-[9/16] overflow-hidden rounded-xl bg-black"><video src={`/api/media/${take.id}`} className="h-full w-full object-cover" preload="metadata" /><span className={`absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-1 text-[8px] ${take.status === "approved" ? "text-emerald-300" : take.status === "blooper" ? "text-amber-200" : "text-zinc-300"}`}>{statusLabel(take.status)}</span><button onClick={() => removeTake(take.id)} aria-label="Eliminar toma" className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/70 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={11} /></button></div>)}</div><button onClick={() => { setSessionId(session.id); setView("record"); }} className="mt-5 flex w-full items-center justify-between rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm">Abrir producción <ChevronRight size={15} /></button></article>; })}</div>
            {!sessions.length && <div className="grid min-h-[420px] place-items-center rounded-3xl border border-dashed border-white/10 text-center"><div><Library className="mx-auto text-zinc-700" size={40} /><p className="mt-4 text-zinc-500">Todavía no hay tomas en este portafolio.</p></div></div>}
          </section>
        )}
        </div>
      </div>

      <PenguinGuide context={guideContext} onAction={guideAction} />

      {batchUpload && <div role="status" aria-live="polite" className="fixed inset-x-3 bottom-4 z-[80] mx-auto max-w-lg rounded-2xl border border-violet-400/30 bg-[#151525] p-4 text-white shadow-2xl sm:bottom-6">
        <div className="flex items-center gap-3"><UploadCloud size={20} className="shrink-0 text-violet-200" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Subiendo video {batchUpload.current} de {batchUpload.total}</p><p className="truncate text-xs text-zinc-400">{batchUpload.file}</p></div><strong className="text-sm tabular-nums text-violet-200">{uploadProgress}%</strong></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" style={{ width: String(uploadProgress) + "%" }} /></div>
        <p className="mt-2 text-[11px] text-zinc-400">El proyecto y cada video se guardan al terminar su carga. Puedes escribir el libreto después.</p>
      </div>}

      {showNewSession && <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="new-session-title" className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-[#111521] p-6 shadow-2xl">
          {planStage ? <PreproductionPlanner title={title} script={script} essence={String(currentPortfolio?.essence || "claro, humano y visual")} busy={saving} error={error} onConfirm={(plan) => void createSession(plan)} onBack={() => setPlanStage(false)} /> : <>
            <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">Nueva producción</p><h2 id="new-session-title" className="mt-1 text-xl font-semibold">Empieza como quieras</h2></div><button onClick={closeSessionDialog} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><X size={16} /></button></div>
            <p className="mt-3 text-sm text-zinc-400">Puedes crear el proyecto ahora. El nombre, el libreto y el plan de edición se pueden completar después.</p>
            <label className="mt-6 block text-xs text-zinc-400">Nombre del proyecto (opcional)<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="Nueva producción" className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40" /></label>
            <label className="mt-4 block text-xs text-zinc-400">Libreto (opcional)<textarea value={script} onChange={(event) => setScript(event.target.value)} rows={6} maxLength={6000} placeholder="Puedes pegarlo ahora o añadirlo desde el editor." className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-white outline-none focus:border-violet-400/40" /></label>
            <label className="mt-3 inline-flex cursor-pointer rounded-xl border border-violet-400/25 px-3 py-2 text-xs text-violet-200">Subir libreto .txt o .md<input type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={(event) => { void importNewSessionScript(event.target.files?.[0]); event.target.value = ""; }} /></label>
            <div className="mt-6 grid gap-2 sm:grid-cols-2"><button onClick={() => void createSession()} disabled={saving} className="flex items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3.5 text-sm font-semibold disabled:opacity-40">{saving ? <LoaderCircle className="animate-spin" size={17} /> : <Video size={17} />}Crear proyecto ahora</button><button onClick={() => { setError(""); setPlanStage(true); }} disabled={saving} className="rounded-2xl border border-violet-400/25 px-4 py-3.5 text-sm text-violet-200 disabled:opacity-40">Diseñar edición con IA (opcional)</button></div>
          </>}
        </div>
      </div>}

      {editingPlanSessionId && (() => {
        const session = data?.sessions.find((item) => item.id === editingPlanSessionId);
        const stored = data?.preproductionPlans?.find((item) => item.sessionId === editingPlanSessionId)?.contract;
        const parsed = preproductionSchema.safeParse(stored);
        return session ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-label="Plan de edición" className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-[#111521] p-6 shadow-2xl"><PreproductionPlanner key={editingPlanSessionId} title={String(session.title)} script={String(session.script || "")} essence={String(currentPortfolio?.essence || "claro, humano y visual")} initial={parsed.success ? parsed.data : undefined} busy={saving} error={error} onConfirm={(plan) => void saveExistingPlan(plan)} onBack={() => setEditingPlanSessionId("")} /></div></div> : null;
      })()}

      {showAccount && <AccountAccess projectCount={(data?.sessions || []).length} onClose={() => setShowAccount(false)} onChanged={refresh} />}

      {showNewPortfolio && <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#111521] p-6"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-300">Identidad de contenido</p><h2 className="mt-1 text-xl font-semibold">Nuevo portafolio</h2></div><button onClick={() => setShowNewPortfolio(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><X size={16} /></button></div><div className="mt-6 grid gap-4"><input value={portfolioForm.name} onChange={(event) => setPortfolioForm({ ...portfolioForm, name: event.target.value })} placeholder="Nombre del portafolio" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none" /><input value={portfolioForm.niche} onChange={(event) => setPortfolioForm({ ...portfolioForm, niche: event.target.value })} placeholder="Nicho: educación, tecnología…" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none" /><textarea value={portfolioForm.essence} onChange={(event) => setPortfolioForm({ ...portfolioForm, essence: event.target.value })} placeholder="Esencia: directo, divertido, elegante…" rows={3} className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm outline-none" /><div className="flex gap-2">{Object.keys(accentClasses).map((accent) => <button key={accent} onClick={() => setPortfolioForm({ ...portfolioForm, accent })} className={`h-9 flex-1 rounded-xl bg-gradient-to-r ${accentClasses[accent]} ${portfolioForm.accent === accent ? "ring-2 ring-white ring-offset-2 ring-offset-[#111521]" : "opacity-45"}`} />)}</div></div><button onClick={createPortfolio} disabled={saving || !portfolioForm.name.trim()} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-black disabled:opacity-40">{saving && <LoaderCircle className="animate-spin" size={17} />}Crear portafolio</button></div></div>}
    </main>
  );
}
