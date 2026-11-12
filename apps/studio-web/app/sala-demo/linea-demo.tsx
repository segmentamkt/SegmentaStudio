"use client";

import { useState } from "react";
import { EditorTimeline, type TimelineItem } from "../../components/editor-timeline";

/** Banco local de la línea de tiempo con carriles: cuatro tomas de prueba, subtítulos y rótulos. */
const START: TimelineItem[] = [
  { id: "a", title: "Intro", start: 0, end: 6.4, speed: 1, included: true, sourceDuration: 14, label: "Lechona tradicional", cues: [{ start: 0.2, end: 2.1, text: "Hoy te muestro" }, { start: 2.2, end: 5.8, text: "cómo se prepara" }] },
  { id: "b", title: "Lechona", start: 1.2, end: 9.8, speed: 1, included: true, sourceDuration: 12, cues: [{ start: 1.4, end: 4.0, text: "la lechona tolimense" }, { start: 4.1, end: 9.6, text: "con arroz y arveja" }] },
  { id: "c", title: "Pausa", start: 0, end: 3, speed: 1, included: false, sourceDuration: 3 },
  { id: "d", title: "Cierre rápido", start: 0.5, end: 7.5, speed: 2, included: true, sourceDuration: 9, label: "Gracias por ver", cues: [{ start: 0.6, end: 3.5, text: "pruébala en casa" }] },
];

export function LineaDemo() {
  const [items, setItems] = useState(START);
  const [selectedId, setSelectedId] = useState("a");
  const [playhead, setPlayhead] = useState(0);
  const update = (id: string, patch: Partial<TimelineItem>) => setItems((list) => list.map((item) => item.id === id ? { ...item, ...patch } : item));
  const selected = items.find((item) => item.id === selectedId);
  return (
    <main className="min-h-screen bg-(--c-07090e) p-4 text-zinc-300 sm:p-8">
      <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-(--c-0b0e15) p-3 sm:p-4">
        <EditorTimeline
          items={items}
          selectedId={selectedId}
          playhead={playhead}
          busy={false}
          onSeek={(id, seconds) => { setSelectedId(id); setPlayhead(seconds); }}
          onTrim={(id, start, end) => update(id, { start, end })}
          onReorder={(id, toIndex) => setItems((list) => {
            const from = list.findIndex((item) => item.id === id);
            if (from < 0 || toIndex === from) return list;
            const next = [...list];
            const [moved] = next.splice(from, 1);
            next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
            return next;
          })}
          onSplit={(id, seconds) => setItems((list) => list.flatMap((item) => {
            if (item.id !== id || seconds - item.start < 0.2 || item.end - seconds < 0.2) return [item];
            return [{ ...item, end: seconds }, { ...item, id: `${id}-${Date.now()}`, start: seconds, title: `${item.title} (2)` }];
          }))}
          onDuplicate={(id) => setItems((list) => list.flatMap((item) => item.id === id ? [item, { ...item, id: `${id}-copia-${Date.now()}`, title: `${item.title} (copia)` }] : [item]))}
          onToggle={(id) => update(id, { included: !items.find((item) => item.id === id)?.included })}
        />
        <p className="mt-4 text-[10px] text-zinc-500">Cursor: {playhead.toFixed(2)} s de origen · toma: {selected?.title ?? "ninguna"} · orden: {items.map((item) => item.title).join(" → ")}</p>
      </div>
    </main>
  );
}
