"use client";

import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const frame = window.requestAnimationFrame(() => setInstalled(standalone));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!prompt) return setShowHelp(true);
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setPrompt(null);
  };

  return <>
    <button onClick={install} aria-label="Instalar Segmenta Studio" className="flex h-10 items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs text-violet-200">
      <Download size={14} /><span className="hidden sm:inline">Instalar app</span>
    </button>
    {showHelp && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="install-title" className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111521] p-6 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">Instalación</p><h2 id="install-title" className="mt-1 text-xl font-semibold">Lleva Segmenta Studio a tu pantalla</h2></div><button onClick={() => setShowHelp(false)} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><X size={16} /></button></div>
        <div className="mt-6 space-y-4 text-sm leading-6 text-zinc-300">
          <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><strong className="block text-white">iPhone o iPad</strong><span className="mt-1 block text-zinc-500">Abre esta página en Safari, toca <Share className="mx-1 inline" size={15} /> Compartir y elige “Agregar a pantalla de inicio”.</span></div>
          <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><strong className="block text-white">Android o computador</strong><span className="mt-1 block text-zinc-500">Abre el menú de Chrome y selecciona “Instalar aplicación”.</span></div>
        </div>
      </section>
    </div>}
  </>;
}
