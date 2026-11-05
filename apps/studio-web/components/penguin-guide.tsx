"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Send, X } from "lucide-react";
import { answerPenguinGuide, guideNextStep, GUIDE_SUGGESTIONS, type GuideAction, type GuideContext } from "../lib/penguin-guide";

type Message = { id: string; role: "user" | "guide"; text: string; action?: GuideAction };

export function PenguinGuide({ context, onAction }: { context: GuideContext; onAction: (action: GuideAction) => void }) {
  const [open, setOpen] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const next = guideNextStep(context);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShowNudge(window.localStorage.getItem("segmenta.penguin-guide-seen.v1") !== "1"));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); launcherRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  const openGuide = () => {
    setOpen(true);
    setShowNudge(false);
    window.localStorage.setItem("segmenta.penguin-guide-seen.v1", "1");
  };

  const ask = (question: string) => {
    const trimmed = question.trim().slice(0, 240);
    if (!trimmed) return;
    const reply = answerPenguinGuide(trimmed, context);
    setMessages((current) => [...current.slice(-18),
      { id: crypto.randomUUID(), role: "user", text: trimmed },
      { id: crypto.randomUUID(), role: "guide", text: reply.text, action: reply.action },
    ]);
    setDraft("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); ask(draft); };
  const act = (action: GuideAction) => { onAction(action); setOpen(false); launcherRef.current?.focus(); };

  return <div className="pointer-events-none fixed inset-0 z-30" aria-label="Ayuda de Segmenta Studio">
    {open && <section id="penguin-guide-panel" role="dialog" aria-modal="false" aria-labelledby="penguin-guide-title" className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] left-3 right-3 flex max-h-[min(72dvh,620px)] flex-col overflow-hidden rounded-[1.5rem] border border-violet-300/25 bg-[#111521] text-white shadow-[0_18px_80px_rgba(0,0,0,.7)] sm:left-auto sm:right-5 sm:w-[380px]">
      <header className="flex items-center gap-3 border-b border-white/10 bg-gradient-to-r from-violet-500/20 to-cyan-400/10 px-4 py-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10"><Image src="/penguin-guide.svg" width={43} height={43} alt="" /></span>
        <div className="min-w-0 flex-1"><h2 id="penguin-guide-title" className="text-sm font-semibold">Tu pingüino guía</h2><p className="text-[11px] text-violet-100/70">Te acompaño paso a paso</p></div>
        <button onClick={() => { setOpen(false); launcherRef.current?.focus(); }} aria-label="Cerrar guía" className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"><X size={18} /></button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-white/[.07] p-3 text-xs leading-5 text-zinc-200">
          <strong className="mb-1 block text-violet-200">¡Hola! 🐧</strong>
          {next.text}
          {next.action && <button onClick={() => act(next.action!)} className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-200 hover:text-white">{next.action.label}<ArrowRight size={13} /></button>}
        </div>
        {messages.map((message) => <div key={message.id} className={`max-w-[92%] rounded-2xl p-3 text-xs leading-5 ${message.role === "user" ? "ml-auto rounded-tr-sm bg-violet-500 text-white" : "rounded-tl-sm bg-white/[.07] text-zinc-200"}`}><p>{message.text}</p>{message.action && <button onClick={() => act(message.action!)} className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-200 hover:text-white">{message.action.label}<ArrowRight size={13} /></button>}</div>)}
      </div>

      <div className="border-t border-white/10 bg-[#0d1019] p-3">
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">{GUIDE_SUGGESTIONS.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)} className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] text-zinc-300 hover:border-violet-300/40 hover:text-white">{suggestion}</button>)}</div>
        <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1.5 focus-within:border-violet-300/50"><input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={240} aria-label="Pregúntale al pingüino" placeholder="¿Qué quieres aprender?" className="min-w-0 flex-1 bg-transparent px-2 text-xs text-white outline-none placeholder:text-zinc-500" /><button type="submit" disabled={!draft.trim()} aria-label="Enviar pregunta" className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500 text-white disabled:opacity-40"><Send size={15} /></button></form>
        <p className="mt-2 text-center text-[9px] text-zinc-600">Guía contextual de la plataforma · sin claves API</p>
      </div>
    </section>}

    {!open && showNudge && <button onClick={openGuide} className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+5.7rem)] right-4 max-w-[220px] rounded-2xl border border-violet-300/25 bg-[#171b2a] px-3 py-2 text-left text-xs text-white shadow-2xl sm:right-5"><strong className="block">¿Primera vez aquí?</strong><span className="mt-0.5 block text-[11px] text-zinc-400">Te enseño a editar paso a paso.</span></button>}
    <button ref={launcherRef} onClick={open ? () => setOpen(false) : openGuide} aria-label={open ? "Cerrar pingüino guía" : "Abrir pingüino guía"} aria-expanded={open} aria-controls={open ? "penguin-guide-panel" : undefined} className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 grid h-16 w-16 place-items-center rounded-full border-2 border-violet-300/45 bg-[#29203f] shadow-[0_8px_34px_rgba(124,58,237,.55)] transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:right-5"><Image src="/penguin-guide.svg" width={58} height={58} alt="" /><span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-[#111521] bg-emerald-400" /></button>
  </div>;
}
