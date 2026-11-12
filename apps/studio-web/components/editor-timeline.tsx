"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Captions, ChevronLeft, ChevronRight, Copy, EyeOff, Music2, Scissors, Type, Video, ZoomIn, ZoomOut } from "lucide-react";
import { canSplitAt, dropEdgeLeft, layoutTimeline, outputSeconds, playheadX, reorderTarget, sourceSecondAt, timelineWidth, trimmedRange, type TimelineSpan } from "../lib/timeline-edit";

/** Un subtítulo de la toma, en segundos de origen. */
export type TimelineCue = { start: number; end: number; text: string };

/** Línea de tiempo de Studio, con carriles como en los editores de video: subtítulos, video, texto y audio. */
/** Un texto libre sobre el video, en segundos de origen de su toma. */
export type TimelineText = { id: string; start: number; end: number; text: string };

export type TimelineItem = TimelineSpan & { title: string; cues?: TimelineCue[]; label?: string; texts?: TimelineText[] };

type Props = {
  items: TimelineItem[];
  selectedId: string;
  /** Segundo de origen donde está el cursor dentro de la toma seleccionada. */
  playhead: number;
  busy: boolean;
  onSeek: (id: string, seconds: number) => void;
  onTrim: (id: string, start: number, end: number) => void;
  /** `toIndex` es la posición de inserción en la lista sin la toma movida. */
  onReorder: (id: string, toIndex: number) => void;
  onSplit: (id: string, seconds: number) => void;
  onDuplicate: (id: string) => void;
  onToggle: (id: string) => void;
  /** Canción que suena bajo la voz en todo el video (null = solo la voz). */
  music?: { name: string; volume: number } | null;
  /** Abre el panel Audio para elegir o ajustar la canción. */
  onOpenMusic?: () => void;
  /** Toca un texto del carril de texto: selecciona su toma y abre el panel Texto. */
  onSelectText?: (itemId: string, textId: string) => void;
};

type Drag =
  | { kind: "trim"; id: string; edge: "start" | "end"; startX: number; origin: TimelineSpan; start: number; end: number }
  | { kind: "block"; id: string; index: number; startX: number; x0: number; touch: boolean; armed: boolean; pointerX: number; target: number }
  | { kind: "scrub" };

const LONG_PRESS_MS = 350;
const ZOOM_MIN = 16;
const ZOOM_MAX = 120;
const RULER_H = 24;
const SUBTITLE_H = 28;
const VIDEO_H = 76;
const TEXT_H = 28;
const AUDIO_H = 28;
const HEADER_W = 52;

