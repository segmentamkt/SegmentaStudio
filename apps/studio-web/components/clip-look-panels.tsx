"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FlipHorizontal2, FlipVertical2, Plus, RotateCcw, RotateCw, Trash2, Type } from "lucide-react";
import {
  COLOR_FILTERS, CSS_COLOR, IDENTITY_TRANSFORM, TEXT_BACKGROUNDS, TEXT_COLORS, TEXT_LIMITS, TRANSFORM_LIMITS, newTextOverlay,
  type ClipRotation, type ClipTransform, type ColorFilterId, type TextBackground, type TextOverlay,
} from "../lib/clip-look";

const field = "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-violet-300 disabled:opacity-50";
const chip = (active: boolean) => `rounded-lg border px-2 py-1.5 text-[10px] ${active ? "border-violet-300 bg-violet-400/20 text-white" : "border-white/10 text-zinc-300 hover:bg-white/5"}`;

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="block text-[10px] text-zinc-400">
      <span className="flex justify-between"><span>{props.label}</span><span className="text-zinc-200">{props.value}{props.suffix}</span></span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(Number(event.target.value))} className="mt-1 w-full accent-violet-400" />
    </label>
  );
}

/** Textos libres de la toma: agregar en el cursor, escribir, tiempos, tamaño, color, fondo y posición. */
export function TextOverlayPanel(props: {
  clipTitle: string; texts: TextOverlay[]; trimStart: number; trimEnd: number; cursor: number; disabled: boolean;
  selectedId: string; onSelect: (id: string) => void; onChange: (texts: TextOverlay[]) => void;
}) {
  const { texts, trimStart, trimEnd, cursor, disabled, selectedId } = props;
  const update = (id: string, patch: Partial<TextOverlay>) => props.onChange(texts.map((item) => item.id === id ? { ...item, ...patch } : item));
  const add = () => {
    const item = newTextOverlay(crypto.randomUUID(), cursor, trimStart, trimEnd);
    props.onChange([...texts, item]);
    props.onSelect(item.id);
  };
  return (
    <div className="rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-100"><Type size={14} />Textos sobre el video</p>
      <p className="mt-1 text-[10px] leading-4 text-zinc-400">En {props.clipTitle}. Arrástralos sobre el video para moverlos.</p>
      <button type="button" onClick={add} disabled={disabled || texts.length >= TEXT_LIMITS.perClip || trimEnd - trimStart < TEXT_LIMITS.minSeconds} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">
        <Plus size={14} />Agregar texto en el cursor
      </button>
      <div className="mt-3 space-y-2">
        {texts.map((item) => {
          const open = item.id === selectedId;
          return (
            <div key={item.id} className={`rounded-xl border p-2 ${open ? "border-amber-300/50 bg-black/20" : "border-white/10"}`}>
              <button type="button" onClick={() => props.onSelect(open ? "" : item.id)} className="flex w-full items-center justify-between gap-2 text-left text-[11px]">
                <span className="min-w-0 truncate font-semibold">{item.text}</span>
                <span className="shrink-0 text-[9px] text-zinc-500">{item.startSeconds.toFixed(1)}–{item.endSeconds.toFixed(1)} s</span>
              </button>
              {open && (
                <fieldset disabled={disabled} className="mt-2 space-y-3">
                  <label className="block text-[10px] text-zinc-400">Texto
                    <textarea value={item.text} maxLength={TEXT_LIMITS.characters} rows={2} onChange={(event) => update(item.id, { text: event.target.value })} className={`${field} resize-y`} />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] text-zinc-400">Aparece (s)<input type="number" step={0.1} min={trimStart} max={item.endSeconds - TEXT_LIMITS.minSeconds} value={item.startSeconds} onChange={(event) => update(item.id, { startSeconds: Math.max(trimStart, Math.min(item.endSeconds - TEXT_LIMITS.minSeconds, Number(event.target.value) || trimStart)) })} className={field} /></label>
                    <label className="text-[10px] text-zinc-400">Desaparece (s)<input type="number" step={0.1} min={item.startSeconds + TEXT_LIMITS.minSeconds} max={trimEnd} value={item.endSeconds} onChange={(event) => update(item.id, { endSeconds: Math.min(trimEnd, Math.max(item.startSeconds + TEXT_LIMITS.minSeconds, Number(event.target.value) || trimEnd)) })} className={field} /></label>
                  </div>
                  <button type="button" onClick={() => { const length = item.endSeconds - item.startSeconds; const start = Math.max(trimStart, Math.min(cursor, trimEnd - TEXT_LIMITS.minSeconds)); update(item.id, { startSeconds: start, endSeconds: Math.min(trimEnd, start + length) }); }} className="w-full rounded-lg border border-white/10 px-2 py-1.5 text-[10px] text-zinc-300">Empezar en el cursor ({cursor.toFixed(1)} s)</button>
                  <Slider label="Tamaño" value={item.size} min={TEXT_LIMITS.minSize} max={TEXT_LIMITS.maxSize} suffix=" px" onChange={(size) => update(item.id, { size })} />
                  <div>
                    <p className="text-[10px] text-zinc-400">Color de letra</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{TEXT_COLORS.map((color) => <button key={color} type="button" aria-label={`Color ${color}`} onClick={() => update(item.id, { color })} className={`size-6 rounded-full border-2 ${item.color === color ? "border-violet-300" : "border-white/20"}`} style={{ backgroundColor: color }} />)}</div>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400">Fondo</p>
                    <div className="mt-1 grid grid-cols-2 gap-1.5">{(Object.keys(TEXT_BACKGROUNDS) as TextBackground[]).map((key) => <button key={key} type="button" onClick={() => update(item.id, { background: key })} className={chip(item.background === key)}>{TEXT_BACKGROUNDS[key].label}</button>)}</div>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400">Posición</p>
                    <div className="mt-1 grid grid-cols-3 gap-1.5">{([["Arriba", .14], ["Centro", .5], ["Abajo", .84]] as const).map(([label, y]) => <button key={label} type="button" onClick={() => update(item.id, { x: .5, y })} className={chip(Math.abs(item.y - y) < .02 && Math.abs(item.x - .5) < .02)}>{label}</button>)}</div>
                  </div>
                  <button type="button" onClick={() => { props.onChange(texts.filter((text) => text.id !== item.id)); props.onSelect(""); }} className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-400/30 px-2 py-1.5 text-[10px] text-red-200"><Trash2 size={12} />Borrar texto</button>
                </fieldset>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[9px] leading-4 text-zinc-500">Hasta {TEXT_LIMITS.perClip} textos por toma. Se dibujan en el MP4 al exportar.</p>
    </div>
  );
}

/** Encuadre de la toma: zoom, posición, giro de 90° y espejo. */
export function FramingPanel(props: { transform: ClipTransform; disabled: boolean; onChange: (transform: ClipTransform) => void }) {
  const t = props.transform;
  const set = (patch: Partial<ClipTransform>) => props.onChange({ ...t, ...patch });
  const turn = (delta: number) => set({ rotate: (((t.rotate + delta) % 360 + 360) % 360) as ClipRotation });
  return (
    <div className="space-y-4 rounded-xl border border-white/10 p-3">
      <p className="text-xs font-semibold">Encuadre de la toma</p>
      <Slider label="Zoom" value={Math.round(t.scale * 100)} min={TRANSFORM_LIMITS.minScale * 100} max={TRANSFORM_LIMITS.maxScale * 100} step={5} suffix=" %" disabled={props.disabled} onChange={(value) => set({ scale: value / 100 })} />
      <Slider label="Mover a los lados" value={Math.round(t.x * 100)} min={-100} max={100} step={5} disabled={props.disabled || t.scale === 1} onChange={(value) => set({ x: value / 100 })} />
      <Slider label="Mover arriba o abajo" value={Math.round(t.y * 100)} min={-100} max={100} step={5} disabled={props.disabled || t.scale === 1} onChange={(value) => set({ y: value / 100 })} />
      {t.scale === 1 && <p className="text-[9px] leading-4 text-zinc-500">Sube o baja el zoom para poder mover el encuadre.</p>}
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" disabled={props.disabled} onClick={() => turn(-90)} aria-label="Girar a la izquierda" className={chip(false)}><RotateCcw size={14} className="mx-auto" /></button>
        <button type="button" disabled={props.disabled} onClick={() => turn(90)} aria-label="Girar a la derecha" className={chip(false)}><RotateCw size={14} className="mx-auto" /></button>
        <button type="button" disabled={props.disabled} onClick={() => set({ flipH: !t.flipH })} aria-label="Espejo horizontal" aria-pressed={t.flipH} className={chip(t.flipH)}><FlipHorizontal2 size={14} className="mx-auto" /></button>
        <button type="button" disabled={props.disabled} onClick={() => set({ flipV: !t.flipV })} aria-label="Espejo vertical" aria-pressed={t.flipV} className={chip(t.flipV)}><FlipVertical2 size={14} className="mx-auto" /></button>
      </div>
      <p className="text-[9px] text-zinc-500">Giro: {t.rotate}°</p>
      <button type="button" disabled={props.disabled} onClick={() => props.onChange({ ...IDENTITY_TRANSFORM })} className="w-full rounded-lg border border-white/10 px-2 py-1.5 text-[10px] text-zinc-300">Restablecer encuadre</button>
    </div>
  );
}

/** Filtros de color por toma, con muestra de cómo se ven. */
export function FilterPanel(props: { value: ColorFilterId; disabled: boolean; onChange: (value: ColorFilterId) => void }) {
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <p className="text-xs font-semibold">Filtro de color</p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {COLOR_FILTERS.map((item) => (
          <button key={item.id} type="button" disabled={props.disabled} onClick={() => props.onChange(item.id)} aria-pressed={props.value === item.id} className={`overflow-hidden rounded-lg border text-[9px] ${props.value === item.id ? "border-violet-300" : "border-white/10"}`}>
            <span data-theme="dark" className="block h-10 bg-[linear-gradient(135deg,#f59e0b,#ec4899_45%,#3b82f6_75%,#10b981)]" style={{ filter: CSS_COLOR[item.id] || undefined }} />
            <span className="block truncate px-1 py-1 text-zinc-200">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Capa de textos sobre la vista previa (dentro del cuadro 9:16). Los tamaños usan unidades del contenedor,
 * así el texto ocupa lo mismo que en el MP4 de 1080 × 1920. Arrastrar mueve el texto; tocarlo lo selecciona.
 */
export function TextOverlayLayer(props: { texts: TextOverlay[]; time: number; selectedId: string; disabled: boolean; onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const start = useRef<{ id: string; px: number; py: number; x: number; y: number } | null>(null);
  const visible = props.texts.filter((item) => props.time >= item.startSeconds && props.time < item.endSeconds || item.id === props.selectedId && props.time >= item.startSeconds - .05 && props.time <= item.endSeconds + .05);

  const down = (event: ReactPointerEvent<HTMLDivElement>, item: TextOverlay) => {
    if (props.disabled) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { id: item.id, px: event.clientX, py: event.clientY, x: item.x, y: item.y };
    setDraft({ id: item.id, x: item.x, y: item.y, moved: false });
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    const frame = frameRef.current?.getBoundingClientRect();
    if (!origin || !frame) return;
    const dx = (event.clientX - origin.px) / frame.width;
    const dy = (event.clientY - origin.py) / frame.height;
    const moved = Math.abs(event.clientX - origin.px) + Math.abs(event.clientY - origin.py) > 4;
    setDraft({ id: origin.id, x: Math.min(1, Math.max(0, origin.x + dx)), y: Math.min(1, Math.max(0, origin.y + dy)), moved });
  };
  const up = () => {
    const current = draft;
    start.current = null;
    setDraft(null);
    if (!current) return;
    if (current.moved) props.onMove(current.id, Number(current.x.toFixed(4)), Number(current.y.toFixed(4)));
    props.onSelect(current.id);
  };

  return (
    <div ref={frameRef} className="pointer-events-none absolute inset-0 z-[5] [container-type:size]">
      {visible.map((item) => {
        const position = draft?.id === item.id ? draft : item;
        const background = TEXT_BACKGROUNDS[item.background];
        return (
          <div key={item.id} role="button" tabIndex={0} aria-label={`Texto: ${item.text}. Arrástralo para moverlo`} onPointerDown={(event) => down(event, item)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDraft(null); }}
            className={`pointer-events-auto absolute max-w-[93cqw] cursor-move touch-none select-none whitespace-pre-wrap text-center leading-[1.2] ${item.id === props.selectedId ? "outline outline-2 outline-offset-2 outline-amber-300" : ""}`}
            style={{
              left: `${position.x * 100}%`, top: `${position.y * 100}%`, transform: "translate(-50%, -50%)",
              fontFamily: "Inter, var(--font-sans), sans-serif", fontSize: `${(item.size * 1.2 / 1920) * 100}cqh`, padding: `${(24 / 1920) * 100}cqh`,
              color: item.color, backgroundColor: background.opacity ? `${background.color}${Math.round(background.opacity * 255).toString(16).padStart(2, "0")}` : "transparent",
            }}>
            {item.text}
          </div>
        );
      })}
    </div>
  );
}
