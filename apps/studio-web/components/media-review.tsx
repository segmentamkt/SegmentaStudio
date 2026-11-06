"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, CheckCircle2, Clapperboard,
  Clock3, Film, GripVertical, ListOrdered, LoaderCircle, Play, RotateCcw, X,
} from "lucide-react";
import type { MediaReviewReceipt } from "../lib/media-review";
import { reorderReviewTakes } from "../lib/review-order";

type ReviewList = "takes" | "montage";
type DraggedTake = { id: string; list: ReviewList; source: string };
type DropPosition = { id: string; list: ReviewList; edge: "before" | "after" };
const REVIEW_DRAG_TYPE = "application/x-segmenta-review-take";

type Decision = "approved" | "rejected" | "blooper";
type ReviewStatus = Decision | "pending";
type Session = { id: string; title?: string; script?: string };
type Scene = { id: string; sessionId?: string; title?: string; script?: string; position?: number; selectedTakeId?: string | null };
type Take = { id: string; sessionId?: string; sceneId: string; status?: string; durationMs?: number; createdAt?: string };

type Props = {
  session: Session;
  scenes: Scene[];
  takes: Take[];
  onConfirmed: (review: MediaReviewReceipt) => Promise<void> | void;
  onBack: () => void;
};

const choices: Array<{ status: Decision; label: string; active: string; Icon: typeof Check }> = [
  { status: "approved", label: "Aprobar", active: "border-emerald-400/50 bg-emerald-400/15 text-emerald-200", Icon: Check },
  { status: "blooper", label: "Blooper", active: "border-amber-300/50 bg-amber-300/15 text-amber-200", Icon: Clapperboard },
  { status: "rejected", label: "Descartar", active: "border-rose-400/40 bg-rose-400/10 text-rose-200", Icon: X },
];

function statusOf(value: string | undefined): ReviewStatus {
  return value === "approved" || value === "rejected" || value === "blooper" ? value : "pending";
}

function timeLabel(milliseconds: number | undefined) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function readableStatus(status: ReviewStatus) {
  return status === "approved" ? "Aprobada" : status === "blooper" ? "Blooper" : status === "rejected" ? "Descartada" : "Por revisar";
}

function dropPositionAt(event: DragEvent<HTMLElement>, list: ReviewList): DropPosition | null {
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-review-take]"));
  const row = rows.find((item) => event.clientY < item.getBoundingClientRect().bottom) || rows.at(-1);
  if (!row) return null;
  const bounds = row.getBoundingClientRect();
  return { id: row.dataset.reviewTake!, list, edge: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" };
}

