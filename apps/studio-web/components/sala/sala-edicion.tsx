"use client";

/**
 * Sala de edición en vivo: una vista de computador, estilo programa profesional,
 * donde se ve a cada agente (skill) trabajar sobre la línea de tiempo con su
 * cursor: se mueve, hace clic y el cambio aparece. Las acciones salen de los
 * planes reales de las skills (lib/sala/agents.ts) calculados sobre el mismo
 * audio y los mismos subtítulos que usa el render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FastForward, Pause, Play, TriangleAlert, Volume2, VolumeX, X } from "lucide-react";
import type { CaptionCue } from "../../lib/caption-cues";
import { AGENT_ORDER, SALA_AGENTS, buildSalaScript, type AgentId, type AgentStep, type SalaScript } from "../../lib/sala/agents";
import { voiceActivityFromSamples } from "../../lib/skills/cortes-pausas/voice-core";
import type { Range } from "../../lib/skills/cortes-pausas/plan";
import type { KineticWord } from "../../lib/skills/subtitulos-cineticos/plan";

export type SalaClip = {
  id: string;
  title: string;
  videoUrl: string;
  window: Range;
  cues: CaptionCue[];
  script?: string;
};

export type SalaAudio = { samples: Float32Array; sampleRate: number } | null;

type Props = {
  projectName: string;
  styleName: string;
  uppercase?: boolean;
  soundEffects?: boolean;
  clips: SalaClip[];
  /** Audio mono de la ventana de la toma (empieza en `window.start`). */
  loadAudio: (clip: SalaClip, signal: AbortSignal) => Promise<SalaAudio>;
  onExport?: () => void;
  exportLabel?: string;
  exportStatus?: string;
  onClose?: () => void;
};

type Phase = "escuchando" | "trabajando" | "listo" | "error";
type CursorState = { x: number; y: number; visible: boolean; clicks: number; label: string };
type LogEntry = { id: string; agent: AgentId; label: string; ok?: boolean; at: number };
type Prepared = { script: SalaScript; peaks: Float32Array[]; audio: SalaAudio[]; offsets: number[]; total: number };

const PEAK_BINS = 900;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException("stop", "AbortError")); return; }
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("stop", "AbortError")); }, { once: true });
});

function peaksFor(samples: Float32Array, bins: number) {
  const peaks = new Float32Array(bins);
  const size = Math.max(1, Math.floor(samples.length / bins));
  for (let bin = 0; bin < bins; bin += 1) {
    let max = 0;
    for (let index = bin * size; index < Math.min(samples.length, (bin + 1) * size); index += 1) max = Math.max(max, Math.abs(samples[index]));
    peaks[bin] = max;
  }
  const loudest = peaks.reduce((value, peak) => Math.max(value, peak), 1e-4);
  return peaks.map((peak) => Math.sqrt(peak / loudest));
}

