"use client";

import { Check, Film, LoaderCircle, Sparkles } from "lucide-react";
import type { AutomaticEditStage } from "../lib/automatic-edit";
import type { RenderPreview } from "../lib/render-preview";
import type { CaptionTask } from "./automatic-captions";

type Stage = AutomaticEditStage | "idle" | "error" | "cancelled";
const steps: Array<[AutomaticEditStage, string]> = [["captions", "Escuchar y subtitular"], ["plan", "Preparar el montaje"], ["render", "Aplicar la edición"], ["done", "MP4 listo"]];

export function EditingProgress({ stage, running, captionStage, tasks, renderStage, renderProgress, previews, selectedPreviewIndex, onSelectPreview, onStop, onStart, disabled, error }: {
  stage: Stage; running: boolean; captionStage: string; tasks: CaptionTask[];
  renderStage: string; renderProgress: number; previews: RenderPreview[]; selectedPreviewIndex?: number;
  onSelectPreview: (index: number) => void; onStop: () => void; onStart: () => void; disabled: boolean; error: string;
}) {
  const current = steps.findIndex(([key]) => key === stage);
  const completedCaptions = tasks.filter((task) => task.status === "done").length;
  const progress = Math.max(0, Math.min(100, renderProgress));
  return <section id="editor-live-progress" aria-label="Edición automática en vivo" className="scroll-mt-24 border-y border-violet-400/20 bg-gradient-to-r from-violet-500/[.08] to-cyan-400/[.04] px-4 py-4 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Sparkles size={16} className="text-violet-300" />{running ? "Tu video se está editando" : stage === "done" ? "Tu edición está lista" : "Edición automática, a la vista"}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">{stage === "idle" ? "Un clic genera subtítulos, aplica tu estilo y exporta el MP4. El libreto y los ajustes son opcionales." : "Los subtítulos aparecen al reconocer cada toma. Durante el render puedes reproducir muestras reales de las escenas terminadas."}</p>
      </div>
      {running && stage !== "render" && <button type="button" onClick={onStop} className="min-h-10 rounded-lg border border-white/20 px-3 py-2 text-xs text-zinc-200">Detener y conservar avances</button>}
      {!running && stage !== "done" && <button type="button" onClick={onStart} disabled={disabled} className="flex min-h-11 items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Sparkles size={14} />{stage === "error" || stage === "cancelled" ? "Continuar edición" : "Editar automáticamente"}</button>}
    </div>
    {stage !== "idle" && <>
      <ol className="mt-4 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4" aria-label="Etapas automáticas">{steps.map(([key, label], index) => {
        const done = current > index || stage === "done";
        const active = running && key === stage;
        return <li key={key} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${done ? "border-emerald-400/20 bg-emerald-400/[.07] text-emerald-200" : active ? "border-violet-400/40 bg-violet-400/10 text-white" : "border-white/8 text-zinc-500"}`}>{done ? <Check size={14} /> : active ? <LoaderCircle size={14} className="animate-spin" /> : <span className="text-[10px]">{index + 1}</span>}{label}</li>;
      })}</ol>
      <div role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-cyan-200">{stage === "captions" ? captionStage || "Preparando el reconocimiento de voz…" : stage === "plan" ? "Preparando tu estilo con el orden confirmado y los subtítulos reconocidos…" : stage === "render" ? renderStage : stage === "done" ? "MP4 verificado. Ya puedes verlo completo, descargarlo o seguir editando." : stage === "cancelled" ? "Se detuvo la secuencia. Los subtítulos ya generados se conservan." : "La secuencia se detuvo; tus avances se conservan."}</div>
      {stage === "captions" && tasks.length > 0 && <p className="mt-1 text-[10px] text-zinc-400">{completedCaptions} de {tasks.length} tomas subtituladas</p>}
      {stage === "render" && <div className="mt-2"><div className="mb-1 text-right text-[10px] text-zinc-400">{Math.round(progress)}%</div><div role="progressbar" aria-label="Avance real del render" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={renderStage} className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400 transition-[width]" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-[10px] text-zinc-500">Mantén esta pestaña abierta. Las muestras llegan cuando termina cada escena; todavía no son el MP4 completo.</p></div>}
      {stage === "error" && error && <p role="alert" className="mt-2 text-xs text-amber-200">{error}</p>}
    </>}
    {previews.length > 0 && <div className="mt-4"><p className="text-[11px] font-medium text-zinc-300">Escenas ya procesadas · selecciona una para verla en el reproductor</p><div className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Muestras reales del montaje">{previews.map((preview) => <button type="button" key={preview.clipIndex} onClick={() => onSelectPreview(preview.clipIndex)} aria-pressed={selectedPreviewIndex === preview.clipIndex} className={`min-w-[190px] max-w-[240px] shrink-0 rounded-xl border p-3 text-left ${selectedPreviewIndex === preview.clipIndex ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-black/20"}`}><strong className="flex items-center gap-2 text-xs text-white"><Film size={14} className="text-cyan-300" />Escena {preview.clipIndex + 1} de {preview.totalClips}</strong><span className="mt-1 block truncate text-[10px] text-zinc-400">{preview.title}</span><span className="mt-2 block text-[10px] text-emerald-200">{preview.captionCount} subtítulos · {preview.soundEffectCount} sonidos</span><span className="mt-1 block text-[10px] text-zinc-400">{preview.removedSilenceSeconds.toFixed(1)} s de silencio retirado</span></button>)}</div><p className="mt-1 text-[10px] text-zinc-500">Muestras de hasta 3 segundos con la edición aplicada. Los contadores corresponden a la escena completa. Activa el sonido del reproductor para escucharlas.</p></div>}
  </section>;
}