export function EditorTimeline({ items, selectedId, playhead, busy, onSeek, onTrim, onReorder, onSplit, onDuplicate, onToggle, music = null, onOpenMusic, onSelectText }: Props) {
  const [pxPerSecond, setPxPerSecond] = useState(44);
  // El arrastre se pinta desde el estado. Los manejadores de eventos leen la referencia, que siempre tiene
  // el valor más reciente aunque React todavía no haya repintado.
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => { dragRef.current = next; setDragState(next); };
  const lastScrub = useRef(-1);
  const pressTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mientras se arrastra un borde, la toma muestra el recorte nuevo para que el bloque y el cursor sigan al dedo.
  const shown: TimelineItem[] = items.map((item) => drag?.kind === "trim" && drag.id === item.id ? { ...item, start: drag.start, end: drag.end } : item);
  const boxes = layoutTimeline(shown, pxPerSecond);
  const total = timelineWidth(boxes);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const cursorX = selectedIndex >= 0 ? playheadX(boxes[selectedIndex], shown[selectedIndex], playhead, pxPerSecond) : null;

  // Mantiene el cursor a la vista mientras el video avanza o al tocar una toma lejana.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || cursorX === null || dragRef.current) return;
    const left = scroller.scrollLeft;
    const right = left + scroller.clientWidth;
    if (cursorX < left + 24 || cursorX > right - 24) scroller.scrollLeft = Math.max(0, cursorX - scroller.clientWidth / 2);
  }, [cursorX]);

  if (items.length === 0) return null;

  const trackX = (clientX: number) => clientX - (trackRef.current?.getBoundingClientRect().left ?? 0);
  const hold = (element: HTMLElement | null, pointerId: number) => {
    try { element?.setPointerCapture(pointerId); } catch { /* el puntero ya se soltó */ }
  };

  const scrubTo = (clientX: number) => {
    const x = trackX(clientX);
    const box = boxes.find((item) => x >= item.left && x < item.left + item.width);
    const span = box ? shown.find((item) => item.id === box.id) : undefined;
    if (!box || !span || !span.included) return;
    const seconds = sourceSecondAt(span, x - box.left, pxPerSecond);
    if (Math.abs(seconds - lastScrub.current) < 0.03) return;
    lastScrub.current = seconds;
    onSeek(span.id, seconds);
  };

  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    hold(rootRef.current, event.pointerId);
    lastScrub.current = -1;
    setDrag({ kind: "scrub" });
    scrubTo(event.clientX);
  };

  const beginTrim = (event: ReactPointerEvent<HTMLDivElement>, item: TimelineItem, edge: "start" | "end") => {
    if (busy) return;
    event.stopPropagation();
    hold(rootRef.current, event.pointerId);
    setDrag({ kind: "trim", id: item.id, edge, startX: event.clientX, origin: item, start: item.start, end: item.end });
  };

  const beginBlock = (event: ReactPointerEvent<HTMLDivElement>, item: TimelineItem, index: number) => {
    if (busy) return;
    hold(rootRef.current, event.pointerId);
    const touch = event.pointerType !== "mouse";
    const x0 = trackX(event.clientX);
    setDrag({ kind: "block", id: item.id, index, startX: event.clientX, x0, touch, armed: false, pointerX: x0, target: index });
    if (touch) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = window.setTimeout(() => {
        const d = dragRef.current;
        if (d?.kind === "block" && d.id === item.id) setDrag({ ...d, armed: true });
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "scrub") { scrubTo(event.clientX); return; }
    if (d.kind === "trim") {
      const next = trimmedRange(d.origin, d.edge, event.clientX - d.startX, pxPerSecond);
      setDrag({ ...d, start: next.start, end: next.end });
      return;
    }
    const dx = Math.abs(event.clientX - d.startX);
    if (!d.armed) {
      if (d.touch) {
        // En celular, mover el dedo antes de la pausa es desplazar la línea de tiempo, no reordenar.
        if (dx > 10) { window.clearTimeout(pressTimer.current); setDrag(null); }
        return;
      }
      if (dx <= 6) return;
    }
    const x = trackX(event.clientX);
    setDrag({ ...d, armed: true, pointerX: x, target: reorderTarget(boxes, d.id, x) });
  };

  const finish = (cancelled: boolean) => {
    const d = dragRef.current;
    window.clearTimeout(pressTimer.current);
    setDrag(null);
    if (!d || cancelled || d.kind === "scrub") return;
    if (d.kind === "trim") {
      if (d.start !== d.origin.start || d.end !== d.origin.end) onTrim(d.id, d.start, d.end);
      return;
    }
    if (d.armed) {
      if (d.target !== d.index) onReorder(d.id, d.target);
      return;
    }
    // Toque sin arrastrar: selecciona la toma y deja el cursor donde se tocó.
    const box = boxes.find((item) => item.id === d.id);
    const span = shown.find((item) => item.id === d.id);
    if (box && span) onSeek(span.id, span.included ? sourceSecondAt(span, d.x0 - box.left, pxPerSecond) : span.start);
  };

  const dragging = drag && drag.kind === "block" && drag.armed ? drag : null;
  const trimmingId = drag && drag.kind === "trim" ? drag.id : "";
  const guideLeft = dragging && dragging.target !== dragging.index ? dropEdgeLeft(boxes, dragging.id, dragging.target) : null;
  const ticks = Array.from({ length: Math.floor(total / pxPerSecond) + 1 }, (_, second) => second);
  const totalH = RULER_H + SUBTITLE_H + VIDEO_H + TEXT_H + AUDIO_H;

  // Subtítulos y rótulos se dibujan en la posición de su toma: el origen del cue se convierte a la pista.
  const cueChips = shown.flatMap((view, index) => {
    const box = boxes[index];
    if (!view.included || !items[index]) return [];
    return (view.cues ?? []).flatMap((cue, cueIndex) => {
      const left = box.left + ((Math.max(view.start, cue.start) - view.start) / Math.max(0.1, view.speed)) * pxPerSecond;
      const right = box.left + ((Math.min(view.end, cue.end) - view.start) / Math.max(0.1, view.speed)) * pxPerSecond;
      if (right - left < 4) return [];
      return [{ key: `${view.id}-${cueIndex}`, id: view.id, seconds: cue.start, left, width: right - left, text: cue.text }];
    });
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] text-zinc-500">
          {selected ? <>Toma {selectedIndex + 1}: <span className="text-zinc-200">{selected.title}</span></> : "Toca una toma para seleccionarla"}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setPxPerSecond((value) => Math.max(ZOOM_MIN, Math.round(value / 1.25)))} disabled={pxPerSecond <= ZOOM_MIN} aria-label="Alejar la línea de tiempo" className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-zinc-300 disabled:opacity-30"><ZoomOut size={14} /></button>
          <button type="button" onClick={() => setPxPerSecond((value) => Math.min(ZOOM_MAX, Math.round(value * 1.25)))} disabled={pxPerSecond >= ZOOM_MAX} aria-label="Acercar la línea de tiempo" className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-zinc-300 disabled:opacity-30"><ZoomIn size={14} /></button>
        </div>
      </div>

      <div className="flex overflow-hidden rounded-xl border border-white/10 bg-black/35">
        {/* Cabecera de carriles: fija, no se desplaza con la pista. */}
        <div className="shrink-0 border-r border-white/10 bg-(--c-0d1018)" style={{ width: HEADER_W }} aria-hidden="true">
          <div style={{ height: RULER_H }} className="border-b border-white/10" />
          <div style={{ height: SUBTITLE_H }} className="grid place-items-center text-orange-300"><Captions size={13} /></div>
          <div style={{ height: VIDEO_H }} className="grid place-items-center border-t border-white/10 text-violet-300"><Video size={14} /></div>
          <div style={{ height: TEXT_H }} className="grid place-items-center border-t border-white/10 text-cyan-300"><Type size={13} /></div>
          <div style={{ height: AUDIO_H }} className="grid place-items-center border-t border-white/10 text-emerald-300"><Music2 size={13} /></div>
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
          <div
            ref={rootRef}
            onPointerMove={onPointerMove}
            onPointerUp={() => finish(false)}
            onPointerCancel={() => finish(true)}
            className={`relative isolate select-none ${busy ? "pointer-events-none opacity-60" : ""}`}
            style={{ width: Math.max(total, 320), height: totalH }}
          >
            <div onPointerDown={beginScrub} aria-label="Regla de tiempo: toca o arrastra para mover el cursor" className="relative cursor-pointer touch-none border-b border-white/10 bg-white/[.03]" style={{ height: RULER_H }}>
              {ticks.map((second) => (
                <span key={second} className="pointer-events-none absolute inset-y-0 border-l border-white/10" style={{ left: second * pxPerSecond }}>
                  {second % 5 === 0 && <span className="pl-1 text-[9px] tabular-nums text-zinc-500">{second} s</span>}
                </span>
              ))}
            </div>

            {/* Carril de subtítulos */}
            <div className="relative" style={{ height: SUBTITLE_H }}>
              {cueChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => onSeek(chip.id, chip.seconds)}
                  disabled={busy}
                  title={chip.text}
                  className="absolute inset-y-0.5 overflow-hidden truncate rounded-md bg-orange-400/85 px-1.5 text-left text-[9px] font-semibold leading-[22px] text-black"
                  style={{ left: chip.left, width: chip.width }}
                >{chip.text}</button>
              ))}
            </div>

            {/* Carril de video: un bloque por toma */}
            <div ref={trackRef} className="relative flex items-stretch border-t border-white/10" style={{ height: VIDEO_H }}>
              {shown.map((view, index) => {
                const box = boxes[index];
                const isSelected = view.id === selectedId;
                const isDragged = dragging?.id === view.id;
                const trimming = trimmingId === view.id;
                const dx = isDragged && dragging ? dragging.pointerX - dragging.x0 : 0;
                return (
                  <div
                    key={view.id}
                    onPointerDown={(event) => beginBlock(event, items[index], index)}
                    data-timeline-take={view.id}
                    aria-label={`${index + 1}. ${view.title}${view.included ? "" : " (excluida)"}`}
                    className={`relative h-full shrink-0 cursor-grab overflow-hidden border-r border-black/70 touch-pan-x ${view.included ? "bg-violet-500/25" : "bg-zinc-700/25"} ${isSelected ? "z-10 ring-2 ring-inset ring-violet-300" : ""} ${isDragged ? "z-20 opacity-80 shadow-2xl" : ""}`}
                    style={{ width: box.width, transform: dx ? `translateX(${dx}px)` : undefined }}
                  >
                    {view.included && (
                      <>
                        <div role="button" aria-label={`Recortar el inicio de ${view.title}`} onPointerDown={(event) => beginTrim(event, items[index], "start")} className="absolute inset-y-0 left-0 z-10 w-4 cursor-ew-resize touch-none bg-white/15 hover:bg-violet-300/60 sm:w-2.5" />
                        <div role="button" aria-label={`Recortar el final de ${view.title}`} onPointerDown={(event) => beginTrim(event, items[index], "end")} className="absolute inset-y-0 right-0 z-10 w-4 cursor-ew-resize touch-none bg-white/15 hover:bg-violet-300/60 sm:w-2.5" />
                      </>
                    )}
                    <div className="flex h-full min-w-0 flex-col justify-between px-3 py-1.5 text-left">
                      {view.included ? (
                        <>
                          <span className="truncate text-[10px] font-semibold text-white">{index + 1} · {view.title}</span>
                          <span className="truncate text-[9px] tabular-nums text-violet-100/80">
                            {trimming ? `${view.start.toFixed(1)}–${view.end.toFixed(1)} s` : `${outputSeconds(view).toFixed(1)} s · ${view.speed}×`}
                          </span>
                        </>
                      ) : <EyeOff size={12} className="m-auto text-zinc-500" />}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Carril de texto: el rótulo de cada toma ocupa su duración */}
            <div className="relative border-t border-white/10" style={{ height: TEXT_H }}>
              {shown.map((view, index) => {
                const box = boxes[index];
                if (!view.included || !view.label || !items[index]) return null;
                return (
                  <span key={`label-${view.id}`} className="pointer-events-none absolute inset-y-0.5 truncate rounded-md bg-cyan-300/80 px-1.5 text-[9px] font-semibold leading-[22px] text-black" style={{ left: box.left + 3, width: Math.max(0, box.width - 6) }}>{view.label}</span>
                );
              })}
              {shown.flatMap((view, index) => {
                const box = boxes[index];
                if (!view.included || !box) return [];
                const speed = Math.max(.5, Math.min(2, view.speed || 1));
                return (view.texts ?? []).flatMap((item) => {
                  const from = Math.max(item.start, view.start);
                  const to = Math.min(item.end, view.end);
                  if (to - from < .05) return [];
                  const left = box.left + (from - view.start) / speed * pxPerSecond;
                  return [<button key={`text-${view.id}-${item.id}`} type="button" disabled={busy || !onSelectText} onClick={() => onSelectText?.(view.id, item.id)} title={item.text}
                    className="absolute inset-y-0.5 z-10 truncate rounded-md border border-black/20 bg-amber-300 px-1.5 text-left text-[9px] font-semibold leading-[20px] text-black disabled:opacity-60"
                    style={{ left, width: Math.max(14, (to - from) / speed * pxPerSecond) }}>T {item.text}</button>];
                });
              })}
            </div>

            {/* Carril de audio: la canción ocupa todo el video; la voz de cada toma va en su bloque */}
            <div className="relative flex items-center border-t border-white/10 px-1 text-[9px] text-zinc-500" style={{ height: AUDIO_H }}>
              {music ? (
                <button type="button" onClick={onOpenMusic} disabled={busy} aria-label={`Música: ${music.name}. Abrir el panel Audio`} className="absolute inset-y-0.5 left-0 flex items-center gap-1 truncate rounded-md bg-emerald-400/80 px-2 text-left text-[9px] font-semibold text-black disabled:opacity-60" style={{ width: Math.max(total, 120) }}>
                  <Music2 size={11} className="shrink-0" /><span className="truncate">{music.name} · {Math.round(music.volume * 100)} %</span>
                </button>
              ) : (
                <button type="button" onClick={onOpenMusic} disabled={busy || !onOpenMusic} className="flex items-center gap-1 rounded-md border border-dashed border-emerald-300/40 px-2 py-1 text-[9px] font-semibold text-emerald-200 disabled:opacity-40">
                  <Music2 size={11} />Agregar música
                </button>
              )}
            </div>

            {guideLeft !== null && <div className="pointer-events-none absolute z-20 w-1 rounded bg-emerald-300" style={{ left: guideLeft, top: RULER_H, bottom: 0 }} />}
            {cursorX !== null && (
              <div className="pointer-events-none absolute z-30 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,.4)]" style={{ left: cursorX, top: 0, bottom: 0 }}>
                <span className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-white" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => selected && onReorder(selected.id, selectedIndex - 1)} disabled={!selected || selectedIndex <= 0 || busy} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-zinc-300 disabled:opacity-30"><ChevronLeft size={13} />Antes</button>
        <button type="button" onClick={() => selected && onReorder(selected.id, selectedIndex + 1)} disabled={!selected || selectedIndex < 0 || selectedIndex >= items.length - 1 || busy} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-zinc-300 disabled:opacity-30">Después<ChevronRight size={13} /></button>
        <button type="button" onClick={() => selected && onSplit(selected.id, playhead)} disabled={!selected || busy || !canSplitAt(items[selectedIndex], playhead)} className="inline-flex items-center gap-1 rounded-lg border border-violet-400/30 px-2.5 py-2 text-[10px] text-violet-200 disabled:opacity-30"><Scissors size={13} />Dividir en el cursor</button>
        <button type="button" onClick={() => selected && onDuplicate(selected.id)} disabled={!selected || busy} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-zinc-300 disabled:opacity-30"><Copy size={13} />Duplicar</button>
        <button type="button" onClick={() => selected && onToggle(selected.id)} disabled={!selected || busy} className="rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-zinc-300 disabled:opacity-30">{selected?.included === false ? "Incluir" : "Excluir"}</button>
      </div>
      <p className="text-[9px] leading-4 text-zinc-500">Arrastra los bordes de una toma para recortarla. Toca la pista o la regla para mover el cursor. Para cambiar el orden, arrastra la toma; en celular, mantenla pulsada un momento antes de moverla.</p>
    </div>
  );
}
