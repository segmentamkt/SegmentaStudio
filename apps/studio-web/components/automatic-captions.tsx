"use client";

import { Captions, Check, CircleAlert, LoaderCircle, RotateCcw, Square, WandSparkles } from "lucide-react";

export type CaptionTask = {
  takeId: string;
  title: string;
  status: "pending" | "processing" | "done" | "error";
  detail?: string;
  percent?: number;
};

type Props = {
  busy: boolean;
  disabled: boolean;
  missingCount: number;
  completedCount: number;
  totalCount: number;
  selectedTitle?: string;
  selectedHasCaptions: boolean;
  tasks: CaptionTask[];
  stage: string;
  onGenerate: () => void;
  onGenerateSelected: () => void;
  onCancel: () => void;
  onReview: () => void;
};

export function AutomaticCaptions({
  busy, disabled, missingCount, completedCount, totalCount, selectedTitle,
  selectedHasCaptions, tasks, stage, onGenerate, onGenerateSelected, onCancel, onReview,
}: Props) {
  const hasCaptions = completedCount > 0;
  const complete = totalCount > 0 && missingCount === 0;
  const failures = tasks.filter((task) => task.status === "error").length;

  return <section aria-label="Subtítulos automáticos" className="rounded-xl border border-violet-400/25 bg-gradient-to-br from-violet-400/10 to-transparent p-3">
    <div className="flex items-start gap-2">
      <Captions size={18} className="mt-0.5 shrink-0 text-violet-200" aria-hidden="true" />
      <div className="min-w-0">
        <h3 className="text-xs font-semibold text-white">Subtítulos automáticos</h3>
        <p className="mt-1 text-[10px] leading-4 text-zinc-300">Reconoce la voz en español y sincroniza el texto con el audio.</p>
      </div>
    </div>

    <p className="mt-3 text-[10px] leading-4 text-zinc-400">Sin claves API. La primera vez se descarga el modelo de voz; el navegador puede conservarlo para las siguientes tomas.</p>

    {totalCount > 0 && <p className={`mt-3 flex items-center gap-1.5 text-[10px] ${complete ? "text-emerald-200" : "text-violet-200"}`}>
      {complete && <Check size={13} aria-hidden="true" />}
      {completedCount} de {totalCount} segmentos con subtítulos
    </p>}

    {busy ? <button type="button" onClick={onCancel} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-violet-300/30 bg-violet-400/10 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-400/20 focus-visible:outline-2 focus-visible:outline-violet-300">
      <Square size={12} aria-hidden="true" />Cancelar generación
    </button> : <button type="button" onClick={onGenerate} disabled={disabled || missingCount === 0} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold leading-4 text-white hover:bg-violet-400 focus-visible:outline-2 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500">
      {complete ? <Check size={15} className="shrink-0" aria-hidden="true" /> : <WandSparkles size={15} className="shrink-0" aria-hidden="true" />}
      {complete ? "Subtítulos generados" : hasCaptions ? "Generar subtítulos pendientes" : "Generar subtítulos automáticos"}
    </button>}

    {(stage || busy) && <p role="status" aria-live="polite" aria-atomic="true" className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-cyan-200">
      {busy && <LoaderCircle size={13} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />}
      <span>{stage || "Preparando la transcripción…"}</span>
    </p>}

    {tasks.length > 0 && <ol aria-label="Progreso de subtítulos por toma" className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-white/8 bg-black/15 p-2">
      {tasks.map((task) => {
        const processing = busy && task.status === "processing";
        const percentage = typeof task.percent === "number" && Number.isFinite(task.percent) ? Math.max(0, Math.min(100, Math.round(task.percent))) : undefined;
        const label = task.status === "done" ? "Generada" : task.status === "error" ? "No generada" : processing ? "Procesando" : task.status === "processing" ? "Interrumpida" : busy ? "En espera" : "Sin procesar";
        return <li key={task.takeId} className="rounded-md bg-white/[.03] p-2">
          <div className="flex items-start gap-1.5">
            {task.status === "done" ? <Check size={12} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" /> : task.status === "error" ? <CircleAlert size={12} className="mt-0.5 shrink-0 text-amber-200" aria-hidden="true" /> : processing ? <LoaderCircle size={12} className="mt-0.5 shrink-0 animate-spin text-violet-200" aria-hidden="true" /> : <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" aria-hidden="true" />}
            <div className="min-w-0 flex-1"><p className="break-words text-[10px] leading-4 text-zinc-200">{task.title}</p><p className={`text-[9px] ${task.status === "error" ? "text-amber-200" : task.status === "done" ? "text-emerald-300" : "text-zinc-400"}`}>{label}</p></div>
          </div>
          {task.detail && <p className="mt-1 break-words text-[9px] leading-4 text-zinc-400">{task.detail}</p>}
          {processing && <div role="progressbar" aria-label={`Progreso de ${task.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={percentage === undefined ? task.detail || "Procesando audio" : `${percentage}%`} className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400 ${percentage === undefined ? "w-1/3 animate-pulse" : "transition-[width]"}`} style={percentage === undefined ? undefined : { width: `${percentage}%` }} />
          </div>}
        </li>;
      })}
    </ol>}

    {!busy && failures > 0 && <p className="mt-2 text-[10px] leading-4 text-amber-200">No se completó la generación de {failures === 1 ? "una toma" : `${failures} tomas`}. Puedes reintentar; lo ya generado se conserva.</p>}
    {hasCaptions && <button type="button" onClick={onReview} disabled={disabled || busy} className="mt-3 min-h-10 w-full rounded-lg border border-emerald-300/25 px-3 py-2 text-[11px] font-medium text-emerald-200 hover:bg-emerald-300/10 focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:opacity-40">Revisar y corregir texto</button>}

    {selectedTitle && <div className="mt-3 border-t border-white/10 pt-3">
      <p className="break-words text-[10px] leading-4 text-zinc-400"><span className="text-zinc-200">Selección: </span>{selectedTitle}</p>
      <button type="button" onClick={onGenerateSelected} disabled={disabled || busy} className="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-2 text-[10px] font-medium text-zinc-200 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-violet-300 disabled:opacity-40">
        <RotateCcw size={12} className="shrink-0" aria-hidden="true" />{selectedHasCaptions ? "Regenerar selección" : "Generar solo la selección"}
      </button>
      {selectedHasCaptions && <p className="mt-1 text-[9px] leading-4 text-zinc-500">Regenerar reemplaza el texto de este segmento, incluidas tus correcciones.</p>}
    </div>}

    <p className="mt-3 text-[9px] leading-4 text-zinc-500">Revisa nombres y palabras antes de exportar. Puedes corregir el texto sin perder sus tiempos.</p>
  </section>;
}
