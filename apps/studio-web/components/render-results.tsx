"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, Film, LoaderCircle, Pencil, RotateCw } from "lucide-react";

export type RenderOutput = {
  id: string;
  sessionId: string | null;
  name: string;
  sizeBytes: number;
  createdAt: string | null;
  previewUrl: string;
  downloadUrl: string;
};

type Session = { id?: string; title?: string };

export function RenderResults({ sessions, editableOutputIds, onEditOutput }: { sessions: Session[]; editableOutputIds: string[]; onEditOutput: (output: RenderOutput) => Promise<void> }) {
  const [outputs, setOutputs] = useState<RenderOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [editingId, setEditingId] = useState("");
  const [editError, setEditError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/editor/outputs", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { outputs?: RenderOutput[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los resultados.");
        return data.outputs || [];
      })
      .then((items) => { if (!cancelled) { setOutputs(items); setError(""); setLoading(false); } })
      .catch((reason) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "No se pudieron cargar los resultados."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [version]);

  const refresh = () => { setLoading(true); setVersion((value) => value + 1); };
  const labelFor = (item: RenderOutput) => sessions.find((session) => session.id === item.sessionId)?.title || "Edición guardada";
  const visibleOutputs = outputs.filter((item) => !item.sessionId || sessions.some((session) => session.id === item.sessionId));
  const edit = async (item: RenderOutput) => {
    setEditingId(item.id); setEditError("");
    try { await onEditOutput(item); }
    catch (reason) { setEditError(reason instanceof Error ? reason.message : "No pudimos abrir esta edición."); }
    finally { setEditingId(""); }
  };

  return <section className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/[.04] p-4 sm:rounded-3xl sm:p-6" aria-labelledby="render-results-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-emerald-300"><Film size={14} />Exportaciones</p><h2 id="render-results-heading" className="mt-1 text-xl font-semibold sm:text-2xl">Resultados editados</h2><p className="mt-1 text-xs leading-5 text-zinc-400">Aquí puedes reproducir y descargar cada MP4 terminado. Revisa el video completo antes de publicarlo.</p></div>
      <button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300 disabled:opacity-50">{loading ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCw size={14} />}Actualizar</button>
    </div>
    {loading && <p className="mt-5 flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle size={16} className="animate-spin" />Buscando ediciones guardadas…</p>}
    {error && !loading && <p role="alert" className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-200">{error}</p>}
    {editError && <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-200">{editError}</p>}
    {!loading && !error && visibleOutputs.length === 0 && <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/20 p-5"><p className="text-sm font-medium">Aún no hay un MP4 final guardado.</p><p className="mt-1 text-xs leading-5 text-zinc-500">Si el editor mostró un error o se quedó en progreso, ese intento no produjo un resultado. Abre el editor y vuelve a renderizar.</p></div>}
    {!loading && !error && visibleOutputs.length > 0 && <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleOutputs.map((item, index) => <article key={`${item.sessionId || "legacy"}:${item.id}`} className="overflow-hidden rounded-2xl border border-white/10 bg-(--c-0c0f18)">
      <div data-theme="dark" className="relative mx-auto aspect-[9/16] max-h-[480px] w-full bg-black"><video src={item.previewUrl} aria-label={`Resultado editado: ${labelFor(item)}`} controls playsInline preload={index < 3 ? "metadata" : "none"} className="h-full w-full object-contain" /><span className="pointer-events-none absolute left-2 top-2 rounded-full bg-emerald-400 px-2.5 py-1 text-[9px] font-bold text-black">RESULTADO EDITADO</span></div>
      <div className="p-4"><p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 size={16} className="text-emerald-300" /><span className="min-w-0 truncate">{labelFor(item)}</span></p><p className="mt-1 text-[10px] text-zinc-500">{item.createdAt ? new Date(item.createdAt).toLocaleString("es-CO") : "Fecha no disponible"} · {(item.sizeBytes / 1024 / 1024).toFixed(1)} MB</p><button onClick={() => void edit(item)} disabled={Boolean(editingId)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{editingId === item.id ? <LoaderCircle size={15} className="animate-spin" /> : <Pencil size={15} />}{editableOutputIds.includes(item.id) ? "Seguir editando este video" : "Editar una copia del MP4"}</button>{!editableOutputIds.includes(item.id) && <p className="mt-2 text-[10px] leading-4 text-amber-200/80">En la copia puedes recortar, ajustar y añadir elementos. Los subtítulos y efectos ya incrustados en el MP4 permanecen.</p>}<a href={item.downloadUrl} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black"><Download size={15} />Descargar resultado MP4</a></div>
    </article>)}</div>}
  </section>;
}
