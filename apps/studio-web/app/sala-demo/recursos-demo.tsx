"use client";

import { useState } from "react";
import { VisualResourcesPanel, type AiPanelState } from "../../components/visual-resources-panel";
import type { VisualResource, VisualResourceImage } from "../../lib/visual-resources";

/** Banco local del panel de recursos con IA (sin claves: los botones solo registran lo que harían). */
export function RecursosDemo() {
  const [log, setLog] = useState<string[]>([]);
  const [keys, setKeys] = useState<Record<"gemini" | "openai", boolean>>({ gemini: true, openai: true });
  const [prefs, setPrefs] = useState<AiPanelState["prefs"]>({ provider: "pexels", style: "3d", automatic: true });
  const library = (assetId: "money" | "growth" | "work"): VisualResourceImage => ({ kind: "builtin", assetId });
  const resource: VisualResource = { id: "ai:toma-0:4310", keyword: "talentos", startSeconds: 4.31, endSeconds: 6.91, layout: "wide", image: library("growth") };
  const clip = { segmentId: "toma-0", title: "Parábola de los talentos", trimStartSeconds: 0, trimEndSeconds: 36.89, visualResources: [resource], included: true };
  const note = (text: string) => setLog((current) => [text, ...current].slice(0, 6));
  return <div className="min-h-screen bg-[#06070b] p-6 text-zinc-200">
    <div className="mb-4 flex gap-2 text-xs">
      <button type="button" onClick={() => setKeys({ gemini: false, openai: false })} className="rounded border border-white/15 px-2 py-1">Sin claves</button>
      <button type="button" onClick={() => setKeys({ gemini: true, openai: false })} className="rounded border border-white/15 px-2 py-1">Solo Gemini</button>
      <button type="button" onClick={() => setKeys({ gemini: true, openai: true })} className="rounded border border-white/15 px-2 py-1">Las dos</button>
    </div>
    <div className="grid gap-6 md:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border border-white/10 bg-[#0b0d13] p-4">
        <VisualResourcesPanel clips={[clip]} selectedClip={clip} enabled disabled={false} message="" onToggle={() => note("toggle")} onRecommend={() => note("biblioteca")}
          onAdd={() => note("añadir")} onReplace={() => note("reemplazar")} onChange={() => note("cambiar")} onSeek={() => note("ver")}
          ai={{ available: { ...keys, pexels: keys.gemini, openverse: true }, prefs, running: false, progress: "", plannedCount: 3, alternatives: { [resource.id]: [library("work"), library("money")] },
            onPrefs: (next) => { setPrefs(next); note(`preferencias: ${JSON.stringify(next)}`); }, onGenerate: () => note("crear con IA"), onStop: () => note("detener"),
            onRegenerate: (_segment, _id, provider) => note(`otra versión con ${provider}`), onChooseAlternative: () => note("usar versión") }} />
      </div>
      <ol className="space-y-1 text-xs text-emerald-300" data-testid="registro">{log.map((item, index) => <li key={index}>{item}</li>)}</ol>
    </div>
  </div>;
}
