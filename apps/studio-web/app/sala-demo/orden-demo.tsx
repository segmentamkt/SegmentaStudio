"use client";

import { useEffect, useState } from "react";
import { UploadOrderReview } from "../../components/upload-order-review";
import { planUploadOrder, type UploadOrderPlan } from "../../lib/upload-order";
import { readCaptureDate } from "../../lib/video-capture-date";

/** Banco local de «Así quedará tu video»: carga videos de public/_dev/orden con su nombre real, en el orden indicado. */
const FILES = ["WhatsApp Video 2026-11-06 at 14.39.47 (4).mp4", "IMG_8382.MOV"];

export function OrdenDemo() {
  const [state, setState] = useState<{ files: File[]; plan: UploadOrderPlan } | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const files = await Promise.all(FILES.map(async (name) => {
          const response = await fetch(`/_dev/orden/${encodeURIComponent(name)}`);
          if (!response.ok) throw new Error(`Falta public/_dev/orden/${name}`);
          return new File([await response.blob()], name, { type: name.endsWith(".mp4") ? "video/mp4" : "video/quicktime" });
        }));
        const dates = await Promise.all(files.map((file) => readCaptureDate(file)));
        setState({ files, plan: planUploadOrder(files.map((file, index) => ({ index, name: file.name, capturedAt: dates[index]?.date ?? null }))) });
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    })();
  }, []);
  if (error) return <p className="p-6 text-sm text-amber-300">{error}</p>;
  if (!state) return <p className="p-6 text-sm text-zinc-400">Leyendo la fecha de grabación de cada video…</p>;
  return <div className="min-h-screen bg-(--c-06070b) p-6 text-sm text-zinc-300">
    <p>Elegidos en este orden: {FILES.join(" · ")}</p>
    {result && <p className="mt-2 text-emerald-300" data-testid="orden-resultado">Se subirían en este orden: {result}</p>}
    {!result && <UploadOrderReview files={state.files} plan={state.plan} targets={["Escena 1: Intro", "Escena 2: Producto"]} scriptNote
      onCancel={() => setResult("(cancelado)")} onConfirm={(ordered) => setResult(ordered.map((file) => file.name).join(" · "))} />}
  </div>;
}
