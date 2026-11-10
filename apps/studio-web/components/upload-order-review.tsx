"use client";

/**
 * «Así quedará tu video»: antes de subir varios videos se muestra el orden propuesto
 * (fecha de grabación, número del nombre u orden de selección) con el motivo de cada
 * posición. Se puede arrastrar o usar las flechas; nada se sube hasta confirmar.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarClock, Hash, ListOrdered, TriangleAlert, UploadCloud, X } from "lucide-react";
import type { UploadOrderPlan } from "../lib/upload-order";

type Props = {
  files: File[];
  plan: UploadOrderPlan;
  /** Destino de cada posición (p. ej. la escena del libreto que ocupará); por defecto «Toma N». */
  targets?: string[];
  scriptNote?: boolean;
  onCancel: () => void;
  onConfirm: (ordered: File[]) => void;
};

export function UploadOrderReview({ files, plan, targets, scriptNote, onCancel, onConfirm }: Props) {
  const [order, setOrder] = useState(plan.order);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);
  useEffect(() => { confirmRef.current?.focus(); }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onCancel]);
  const notes = useMemo(() => new Map(plan.notes.map((note) => [note.index, note])), [plan.notes]);
  const changed = order.some((index, position) => index !== plan.order[position]);
  const uncertain = order.filter((index) => notes.get(index)?.uncertain).length;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    setAnnouncement(`${files[item].name} pasa al lugar ${to + 1} de ${order.length}.`);
  };
  const drop = (event: DragEvent<HTMLElement>, position: number) => {
    event.preventDefault();
    if (dragging !== null) move(dragging, dragging < position ? position - 1 : position);
    setDragging(null); setDropAt(null);
  };
  const Icon = plan.strategy === "fecha" ? CalendarClock : plan.strategy === "nombre" ? Hash : ListOrdered;

  return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="upload-order-title">
    <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-y-auto overflow-x-hidden rounded-3xl border border-white/10 bg-[#0b0d13] shadow-2xl">
      <header className="flex items-start gap-3 border-b border-white/8 px-5 py-4">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200"><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="upload-order-title" className="text-base font-semibold text-white">Así quedará tu video</h2>
          <p className="mt-0.5 text-xs text-zinc-400">{changed ? "Orden ajustado a mano." : plan.summary} Arrastra o usa las flechas para cambiarlo; nada se sube hasta que confirmes.</p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Cancelar la subida" className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10"><X size={18} /></button>
      </header>

      <ol className="flex shrink-0 gap-3 overflow-x-auto px-5 py-4" aria-label="Orden de los videos">
        {order.map((fileIndex, position) => {
          const note = notes.get(fileIndex);
          const file = files[fileIndex];
          return <li key={fileIndex} draggable onDragStart={(event) => { setDragging(position); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(position)); }}
            onDragEnd={() => { setDragging(null); setDropAt(null); }}
            onDragOver={(event) => { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setDropAt(event.clientX < box.left + box.width / 2 ? position : position + 1); }}
            onDrop={(event) => drop(event, dropAt ?? position)}
            className={`relative flex w-[148px] shrink-0 cursor-grab flex-col rounded-2xl border bg-white/[.03] p-2 transition ${dragging === position ? "opacity-40" : ""} ${note?.uncertain ? "border-amber-300/40" : "border-white/10"}`}>
            {dropAt === position && dragging !== null && <span className="absolute -left-2 top-2 bottom-2 w-1 rounded-full bg-violet-400" />}
            {dropAt === position + 1 && dragging !== null && position === order.length - 1 && <span className="absolute -right-2 top-2 bottom-2 w-1 rounded-full bg-violet-400" />}
            <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-black">
              <video src={`${urls[fileIndex]}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              <span className="absolute left-1.5 top-1.5 grid h-7 min-w-7 place-items-center rounded-full bg-violet-500 px-1.5 text-sm font-bold text-white shadow">{position + 1}</span>
            </div>
            <strong className="mt-2 truncate text-[11px] text-white" title={file.name}>{file.name}</strong>
            <span className={`mt-0.5 flex items-start gap-1 text-[10px] leading-4 ${note?.uncertain ? "text-amber-200" : "text-zinc-400"}`}>{note?.uncertain && <TriangleAlert size={11} className="mt-0.5 shrink-0" />}{note?.reason}</span>
            <span className="mt-1 truncate text-[10px] text-violet-200" title={targets?.[position]}>→ {targets?.[position] ?? `Toma ${position + 1}`}</span>
            <span className="mt-2 flex justify-between">
              <button type="button" onClick={() => move(position, position - 1)} disabled={position === 0} aria-label={`Mover ${file.name} antes`} className="rounded-lg border border-white/10 p-1.5 text-zinc-300 disabled:opacity-25"><ArrowLeft size={13} /></button>
              <button type="button" onClick={() => move(position, position + 1)} disabled={position === order.length - 1} aria-label={`Mover ${file.name} después`} className="rounded-lg border border-white/10 p-1.5 text-zinc-300 disabled:opacity-25"><ArrowRight size={13} /></button>
            </span>
          </li>;
        })}
      </ol>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <footer className="flex flex-wrap items-center gap-3 border-t border-white/8 px-5 py-4">
        <p className="w-full text-[11px] leading-4 text-zinc-500 sm:w-auto sm:min-w-0 sm:flex-1">
          {uncertain > 0 && <span className="mb-1 block text-amber-200">{uncertain === 1 ? "1 video no tiene fecha ni número: revisa su lugar." : `${uncertain} videos no tienen fecha ni número: revisa su lugar.`}</span>}
          {scriptNote ? "Este proyecto tiene libreto: al generar los subtítulos, Studio comparará lo que se dice en cada toma y la llevará a su lugar si no coincide." : "Si luego añades un libreto, Studio podrá ordenar las tomas por lo que se dice en cada una."}
        </p>
        <span className="flex w-full gap-2 sm:w-auto">
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-xs text-zinc-200 sm:flex-none">Cancelar</button>
          <button ref={confirmRef} type="button" onClick={() => onConfirm(order.map((index) => files[index]))} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold text-white sm:flex-none"><UploadCloud size={15} />Subir en este orden</button>
        </span>
      </footer>
    </div>
  </div>;
}
