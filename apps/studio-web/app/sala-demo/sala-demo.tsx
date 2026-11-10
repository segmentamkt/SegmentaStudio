"use client";

import { useCallback, useEffect, useState } from "react";
import { SalaEdicion, type SalaClip } from "../../components/sala/sala-edicion";
import { decodeSpeechWav } from "../../lib/transcription-core";

type DemoClip = SalaClip & { audioUrl: string };
type DemoData = { projectName: string; clips: DemoClip[] };

/** Carga tomas locales de public/_dev/sala (generadas con scripts/skills/sala-demo-data.ts). */
export function SalaDemo() {
  const [data, setData] = useState<DemoData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/_dev/sala/data.json", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<DemoData> : Promise.reject(new Error("Falta public/_dev/sala/data.json")))
      .then((value: DemoData) => setData(value)).catch((reason: Error) => setError(reason.message));
  }, []);
  const loadAudio = useCallback(async (clip: SalaClip, signal: AbortSignal) => {
    const source = data?.clips.find((item) => item.id === clip.id);
    if (!source) return null;
    const response = await fetch(source.audioUrl, { signal });
    const samples = decodeSpeechWav(await response.arrayBuffer());
    const rate = 16_000;
    return { samples: samples.subarray(Math.floor(clip.window.start * rate), Math.ceil(clip.window.end * rate)), sampleRate: rate };
  }, [data]);
  if (error) return <p className="p-6 text-sm text-amber-300">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-zinc-400">Cargando…</p>;
  return <SalaEdicion projectName={data.projectName} styleName="Segmenta cinético" soundEffects clips={data.clips} loadAudio={loadAudio} />;
}