const formatTime = (value: number) => {
  const total = Math.max(0, value);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${(total % 60).toFixed(2).padStart(5, "0")}`;
};

/** Estilo de la palabra en el visor: el mismo de la skill de subtítulos cinéticos. */
function wordStyle(word: KineticWord): React.CSSProperties {
  const size = word.style === "enfasis" ? 138 : word.style === "ligera" ? 92 : 112;
  return {
    fontFamily: "SegmentaMontserrat, Montserrat, sans-serif",
    fontStyle: "italic",
    fontWeight: word.style === "enfasis" ? 900 : word.style === "ligera" ? 300 : 800,
    fontSize: `calc(var(--viewer-width) * ${(size / 1080).toFixed(4)})`,
    color: word.style === "enfasis" ? "#FF7A00" : "#FFFFFF",
    textShadow: word.style === "enfasis" ? "0 0 calc(var(--viewer-width) * .035) rgba(255,122,0,.9), 0 3px 8px rgba(0,0,0,.6)" : "0 3px 8px rgba(0,0,0,.6)",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
}

export function SalaEdicion(props: Props) {
  const { clips, loadAudio } = props;
  const [phase, setPhase] = useState<Phase>("escuchando");
  const [status, setStatus] = useState("Escuchando las tomas para preparar el plan");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const [cursors, setCursors] = useState<Record<AgentId, CursorState>>(() => Object.fromEntries(AGENT_ORDER.map((agent) => [agent, { x: 0, y: 0, visible: false, clicks: 0, label: "" }])) as Record<AgentId, CursorState>);
  const [working, setWorking] = useState<Record<AgentId, string>>(() => Object.fromEntries(AGENT_ORDER.map((agent) => [agent, ""])) as Record<AgentId, string>);
  const [doneCount, setDoneCount] = useState<Record<AgentId, number>>(() => Object.fromEntries(AGENT_ORDER.map((agent) => [agent, 0])) as Record<AgentId, number>);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [styleApplied, setStyleApplied] = useState(false);
  const [analyzed, setAnalyzed] = useState<Set<number>>(new Set());
  const [cuts, setCuts] = useState<Array<{ clipIndex: number; range: Range; reason: string }>>([]);
  const [placed, setPlaced] = useState<Array<{ clipIndex: number; word: KineticWord }>>([]);
  const [sounds, setSounds] = useState<Array<{ clipIndex: number; at: number; effect: string }>>([]);
  const [checks, setChecks] = useState<Array<{ clipIndex: number; ok: boolean; label: string }>>([]);
  const [exportReady, setExportReady] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const sampleRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const cutsRef = useRef(cuts);
  useEffect(() => { cutsRef.current = cuts; }, [cuts]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  // Caption size follows the viewer width, exactly like the 1080-px render.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const observer = new ResizeObserver(() => viewer.style.setProperty("--viewer-width", `${viewer.clientWidth}px`));
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  // 1) Escuchar: audio de cada toma → detección de voz adaptativa → plan real de las skills.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const audio: SalaAudio[] = [];
        const silences: Range[][] = [];
        for (const [index, clip] of clips.entries()) {
          setStatus(`Escuchando la toma ${index + 1} de ${clips.length}`);
          const loaded = await loadAudio(clip, controller.signal);
          audio.push(loaded);
          silences.push(loaded ? voiceActivityFromSamples(loaded.samples, loaded.sampleRate, clip.window.start).silences : []);
        }
        const script = buildSalaScript(clips.map((clip, index) => ({ ...clip, silences: silences[index], hasAudio: Boolean(audio[index]) })), {
          styleName: props.styleName, uppercase: props.uppercase, soundEffects: props.soundEffects,
        });
        const offsets: number[] = [];
        let total = 0;
        clips.forEach((clip) => { offsets.push(total); total += clip.window.end - clip.window.start; });
        setPrepared({ script, audio, peaks: audio.map((item) => item ? peaksFor(item.samples, PEAK_BINS) : new Float32Array(PEAK_BINS)), offsets, total: Math.max(.1, total) });
        setPhase("trabajando");
        setStatus("Los agentes están editando");
      } catch (error) {
        if ((error as DOMException).name === "AbortError") return;
        setPhase("error");
        setStatus(error instanceof Error ? error.message : "No se pudo preparar la sala de edición.");
      }
    })();
    return () => controller.abort();
  }, [clips, loadAudio, props.styleName, props.uppercase, props.soundEffects]);

  // Coordenadas dentro de la sala para un instante de la línea de tiempo.
  const timelinePoint = useCallback((clipIndex: number, seconds: number, track: string) => {
    const root = rootRef.current?.getBoundingClientRect();
    const lane = timelineRef.current?.querySelector<HTMLElement>(`[data-track="${track}"]`)?.getBoundingClientRect();
    if (!root || !lane || !prepared) return { x: 0, y: 0 };
    const clip = clips[clipIndex];
    const position = prepared.offsets[clipIndex] + Math.max(0, seconds - clip.window.start);
    return { x: lane.left - root.left + lane.width * position / prepared.total, y: lane.top - root.top + lane.height / 2 };
  }, [clips, prepared]);

  const elementPoint = useCallback((target: string) => {
    const root = rootRef.current?.getBoundingClientRect();
    const element = rootRef.current?.querySelector<HTMLElement>(`[data-target="${target}"]`)?.getBoundingClientRect();
    if (!root || !element) return { x: 0, y: 0 };
    return { x: element.left - root.left + Math.min(element.width / 2, 60), y: element.top - root.top + element.height / 2 };
  }, []);

  const targetFor = useCallback((step: AgentStep) => {
    const { action, clipIndex } = step;
    switch (action.kind) {
      case "style": return elementPoint("style");
      case "select-clip": return elementPoint(`clip-${clipIndex}`);
      case "analyze": return timelinePoint(clipIndex, clips[clipIndex].window.start + (clips[clipIndex].window.end - clips[clipIndex].window.start) * .5, "voz");
      case "cut": return timelinePoint(clipIndex, (action.range.start + action.range.end) / 2, "voz");
      case "word": return timelinePoint(clipIndex, (action.word.startSeconds + action.word.endSeconds) / 2, "subtitulos");
      case "sound": return timelinePoint(clipIndex, action.at, "sonido");
      case "check": return step.agent === "qa" ? timelinePoint(clipIndex, clips[clipIndex].window.start + .2, "calidad") : timelinePoint(clipIndex, clips[clipIndex].window.start + .3, step.agent === "cortes" ? "voz" : "subtitulos");
      case "export": return elementPoint("export");
    }
  }, [clips, elementPoint, timelinePoint]);

  const apply = useCallback((step: AgentStep) => {
    const { action, clipIndex } = step;
    if (action.kind === "style") setStyleApplied(true);
    if (action.kind === "select-clip") setSelected(clipIndex);
    if (action.kind === "analyze") setAnalyzed((current) => new Set(current).add(clipIndex));
    if (action.kind === "cut") { const { range, reason } = action; setCuts((current) => [...current, { clipIndex, range, reason }]); }
    if (action.kind === "word") { const { word } = action; setPlaced((current) => [...current, { clipIndex, word }]); }
    if (action.kind === "sound") { const { at, effect } = action; setSounds((current) => [...current, { clipIndex, at, effect }]); }
    if (action.kind === "check" && step.agent === "qa") { const { ok } = action; setChecks((current) => [...current, { clipIndex, ok, label: step.label }]); }
    if (action.kind === "export") setExportReady(true);
    if (action.kind !== "word") {
      setLog((current) => [{ id: step.id, agent: step.agent, label: step.label, ok: action.kind === "check" ? action.ok : undefined, at: Date.now() }, ...current].slice(0, 300));
    }
  }, []);

  // 2) Trabajar: cada agente recorre su carril en paralelo; las dependencias evitan pisarse.
  useEffect(() => {
    if (phase !== "trabajando" || !prepared) return;
    const controller = new AbortController();
    const { signal } = controller;
    // Every run starts from a clean timeline (before its first step, which waits ≥ 0.5 s):
    // a restarted plan never duplicates cuts or words.
    void Promise.resolve().then(() => {
      if (signal.aborted) return;
      setStyleApplied(false); setAnalyzed(new Set()); setCuts([]); setPlaced([]); setSounds([]); setChecks([]); setLog([]); setExportReady(false);
      setDoneCount(Object.fromEntries(AGENT_ORDER.map((agent) => [agent, 0])) as Record<AgentId, number>);
    });
    const finished = new Set<string>();
    const waiting = new Map<string, Array<() => void>>();
    const markDone = (id: string) => {
      finished.add(id);
      waiting.get(id)?.forEach((resolve) => resolve());
      waiting.delete(id);
    };
    const waitFor = (ids: string[]) => Promise.all(ids.filter((id) => !finished.has(id)).map((id) => new Promise<void>((resolve, reject) => {
      waiting.set(id, [...(waiting.get(id) ?? []), resolve]);
      signal.addEventListener("abort", () => reject(new DOMException("stop", "AbortError")), { once: true });
    })));
    const pace = (ms: number) => sleep(ms / speedRef.current, signal);
    const runLane = async (agent: AgentId) => {
      for (const step of prepared.script.lanes[agent]) {
        if (step.after?.length) await waitFor(step.after);
        if (signal.aborted) return;
        if (signal.aborted) return;
        const word = step.action.kind === "word";
        const target = targetFor(step);
        setWorking((current) => ({ ...current, [agent]: step.label }));
        setCursors((current) => ({ ...current, [agent]: { ...current[agent], ...target, visible: true, label: step.label } }));
        await pace(word ? 120 : 520);
        setCursors((current) => ({ ...current, [agent]: { ...current[agent], clicks: current[agent].clicks + 1 } }));
        await pace(word ? 40 : 140);
        if (signal.aborted) return;
        apply(step);
        setDoneCount((current) => ({ ...current, [agent]: current[agent] + 1 }));
        markDone(step.id);
        await pace(word ? 60 : step.action.kind === "cut" ? 420 : 260);
      }
      setWorking((current) => ({ ...current, [agent]: "" }));
      setCursors((current) => ({ ...current, [agent]: { ...current[agent], visible: false } }));
    };
    Promise.all(AGENT_ORDER.map(runLane)).then(() => {
      if (!signal.aborted) { setPhase("listo"); setStatus("Edición planificada: revisa el resultado en el visor y exporta"); }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [apply, phase, prepared, targetFor]);

  const skipToEnd = () => {
    if (!prepared) return;
    setSpeed(1);
    setPhase("listo");
    setStatus("Edición planificada: revisa el resultado en el visor y exporta");
    setStyleApplied(true);
    setAnalyzed(new Set(clips.map((_, index) => index)));
    const allSteps = AGENT_ORDER.flatMap((agent) => prepared.script.lanes[agent]);
    setCuts(allSteps.flatMap((step) => step.action.kind === "cut" ? [{ clipIndex: step.clipIndex, range: step.action.range, reason: step.action.reason }] : []));
    setPlaced(allSteps.flatMap((step) => step.action.kind === "word" ? [{ clipIndex: step.clipIndex, word: step.action.word }] : []));
    setSounds(allSteps.flatMap((step) => step.action.kind === "sound" ? [{ clipIndex: step.clipIndex, at: step.action.at, effect: step.action.effect }] : []));
    setChecks(allSteps.flatMap((step) => step.action.kind === "check" && step.agent === "qa" ? [{ clipIndex: step.clipIndex, ok: step.action.ok, label: step.label }] : []));
    setLog(allSteps.filter((step) => step.action.kind !== "word").map((step) => ({ id: step.id, agent: step.agent, label: step.label, ok: step.action.kind === "check" ? step.action.ok : undefined, at: Date.now() })).reverse());
    setDoneCount(Object.fromEntries(AGENT_ORDER.map((agent) => [agent, prepared.script.lanes[agent].length])) as Record<AgentId, number>);
    setWorking(Object.fromEntries(AGENT_ORDER.map((agent) => [agent, ""])) as Record<AgentId, string>);
    setCursors((current) => Object.fromEntries(AGENT_ORDER.map((agent) => [agent, { ...current[agent], visible: false }])) as Record<AgentId, CursorState>);
    setExportReady(true);
  };

  // 3) Visor: reproduce la toma seleccionada saltando los cortes ya aplicados; la palabra activa encima.
  const clip = clips[selected];
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    let frame = 0;
    const tick = () => {
      let current = video.currentTime;
      const jump = cutsRef.current.find((cut) => cut.clipIndex === selected && current >= cut.range.start && current < cut.range.end - .02);
      if (jump) { video.currentTime = jump.range.end; current = jump.range.end; }
      if (current >= clip.window.end - .03 || current < clip.window.start - .25) { video.currentTime = clip.window.start; current = clip.window.start; }
      setTime(current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clip, selected]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    const start = () => { video.currentTime = clip.window.start; void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); };
    if (video.readyState >= 1) start(); else video.addEventListener("loadedmetadata", start, { once: true });
  }, [clip]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().then(() => setPlaying(true)).catch(() => undefined);
    else { video.pause(); setPlaying(false); }
  };

  const activeWord = useMemo(() => placed.find((item) => item.clipIndex === selected && time >= item.word.startSeconds && time < item.word.endSeconds)?.word, [placed, selected, time]);

  // Monitores: forma de onda con cortes y cabezal, vectorscopio y niveles.
  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas || !prepared || !clip) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0a0c12"; context.fillRect(0, 0, width, height);
    const peaks = prepared.peaks[selected];
    const span = clip.window.end - clip.window.start;
    for (let x = 0; x < width; x += 1) {
      const peak = analyzed.has(selected) ? peaks[Math.min(peaks.length - 1, Math.floor(x / width * peaks.length))] : .04;
      const seconds = clip.window.start + x / width * span;
      const cut = cuts.some((item) => item.clipIndex === selected && seconds >= item.range.start && seconds < item.range.end);
      context.fillStyle = cut ? "rgba(244,114,182,.35)" : "#4f8cff";
      context.fillRect(x, height / 2 - peak * height * .45, 1, Math.max(1, peak * height * .9));
    }
    const x = (time - clip.window.start) / span * width;
    context.fillStyle = "#FF7A00"; context.fillRect(x, 0, 2, height);
  }, [analyzed, clip, cuts, prepared, selected, time]);

  useEffect(() => {
    const scope = scopeRef.current;
    const sample = sampleRef.current;
    const video = videoRef.current;
    if (!scope || !sample || !video) return;
    const timer = setInterval(() => {
      const sampleContext = sample.getContext("2d", { willReadFrequently: true });
      const context = scope.getContext("2d");
      if (!sampleContext || !context || video.readyState < 2) return;
      try {
        sampleContext.drawImage(video, 0, 0, sample.width, sample.height);
        const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
        const size = scope.width;
        context.fillStyle = "rgba(10,12,18,.55)"; context.fillRect(0, 0, size, size);
        context.strokeStyle = "rgba(255,255,255,.12)"; context.beginPath(); context.arc(size / 2, size / 2, size * .46, 0, Math.PI * 2); context.stroke();
        context.beginPath(); context.moveTo(size / 2, 4); context.lineTo(size / 2, size - 4); context.moveTo(4, size / 2); context.lineTo(size - 4, size / 2); context.stroke();
        context.fillStyle = "rgba(120,220,255,.55)";
        for (let index = 0; index < pixels.length; index += 4) {
          const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
          const cb = -.1687 * r - .3313 * g + .5 * b;
          const cr = .5 * r - .4187 * g - .0813 * b;
          context.fillRect(size / 2 + cb / 128 * size * .46, size / 2 - cr / 128 * size * .46, 1.4, 1.4);
        }
      } catch { /* cross-origin frames cannot be read: the scope stays empty */ }
    }, 160);
    return () => clearInterval(timer);
  }, []);

  const level = useMemo(() => {
    const audio = prepared?.audio[selected];
    if (!audio || !clip) return 0;
    const index = Math.floor((time - clip.window.start) * audio.sampleRate);
    let power = 0;
    const size = Math.floor(audio.sampleRate * .05);
    for (let offset = 0; offset < size; offset += 1) power += (audio.samples[index + offset] ?? 0) ** 2;
    const db = 10 * Math.log10(power / size + 1e-12);
    return Math.max(0, Math.min(1, (db + 60) / 60));
  }, [clip, prepared, selected, time]);

  const activeAgents = AGENT_ORDER.filter((agent) => working[agent]);
  const total = prepared?.total ?? 1;
  const pct = (clipIndex: number, seconds: number) => prepared ? (prepared.offsets[clipIndex] + seconds - clips[clipIndex].window.start) / total * 100 : 0;
  const ticks = Array.from({ length: Math.min(60, Math.ceil(total) + 1) }, (_, index) => index * Math.max(1, Math.ceil(total / 24)));
  const kept = prepared ? prepared.script.plans.reduce((sum, plan) => sum + plan.keptSeconds, 0) : 0;

  return <div ref={rootRef} className="fixed inset-0 z-[80] flex min-w-[1100px] flex-col overflow-hidden bg-[#06070b] text-zinc-200" role="dialog" aria-label="Sala de edición en vivo">
    <style>{`
      @font-face { font-family: SegmentaMontserrat; src: url(/fonts/Montserrat-ExtraBoldItalic.ttf) format("truetype"); font-weight: 800; font-style: italic; font-display: swap; }
      @font-face { font-family: SegmentaMontserrat; src: url(/fonts/Montserrat-BlackItalic.ttf) format("truetype"); font-weight: 900; font-style: italic; font-display: swap; }
      @font-face { font-family: SegmentaMontserrat; src: url(/fonts/Montserrat-LightItalic.ttf) format("truetype"); font-weight: 300; font-style: italic; font-display: swap; }
      @keyframes sala-ripple { from { transform: translate(-50%,-50%) scale(.3); opacity: .9 } to { transform: translate(-50%,-50%) scale(2.4); opacity: 0 } }
      @keyframes sala-pop { from { transform: scale(.72) translateY(12%); opacity: 0 } 60% { transform: scale(1.04); opacity: 1 } to { transform: scale(1) } }
      @keyframes sala-pop-big { from { transform: scale(1.35); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @keyframes sala-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
    `}</style>

    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-white/8 bg-[#0b0d13] px-4">
      <div className="flex items-center gap-2"><span className="h-6 w-6 rounded-md bg-gradient-to-br from-[#FF7A00] to-violet-500" /><strong className="text-sm text-white">Segmenta Studio</strong><span className="text-xs text-zinc-500">Sala de edición</span></div>
      <div className="mx-auto text-center"><p className="text-xs font-semibold text-white">{props.projectName}</p><p className="text-[10px] text-zinc-500">{status}</p></div>
      <div className="flex items-center gap-1.5">{AGENT_ORDER.map((agent) => <span key={agent} title={`${SALA_AGENTS[agent].name}: ${working[agent] || (doneCount[agent] ? `${doneCount[agent]} acciones` : "en espera")}`}
        className="grid h-7 w-7 place-items-center rounded-full border-2 text-[9px] font-bold text-black transition-transform" style={{ background: SALA_AGENTS[agent].color, borderColor: working[agent] ? "#fff" : "transparent", transform: working[agent] ? "scale(1.08)" : "none", opacity: working[agent] || doneCount[agent] ? 1 : .45 }}>{SALA_AGENTS[agent].initials}</span>)}</div>
      <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-400" style={{ animation: activeAgents.length ? "sala-pulse 1.2s infinite" : undefined }} />{activeAgents.length ? `${activeAgents.length} agentes trabajando` : phase === "listo" ? "Agentes en pausa" : "Preparando agentes"}</span>
      <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5 text-[11px]">{[1, 2, 4].map((value) => <button key={value} type="button" onClick={() => setSpeed(value)} className={`rounded-md px-2 py-1 ${speed === value ? "bg-white text-black" : "text-zinc-400"}`}>{value}×</button>)}
        <button type="button" onClick={skipToEnd} disabled={phase !== "trabajando"} title="Mostrar el resultado sin esperar" className="flex items-center gap-1 rounded-md px-2 py-1 text-zinc-300 disabled:opacity-30"><FastForward size={12} />Final</button></div>
      <button type="button" data-target="export" onClick={props.onExport} disabled={!props.onExport || !exportReady} className="flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40" style={{ boxShadow: exportReady ? "0 0 0 3px rgba(52,211,153,.25)" : undefined }}><Download size={13} />{props.exportLabel ?? "Exportar"}</button>
      {props.onClose && <button type="button" onClick={props.onClose} aria-label="Cerrar la sala" className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10"><X size={16} /></button>}
    </header>

    <div className="grid min-h-0 flex-1 grid-cols-[210px_250px_minmax(280px,1fr)_250px_280px]">
      <section className="min-h-0 overflow-auto border-r border-white/8 bg-[#0a0c11] p-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tomas · {clips.length}</h3>
        <div className="space-y-2">{clips.map((item, index) => <button key={item.id} type="button" data-target={`clip-${index}`} onClick={() => setSelected(index)}
          className={`flex w-full gap-2 rounded-lg border p-1.5 text-left ${selected === index ? "border-[#FF7A00]/60 bg-[#FF7A00]/10" : "border-white/8 bg-white/[.02]"}`}>
          <video src={`${item.videoUrl}#t=${item.window.start + .4}`} muted preload="metadata" className="h-14 w-8 shrink-0 rounded bg-black object-cover" />
          <span className="min-w-0"><strong className="block truncate text-[11px] text-white">{item.title}</strong><small className="text-[10px] text-zinc-500">{formatTime(item.window.end - item.window.start)}</small>
            {prepared && <small className="block text-[10px] text-cyan-300">{formatTime(prepared.script.plans[index].keptSeconds)} tras cortes</small>}</span>
        </button>)}</div>
      </section>

      <section className="flex min-h-0 flex-col border-r border-white/8 bg-[#0a0c11]">
        <h3 className="border-b border-white/8 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Lo que hacen los agentes</h3>
        <ol className="min-h-0 flex-1 space-y-1 overflow-auto p-2 text-[11px] leading-4" aria-live="polite">{log.map((entry) => <li key={`${entry.id}-${entry.at}`} className="flex gap-2 rounded-md bg-white/[.03] px-2 py-1.5">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SALA_AGENTS[entry.agent].color }} />
          <span className="min-w-0"><strong className="text-[10px]" style={{ color: SALA_AGENTS[entry.agent].color }}>{SALA_AGENTS[entry.agent].name}</strong>
            <span className="block text-zinc-300">{entry.ok === false ? <TriangleAlert size={11} className="mr-1 inline text-amber-300" /> : entry.ok ? <Check size={11} className="mr-1 inline text-emerald-300" /> : null}{entry.label}</span></span>
        </li>)}{!log.length && <li className="px-2 py-3 text-zinc-500">{phase === "escuchando" ? "Escuchando las tomas…" : "Esperando la primera acción…"}</li>}</ol>
      </section>

      <section className="flex min-h-0 flex-col items-center justify-center gap-2 bg-[#050608] p-3">
        <div ref={viewerRef} className="relative aspect-[9/16] h-full max-h-full overflow-hidden rounded-lg bg-black shadow-2xl ring-1 ring-white/10" style={{ ["--viewer-width" as string]: "300px" }}>
          {clip && <video ref={videoRef} src={clip.videoUrl} muted={muted} playsInline className="h-full w-full object-cover" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />}
          {activeWord && <div key={`${activeWord.startSeconds}-${activeWord.text}`} className="pointer-events-none absolute left-0 right-0 flex justify-center" style={{ top: "64%", transform: "translateY(-50%)" }}>
            <span style={{ ...wordStyle(activeWord), display: "inline-block", animation: activeWord.style === "enfasis" ? "sala-pop-big .16s ease-out" : "sala-pop .15s ease-out", marginLeft: "-6%" }}>{activeWord.text}</span></div>}
          <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{formatTime(time - (clip?.window.start ?? 0))}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={togglePlay} className="grid h-8 w-8 place-items-center rounded-full bg-white text-black">{playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button>
          <button type="button" onClick={() => setMuted((value) => !value)} className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1.5 text-[11px]">{muted ? <VolumeX size={13} /> : <Volume2 size={13} />}{muted ? "Activar sonido" : "Sonido"}</button>
          <span className="text-[10px] text-zinc-500">El visor ya salta los cortes aplicados</span>
        </div>
      </section>

      <section className="min-h-0 space-y-3 overflow-auto border-l border-white/8 bg-[#0a0c11] p-3">
        <div><h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Forma de onda · voz</h3><canvas ref={waveRef} width={440} height={110} className="h-[110px] w-full rounded-md ring-1 ring-white/8" /></div>
        <div className="flex gap-3">
          <div><h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Vectorscopio</h3><canvas ref={scopeRef} width={150} height={150} className="h-[150px] w-[150px] rounded-md bg-[#0a0c12] ring-1 ring-white/8" /><canvas ref={sampleRef} width={36} height={64} className="hidden" /></div>
          <div className="flex-1"><h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Nivel</h3>
            <div className="flex h-[150px] items-end gap-1.5 rounded-md bg-[#0a0c12] p-2 ring-1 ring-white/8">{[0, 1].map((channel) => <div key={channel} className="relative h-full w-3 overflow-hidden rounded-sm bg-white/5"><div className="absolute bottom-0 w-full rounded-sm" style={{ height: `${level * 100}%`, background: "linear-gradient(to top,#34d399 0%,#34d399 70%,#facc15 85%,#ef4444 100%)" }} /></div>)}<span className="ml-1 self-start text-[9px] text-zinc-500">−14 LUFS<br />objetivo</span></div></div>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/[.02] p-2.5 text-[11px]"><h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Resultado del plan</h3>
          <p>{prepared ? <>Duración final: <strong className="text-white">{formatTime(kept)}</strong> de {formatTime(total)}</> : "Calculando…"}</p>
          <p>Cortes aplicados: <strong className="text-white">{cuts.length}</strong> · Palabras: <strong className="text-white">{placed.length}</strong></p>
          <p>Revisiones: <strong className="text-emerald-300">{checks.filter((item) => item.ok).length} bien</strong>{checks.some((item) => !item.ok) && <> · <strong className="text-amber-300">{checks.filter((item) => !item.ok).length} por revisar</strong></>}</p></div>
      </section>

      <section className="min-h-0 space-y-3 overflow-auto border-l border-white/8 bg-[#0b0d13] p-3">
        <div><h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Agentes</h3>
          <ul className="space-y-1.5">{AGENT_ORDER.map((agent) => <li key={agent} className="rounded-lg border border-white/8 bg-white/[.02] p-2">
            <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full text-[8px] font-bold text-black" style={{ background: SALA_AGENTS[agent].color }}>{SALA_AGENTS[agent].initials}</span>
              <strong className="text-[11px] text-white">{SALA_AGENTS[agent].name}</strong><span className="ml-auto text-[10px] text-zinc-500">{prepared ? `${doneCount[agent]}/${prepared.script.lanes[agent].length}` : ""}</span></div>
            <p className="mt-1 truncate text-[10px]" style={{ color: working[agent] ? SALA_AGENTS[agent].color : "#71717a" }}>{working[agent] || (prepared && doneCount[agent] === prepared.script.lanes[agent].length && doneCount[agent] > 0 ? "Terminó" : SALA_AGENTS[agent].role)}</p>
          </li>)}</ul></div>
        <div data-target="style" className={`rounded-lg border p-2.5 transition-colors ${styleApplied ? "border-[#FF7A00]/50 bg-[#FF7A00]/10" : "border-white/8 bg-white/[.02]"}`}>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Estilo</h3><p className="mt-1 text-xs font-semibold text-white">{props.styleName}</p>
          <div className="mt-1.5 flex flex-wrap gap-1 text-[9px]">{["Una palabra", "Blanco y naranja", "Pausas naturales", "Voz 1,0×", "Sin filtros"].map((chip) => <span key={chip} className="rounded-full bg-white/8 px-1.5 py-0.5 text-zinc-300">{chip}</span>)}</div></div>
        <div><h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Color</h3>
          <div className="flex justify-between">{["Sombras", "Medios", "Luces"].map((name) => <div key={name} className="text-center"><div className="relative h-[66px] w-[66px] rounded-full" style={{ background: "conic-gradient(from 90deg, #ff4d4d, #ffd84d, #4dff88, #4dd8ff, #6b4dff, #ff4dd8, #ff4d4d)" }}>
            <div className="absolute inset-[3px] rounded-full" style={{ background: "radial-gradient(circle, rgba(18,20,28,.92) 0%, rgba(18,20,28,.55) 70%, rgba(18,20,28,.1) 100%)" }} /><span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" /></div><small className="text-[9px] text-zinc-500">{name}</small></div>)}</div>
          <p className="mt-1.5 text-[10px] text-zinc-500">Neutro: la imagen va tal como se grabó (regla de Segmenta).</p>
          {[["Contraste", "1,00"], ["Saturación", "1,00"], ["Velocidad de voz", "1,0×"]].map(([name, value]) => <div key={name} className="mt-1.5 flex items-center gap-2 text-[10px]"><span className="w-24 text-zinc-400">{name}</span><span className="relative h-1 flex-1 rounded bg-white/10"><span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-300" /></span><span className="w-8 text-right text-zinc-300">{value}</span></div>)}
        </div>
        {props.exportStatus && <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-2 text-[11px] text-emerald-200">{props.exportStatus}</p>}
      </section>
    </div>

    <section ref={timelineRef} className="relative h-[230px] shrink-0 border-t border-white/10 bg-[#0b0d13] px-3 pb-2 pt-1">
      <div className="ml-[92px] flex h-5 items-end text-[9px] text-zinc-500">{ticks.filter((tick) => tick <= total).map((tick) => <span key={tick} className="absolute" style={{ left: `calc(92px + 12px + (100% - 92px - 24px) * ${tick / total})` }}>{formatTime(tick).slice(1, 5)}</span>)}</div>
      {([["video", "V1  Video"], ["subtitulos", "T1  Subtítulos"], ["voz", "A1  Voz"], ["sonido", "A2  Sonido"], ["calidad", "QA  Revisión"]] as const).map(([track, name]) => <div key={track} className="flex h-[38px] items-center border-b border-white/5">
        <span className="w-[92px] shrink-0 text-[10px] font-semibold text-zinc-500">{name}</span>
        <div data-track={track} className="relative h-[30px] flex-1 overflow-hidden rounded bg-white/[.025]">
          {track === "video" && clips.map((item, index) => prepared && <div key={item.id} className={`absolute inset-y-0.5 flex items-center overflow-hidden rounded border px-1.5 text-[10px] ${selected === index ? "border-[#FF7A00]/70" : "border-violet-300/30"}`}
            style={{ left: `${pct(index, item.window.start)}%`, width: `${(item.window.end - item.window.start) / total * 100}%`, background: "linear-gradient(90deg, rgba(139,92,246,.35), rgba(139,92,246,.18))" }}><span className="truncate text-violet-100">{item.title}</span></div>)}
          {track === "subtitulos" && placed.map(({ clipIndex, word }) => <span key={`${clipIndex}-${word.startSeconds}-${word.text}`} className="absolute inset-y-1 overflow-hidden rounded-sm px-0.5 text-[8px] leading-[22px]"
            style={{ left: `${pct(clipIndex, word.startSeconds)}%`, width: `${Math.max(.2, (word.endSeconds - word.startSeconds) / total * 100)}%`, background: word.style === "enfasis" ? "#FF7A00" : word.style === "ligera" ? "rgba(255,255,255,.25)" : "rgba(255,255,255,.65)", color: word.style === "enfasis" ? "#000" : "#111" }}>{word.text}</span>)}
          {track === "voz" && prepared && clips.map((item, index) => <div key={item.id} className="absolute inset-y-0" style={{ left: `${pct(index, item.window.start)}%`, width: `${(item.window.end - item.window.start) / total * 100}%` }}>
            <svg viewBox={`0 0 ${PEAK_BINS} 100`} preserveAspectRatio="none" className="h-full w-full">{analyzed.has(index) && Array.from(prepared.peaks[index]).map((peak, bin) => bin % 2 === 0 && <rect key={bin} x={bin} y={50 - peak * 46} width={1.4} height={Math.max(1, peak * 92)} fill="#4f8cff" />)}</svg></div>)}
          {track === "voz" && cuts.map(({ clipIndex, range, reason }) => <div key={`${clipIndex}-${range.start}`} title={reason} className="absolute inset-y-0 border-x border-pink-300/60"
            style={{ left: `${pct(clipIndex, range.start)}%`, width: `${(range.end - range.start) / total * 100}%`, background: "repeating-linear-gradient(135deg, rgba(244,114,182,.45) 0 4px, rgba(10,12,18,.6) 4px 9px)" }} />)}
          {track === "sonido" && sounds.map(({ clipIndex, at, effect }) => <span key={`${clipIndex}-${effect}`} className="absolute inset-y-1 rounded-sm px-1 text-[9px] leading-[22px] text-black" style={{ left: `${pct(clipIndex, at)}%`, background: "#34D399" }}>{effect === "voz" ? "Voz 1,0×" : "Acento"}</span>)}
          {track === "calidad" && clips.map((item, index) => { const mine = checks.filter((check) => check.clipIndex === index); return mine.length > 0 && <span key={item.id} className={`absolute inset-y-1 rounded-sm px-1.5 text-[9px] leading-[22px] ${mine.every((check) => check.ok) ? "bg-emerald-400 text-black" : "bg-amber-300 text-black"}`} style={{ left: `${pct(index, item.window.start)}%` }}>{mine.every((check) => check.ok) ? `✓ ${mine.length} revisiones` : `! ${mine.filter((check) => !check.ok).length} por revisar`}</span>; })}
          {track === "video" && prepared && clip && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-[#FF7A00]" style={{ left: `${pct(selected, time)}%` }} />}
        </div>
      </div>)}
    </section>

    <div className="pointer-events-none absolute inset-0">{AGENT_ORDER.map((agent) => { const cursor = cursors[agent]; return <div key={agent} className="absolute left-0 top-0" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, transition: `transform ${Math.round(480 / speed)}ms cubic-bezier(.2,.8,.2,1), opacity .25s`, opacity: cursor.visible ? 1 : 0 }}>
      <span key={cursor.clicks} className="absolute left-0 top-0 h-7 w-7 rounded-full" style={{ border: `2px solid ${SALA_AGENTS[agent].color}`, animation: cursor.clicks ? "sala-ripple .45s ease-out forwards" : undefined }} />
      <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-[0_2px_3px_rgba(0,0,0,.6)]"><path d="M1 1 L1 16 L5.2 12.3 L8.2 19 L11 17.8 L8.1 11.2 L14 11 Z" fill={SALA_AGENTS[agent].color} stroke="#000" strokeWidth="1" /></svg>
      <span className="absolute left-4 top-4 max-w-[230px] rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-black shadow-lg" style={{ background: SALA_AGENTS[agent].color }}>{SALA_AGENTS[agent].name}
        {cursor.label && <span className="block truncate text-[9px] font-normal text-black/75">{cursor.label}</span>}</span>
    </div>; })}</div>
  </div>;
}