/** The confirmation is a persisted editorial decision; opening the panel never approves a take. */
export function MediaReviewPanel({ session, scenes, takes, onConfirmed, onBack }: Props) {
  const sessionTakes = useMemo(() => takes.filter((take) => !take.sessionId || take.sessionId === session.id), [takes, session.id]);
  const sessionScenes = useMemo(() => scenes.filter((scene) => !scene.sessionId || scene.sessionId === session.id), [scenes, session.id]);
  const sceneById = useMemo(() => new Map(sessionScenes.map((scene) => [scene.id, scene])), [sessionScenes]);
  const takeById = useMemo(() => new Map(sessionTakes.map((take) => [take.id, take])), [sessionTakes]);
  const defaultOrder = useMemo(() => [...sessionTakes].sort((left, right) => {
    const byScene = Number(sceneById.get(left.sceneId)?.position || 0) - Number(sceneById.get(right.sceneId)?.position || 0);
    return byScene || String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || left.id.localeCompare(right.id);
  }).map((take) => take.id), [sessionTakes, sceneById]);
  const sourceKey = JSON.stringify(sessionTakes.map((take) => [take.id, take.status, take.sceneId, take.durationMs]).sort());
  const orderKey = defaultOrder.join("|");
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [decisions, setDecisions] = useState<Record<string, ReviewStatus>>({});
  const [selectedId, setSelectedId] = useState(defaultOrder[0] || "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedReview, setSavedReview] = useState<MediaReviewReceipt | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const dragRef = useRef<DraggedTake | null>(null);
  const [dragged, setDragged] = useState<DraggedTake | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const [orderAnnouncement, setOrderAnnouncement] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const readReview = async () => {
      setLoading(true); setLoadFailed(false); setError(""); setNotice(""); setSavedReview(null);
      dragRef.current = null; setDragged(null); setDropPosition(null);
      setDecisions(Object.fromEntries(sessionTakes.map((take) => [take.id, statusOf(take.status)])));
      setOrder(defaultOrder);
      setSelectedId(defaultOrder[0] || "");
      try {
        const response = await fetch(`/api/media-review?sessionId=${encodeURIComponent(session.id)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { review?: MediaReviewReceipt | null; valid?: boolean; error?: string };
        if (!response.ok) throw new Error(data.error || "No pudimos cargar la revisión de este proyecto.");
        if (!active) return;
        const known = new Set(defaultOrder);
        const savedOrder = data.review?.takeOrder || data.review?.orderedTakeIds;
        const recordedOrder = Array.isArray(savedOrder) ? [...new Set(savedOrder)].filter((id) => known.has(id)) : [];
        if (recordedOrder.length) setOrder([...recordedOrder, ...defaultOrder.filter((id) => !recordedOrder.includes(id))]);
        setNotice(data.valid ? data.review?.orderedTakeIds.length === 0 ? "Clasificación guardada. Ninguna toma entrará al montaje hasta que apruebes al menos una." : "Este orden ya estaba confirmado. Puedes revisarlo y guardar una nueva selección." : data.review ? "El material cambió desde la última revisión. Revisa las tomas nuevas y vuelve a confirmar." : "Reproduce las tomas, decide cuáles sirven y confirma el orden del montaje.");
      } catch (reason) {
        if (!active || controller.signal.aborted) return;
        setLoadFailed(true);
        setError(reason instanceof Error ? reason.message : "No pudimos cargar la revisión.");
      } finally { if (active) setLoading(false); }
    };
    void readReview();
    return () => { active = false; controller.abort(); };
    // A parent refresh with unchanged footage must not overwrite the user's unsaved decisions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, sourceKey, orderKey, reloadVersion]);

  const orderedTakes = order.flatMap((id) => takeById.has(id) ? [takeById.get(id)!] : []);
  const selected = takeById.get(selectedId) || orderedTakes[0];
  const approved = orderedTakes.filter((take) => decisions[take.id] === "approved");
  const pending = sessionTakes.filter((take) => !decisions[take.id] || decisions[take.id] === "pending").length;
  const bloopers = sessionTakes.filter((take) => decisions[take.id] === "blooper").length;
  const rejected = sessionTakes.filter((take) => decisions[take.id] === "rejected").length;
  const reviewed = sessionTakes.length - pending;
  const approvedDuration = approved.reduce((sum, take) => sum + Number(take.durationMs || 0), 0);
  const busy = loading || saving;
  const duplicates = approved.some((take, index) => approved.findIndex((other) => other.sceneId === take.sceneId) !== index);
  const overMontageLimit = approved.length > 12;
  const canConfirm = !busy && !loadFailed && sessionTakes.length > 0 && pending === 0 && !overMontageLimit && !duplicates;
  const titleOf = (take: Take) => {
    const title = sceneById.get(take.sceneId)?.title || "Toma sin título";
    const alternatives = sessionTakes.filter((item) => item.sceneId === take.sceneId);
    return alternatives.length > 1 ? `${title} · toma ${alternatives.findIndex((item) => item.id === take.id) + 1}` : title;
  };
  const changeDecision = (take: Take, status: ReviewStatus) => {
    if (busy) return;
    if (status === "approved") {
      const other = approved.find((item) => item.sceneId === take.sceneId && item.id !== take.id);
      if (other) {
        setError(`«${titleOf(other)}» ya está aprobada para esta escena. Márcala como blooper o descartada antes de aprobar esta alternativa.`);
        return;
      }
    }
    setDecisions((current) => ({ ...current, [take.id]: status }));
    setSelectedId(take.id); setPlaybackError(""); setError(""); setNotice(""); setSavedReview(null);
  };
  const moveApproved = (takeId: string, offset: number) => {
    const index = approved.findIndex((take) => take.id === takeId);
    const other = approved[index + offset];
    if (!other || busy) return;
    setOrder((current) => reorderReviewTakes(current, approved.map((take) => take.id), takeId, other.id, offset < 0 ? "before" : "after"));
    setSavedReview(null); setNotice("");
  };
  const finishDrag = () => { dragRef.current = null; setDragged(null); setDropPosition(null); };
  const moveTake = (list: ReviewList, takeId: string, targetId: string, edge: "before" | "after") => {
    if (busy) return;
    const visibleIds = list === "takes" ? order : approved.map((take) => take.id);
    const next = reorderReviewTakes(order, visibleIds, takeId, targetId, edge);
    if (next.every((id, index) => id === order[index])) return;
    setOrder(next);
    setSavedReview(null); setNotice("");
    const moved = takeById.get(takeId);
    const target = takeById.get(targetId);
    setOrderAnnouncement(`${moved ? titleOf(moved) : "Toma"} movida ${edge === "before" ? "antes" : "después"} de ${target ? titleOf(target) : "otra toma"}. Confirma para guardar el orden.`);
  };
  const dragProps = (takeId: string, list: ReviewList) => ({
    draggable: !busy,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (busy) { event.preventDefault(); return; }
      const value = { id: takeId, list, source: `${sourceKey}:${orderKey}` };
      dragRef.current = value; setDragged(value); setDropPosition(null);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(REVIEW_DRAG_TYPE, takeId);
    },
    onDragEnd: finishDrag,
  });
  const handleListDragOver = (event: DragEvent<HTMLElement>, list: ReviewList) => {
    const active = dragRef.current;
    if (busy || !active || active.list !== list || active.source !== `${sourceKey}:${orderKey}` || !event.dataTransfer.types.includes(REVIEW_DRAG_TYPE)) return;
    const position = dropPositionAt(event, list);
    if (!position) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    setDropPosition(position);
  };
  // The whole list accepts drops, including gaps and the insertion marker between cards.
  const handleListDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDropPosition(null);
  };
  const handleListDrop = (event: DragEvent<HTMLElement>, list: ReviewList) => {
    const active = dragRef.current;
    if (busy || !active || active.list !== list || active.source !== `${sourceKey}:${orderKey}`) return;
    const position = dropPositionAt(event, list);
    if (!position) return;
    event.preventDefault(); event.stopPropagation();
    moveTake(list, active.id, position.id, position.edge);
    finishDrag();
  };
  const dragClass = (takeId: string, list: ReviewList) => `${busy ? "" : "cursor-grab active:cursor-grabbing"} ${dragged?.id === takeId && dragged.list === list ? "opacity-40" : ""} ${dropPosition?.id === takeId && dropPosition.list === list && dragged?.id !== takeId ? dropPosition.edge === "before" ? "before:absolute before:inset-x-0 before:-top-1.5 before:h-1 before:rounded-full before:bg-violet-400" : "after:absolute after:inset-x-0 after:-bottom-1.5 after:h-1 after:rounded-full after:bg-violet-400" : ""}`;
  const dragHandle = (take: Take, list: ReviewList) => <button type="button" draggable={!busy} disabled={busy} aria-label={`Reordenar ${titleOf(take)} en ${list === "takes" ? "Tus tomas" : "Orden del montaje"}`} title="Arrastra para mover. También puedes usar ↑ y ↓ con el teclado." onClick={(event) => event.preventDefault()} onKeyDown={(event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const items = list === "takes" ? orderedTakes : approved;
    const offset = event.key === "ArrowUp" ? -1 : 1;
    const target = items[items.findIndex((item) => item.id === take.id) + offset];
    if (target) moveTake(list, take.id, target.id, offset < 0 ? "before" : "after");
  }} className="grid h-10 w-8 shrink-0 cursor-grab place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-violet-200 focus-visible:outline-2 focus-visible:outline-violet-300 active:cursor-grabbing disabled:opacity-40"><GripVertical size={17} /></button>;
  const proposeFileOrder = () => {
    const sorted = [...approved].sort((left, right) => titleOf(left).localeCompare(titleOf(right), "es", { numeric: true, sensitivity: "base" }));
    setOrder([...sorted.map((take) => take.id), ...order.filter((id) => decisions[id] !== "approved")]);
    setSavedReview(null);
    setNotice("Orden propuesto por nombre de toma. Comprueba que cuenta la historia en el orden correcto antes de confirmarlo.");
  };
  const save = async () => {
    if (!canConfirm) return;
    setSaving(true); setError("");
    try {
      let confirmed = savedReview;
      if (!confirmed) {
        const response = await fetch("/api/media-review", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, takeOrder: order, orderedTakeIds: approved.map((take) => take.id), decisions: sessionTakes.map((take) => ({ takeId: take.id, status: decisions[take.id] })) }),
        });
        const data = await response.json() as { review?: MediaReviewReceipt; error?: string };
        if (!response.ok || !data.review) throw new Error(data.error || "No pudimos guardar la revisión. Tus decisiones siguen aquí para reintentar.");
        confirmed = data.review;
        setSavedReview(confirmed);
      }
      await onConfirmed(confirmed);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No pudimos abrir el editor. Inténtalo de nuevo."); }
    finally { setSaving(false); }
  };

  return <section aria-labelledby="media-review-title" aria-busy={busy} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c0f17] text-white sm:rounded-3xl">
    <header className="border-b border-white/8 bg-gradient-to-br from-violet-500/10 to-transparent p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><button type="button" onClick={onBack} disabled={saving} aria-label="Volver al estudio" className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/20 text-zinc-300 hover:bg-white/10 disabled:opacity-40"><ArrowLeft size={17} /></button><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Antes de editar · revisión obligatoria</p><h2 id="media-review-title" className="mt-1 text-xl font-semibold sm:text-2xl">Primero, cuenta la historia en orden</h2><p className="mt-1 break-words text-sm text-zinc-400">{session.title || "Tu producción"}</p></div></div>
        <span className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-2 text-xs text-violet-200"><Film size={14} />{sessionTakes.length} tomas</span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-xs"><div className="rounded-xl bg-white/5 p-3"><span className="text-violet-300">01</span><strong className="ml-2 font-medium">Clasificar</strong><p className="mt-1 text-[10px] text-zinc-400">{reviewed}/{sessionTakes.length} revisadas</p></div><div className="rounded-xl bg-white/5 p-3"><span className="text-violet-300">02</span><strong className="ml-2 font-medium">Ordenar</strong><p className="mt-1 text-[10px] text-zinc-400">{approved.length} en el montaje</p></div><div className="rounded-xl bg-white/5 p-3"><span className="text-violet-300">03</span><strong className="ml-2 font-medium">Confirmar</strong><p className="mt-1 text-[10px] text-zinc-400">Guardar y editar</p></div></div>
      <div role="progressbar" aria-label="Tomas clasificadas" aria-valuenow={reviewed} aria-valuemin={0} aria-valuemax={Math.max(1, sessionTakes.length)} className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400 transition-[width]" style={{ width: `${sessionTakes.length ? reviewed / sessionTakes.length * 100 : 0}%` }} /></div>
    </header>
    {error && <div role="alert" className="mx-4 mt-4 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200 sm:mx-6">{error}{loadFailed && <button type="button" onClick={() => setReloadVersion((value) => value + 1)} className="ml-3 underline underline-offset-2">Reintentar carga</button>}</div>}
    {notice && <p role="status" className="mx-4 mt-4 rounded-xl border border-violet-400/15 bg-violet-400/5 p-3 text-xs leading-5 text-violet-100 sm:mx-6">{notice}</p>}
    <p aria-live="polite" className="sr-only">{orderAnnouncement}</p>
    {loading ? <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-zinc-400"><LoaderCircle size={19} className="animate-spin" />Cargando tus tomas…</div> : !sessionTakes.length ? <div className="px-6 py-14 text-center"><Film size={32} className="mx-auto text-violet-300" /><h3 className="mt-4 font-medium">Todavía no hay videos para revisar</h3><p className="mt-2 text-sm text-zinc-400">Vuelve al estudio y sube tus tomas. Después podrás clasificarlas y ordenar el montaje.</p></div> : <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.85fr)]">
      <div className="order-2 min-w-0 xl:order-1">
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Tus tomas</h3><span className={`text-xs ${pending ? "text-amber-200" : "text-emerald-200"}`}>{pending ? `${pending} por revisar` : "Todas clasificadas"}</span></div>
        <p className="mb-3 text-xs leading-5 text-zinc-400">Arrastra una tarjeta para moverla. El orden de las aprobadas se refleja también en el montaje.</p>
        <div onDragEnterCapture={(event) => handleListDragOver(event, "takes")} onDragOverCapture={(event) => handleListDragOver(event, "takes")} onDragLeave={handleListDragLeave} onDropCapture={(event) => handleListDrop(event, "takes")} className="space-y-2.5">{orderedTakes.map((take) => {
          const status = decisions[take.id] || "pending";
          const isSelected = selected?.id === take.id;
          return <article key={take.id} data-review-take={take.id} {...dragProps(take.id, "takes")} className={`relative rounded-2xl border p-3 transition ${dragClass(take.id, "takes")} ${isSelected ? "border-violet-400/55 bg-violet-400/8" : "border-white/8 bg-white/[.025]"}`}>
            <div className="flex items-center gap-1">{dragHandle(take, "takes")}<button type="button" onClick={() => { setSelectedId(take.id); setPlaybackError(""); }} aria-label={`Reproducir ${titleOf(take)}`} aria-pressed={isSelected} disabled={saving} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-violet-300">
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${isSelected ? "bg-violet-400/20 text-violet-200" : "bg-white/5 text-zinc-500"}`}><Play size={18} /></span><span className="min-w-0 flex-1"><strong className="block break-words text-sm font-medium">{titleOf(take)}</strong><span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400"><span className="inline-flex items-center gap-1"><Clock3 size={11} />{timeLabel(take.durationMs)}</span><span className={status === "approved" ? "text-emerald-300" : status === "blooper" ? "text-amber-200" : status === "pending" ? "text-violet-200" : "text-zinc-400"}>{readableStatus(status)}</span></span></span>
            </button></div>
            <div className="mt-3 grid grid-cols-3 gap-1.5">{choices.map(({ status: value, label, active, Icon }) => <button key={value} type="button" disabled={busy} onClick={() => changeDecision(take, value)} aria-label={`${label}: ${titleOf(take)}`} aria-pressed={status === value} className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-1.5 py-2 text-xs transition disabled:opacity-40 ${status === value ? active : "border-white/8 text-zinc-400 hover:border-white/20 hover:text-white"}`}><Icon size={13} />{label}</button>)}</div>
          </article>;
        })}</div>
        <p className="mt-3 text-[11px] leading-5 text-zinc-500">Descartar una toma la deja fuera del montaje. Los bloopers quedan separados. Ambas opciones conservan el video original.</p>
      </div>
      <div className="order-1 min-w-0 space-y-4 xl:order-2">
        {selected && <section className="overflow-hidden rounded-2xl border border-white/10 bg-black/25" aria-label="Revisión de la toma seleccionada"><div className="flex items-center justify-between gap-2 px-4 py-3"><h3 className="min-w-0 truncate text-xs font-medium">{titleOf(selected)}</h3><span className="shrink-0 text-[10px] text-zinc-500">Original</span></div><div className="relative flex h-[250px] items-center justify-center bg-black sm:h-[310px]"><video key={`${selected.id}:${previewAttempt}`} src={`/api/media/${encodeURIComponent(selected.id)}`} controls playsInline preload="metadata" onError={() => setPlaybackError("No se pudo reproducir esta toma. Prueba otra vez antes de decidir.")} aria-label={`Video original: ${titleOf(selected)}`} className="h-full max-w-full object-contain" />{playbackError && <p role="alert" className="absolute inset-x-4 top-4 rounded-xl bg-black/90 p-3 text-xs text-rose-200">{playbackError}<button type="button" onClick={() => { setPlaybackError(""); setPreviewAttempt((value) => value + 1); }} className="ml-2 underline">Reintentar reproducción</button></p>}</div><div className="flex items-center justify-between gap-3 px-4 py-3"><span className="text-xs text-zinc-400">{readableStatus(decisions[selected.id] || "pending")}</span>{decisions[selected.id] && decisions[selected.id] !== "pending" && <button type="button" onClick={() => changeDecision(selected, "pending")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-zinc-400 hover:text-white"><RotateCcw size={12} />Revisar de nuevo</button>}</div><div className="grid grid-cols-3 gap-2 border-t border-white/8 px-4 py-3">{choices.map(({ status: value, label, active, Icon }) => <button key={value} type="button" disabled={busy} onClick={() => changeDecision(selected, value)} aria-label={`${label} toma seleccionada`} aria-pressed={decisions[selected.id] === value} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-1.5 py-2 text-xs disabled:opacity-40 ${decisions[selected.id] === value ? active : "border-white/10 text-zinc-400 hover:text-white"}`}><Icon size={14} />{label}</button>)}</div>{pending > 0 && decisions[selected.id] && decisions[selected.id] !== "pending" && <button type="button" disabled={busy} onClick={() => { const next = orderedTakes.find((take) => !decisions[take.id] || decisions[take.id] === "pending"); if (next) { setSelectedId(next.id); setPlaybackError(""); } }} className="min-h-11 w-full border-t border-white/8 px-4 py-3 text-xs text-violet-200 hover:bg-violet-400/10 disabled:opacity-40">Siguiente toma por revisar →</button>}</section>}
        <section className="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4" aria-labelledby="review-order-title">
          <div className="flex items-start justify-between gap-3"><div><h3 id="review-order-title" className="flex items-center gap-2 text-sm font-medium"><ListOrdered size={17} className="text-violet-300" />Orden del montaje</h3><p className="mt-1.5 text-xs leading-5 text-zinc-400">Arrastra las tomas para elegir la secuencia. También puedes usar las flechas.</p></div><span className="shrink-0 rounded-lg bg-white/5 px-2 py-1 text-xs text-violet-200">{timeLabel(approvedDuration)}</span></div>
          {approved.length > 1 && <button type="button" onClick={proposeFileOrder} disabled={busy} className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-[11px] text-zinc-300 hover:bg-white/5 disabled:opacity-40">Proponer orden por nombre</button>}
          <ol onDragEnterCapture={(event) => handleListDragOver(event, "montage")} onDragOverCapture={(event) => handleListDragOver(event, "montage")} onDragLeave={handleListDragLeave} onDropCapture={(event) => handleListDrop(event, "montage")} className="mt-4 space-y-2">{approved.map((take, index) => <li key={take.id} data-review-take={take.id} {...dragProps(take.id, "montage")} className={`relative flex items-center gap-2 rounded-xl border border-white/8 bg-[#111521] p-2.5 ${dragClass(take.id, "montage")}`}>{dragHandle(take, "montage")}<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-400/15 text-xs font-semibold text-violet-200">{index + 1}</span><button type="button" disabled={saving} onClick={() => { setSelectedId(take.id); setPlaybackError(""); }} className="min-w-0 flex-1 text-left"><span className="block break-words text-xs font-medium">{titleOf(take)}</span><span className="mt-0.5 block text-[10px] text-zinc-500">{index === 0 ? "Inicio" : index === approved.length - 1 ? "Cierre" : "Continuación"} · {timeLabel(take.durationMs)}</span></button><div className="flex shrink-0 gap-1"><button type="button" onClick={() => moveApproved(take.id, -1)} disabled={busy || index === 0} aria-label={`Mover ${titleOf(take)} antes`} className="grid h-11 w-11 place-items-center rounded-lg bg-white/5 text-zinc-300 hover:bg-white/10 disabled:opacity-25"><ArrowUp size={15} /></button><button type="button" onClick={() => moveApproved(take.id, 1)} disabled={busy || index === approved.length - 1} aria-label={`Mover ${titleOf(take)} después`} className="grid h-11 w-11 place-items-center rounded-lg bg-white/5 text-zinc-300 hover:bg-white/10 disabled:opacity-25"><ArrowDown size={15} /></button></div></li>)}</ol>
          {!approved.length && <p className="mt-4 rounded-xl border border-dashed border-violet-400/20 px-4 py-6 text-center text-xs leading-5 text-zinc-400">Aprueba las tomas que sí deben aparecer.<br />Aquí se armará su secuencia.</p>}
          {duplicates && <p role="alert" className="mt-3 text-xs leading-5 text-amber-200">Hay más de una toma aprobada para la misma escena. Elige una y clasifica las alternativas como blooper o descartadas.</p>}
          <p className={`mt-3 text-xs leading-5 ${overMontageLimit ? "text-amber-200" : "text-zinc-500"}`} role={overMontageLimit ? "alert" : undefined}>{overMontageLimit ? `Tienes ${approved.length} tomas aprobadas. Este montaje admite hasta 12: elige cuáles incluir antes de confirmar. Las demás pueden quedar como bloopers o descartadas, sin borrar los originales.` : "Hasta 12 tomas aprobadas por montaje. Puedes subir y revisar más material."}</p>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/8 pt-3 text-[10px]"><span className="rounded-lg bg-amber-300/10 px-2 py-1.5 text-amber-200">{bloopers} bloopers separados</span><span className="rounded-lg bg-white/5 px-2 py-1.5 text-zinc-400">{rejected} descartadas del montaje</span></div>
        </section>
      </div>
    </div>}
    <footer className="flex flex-col gap-3 border-t border-white/10 bg-[#111521] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <p className="text-xs leading-5 text-zinc-400">{pending ? `Falta decidir qué hacer con ${pending} toma${pending === 1 ? "" : "s"}.` : !approved.length ? "No hay tomas para el montaje. Guarda la clasificación; podrás aprobar alguna después para editar." : overMontageLimit ? "Selecciona hasta 12 tomas aprobadas para este montaje." : duplicates ? "Resuelve las alternativas de una misma escena." : <span className="flex items-center gap-2 text-emerald-200"><CheckCircle2 size={16} />{approved.length} toma{approved.length === 1 ? "" : "s"} lista{approved.length === 1 ? "" : "s"}. Confirma que este es el orden correcto.</span>}<span className="mt-1 block text-[10px] text-zinc-500">Las decisiones y el orden se guardan al confirmar.</span></p>
      <button type="button" onClick={() => void save()} disabled={!canConfirm} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-white/8 disabled:text-zinc-500">{saving ? <LoaderCircle size={17} className="animate-spin" /> : <Check size={17} />}{saving ? "Guardando revisión…" : !approved.length ? "Guardar clasificación" : savedReview ? "Abrir editor" : "Confirmar orden y abrir editor"}</button>
    </footer>
  </section>;
}
