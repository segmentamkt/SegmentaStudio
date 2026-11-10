'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Sparkles, Trash2, Eye, Upload, LoaderCircle, WandSparkles, Square, KeyRound } from 'lucide-react';
import { VISUAL_RESOURCE_CATALOG, resourceImageSrc, type VisualResource, type VisualResourceImage } from '../lib/visual-resources';
import { AI_PROVIDERS, AI_STYLES, SOURCE_LABELS, providerOfTitle, type AiImageProvider, type AiImageStyle, type ImageSource } from '../lib/ai-visual-resources';

type AiChoice = 'pexels' | AiImageProvider | 'both';
const CHOICE_LABELS: Record<AiChoice, string> = { pexels: 'Fotos Pexels · gratis', gemini: 'Gemini', openai: 'ChatGPT', both: 'Gemini + ChatGPT' };
export type AiPanelState = {
  available: Record<ImageSource, boolean> | null;
  prefs: { provider: AiChoice; style: AiImageStyle; automatic: boolean };
  running: boolean; progress: string; plannedCount: number;
  alternatives: Record<string, VisualResourceImage[]>;
  onPrefs: (prefs: { provider: AiChoice; style: AiImageStyle; automatic: boolean }) => void;
  onGenerate: () => void; onStop: () => void;
  onRegenerate: (segmentId: string, id: string, source: 'stock' | AiImageProvider) => void;
  onChooseAlternative: (segmentId: string, id: string, image: VisualResourceImage) => void;
};
const PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiImageProvider[];
const imageProvider = (image: VisualResourceImage) => image.kind === 'upload' ? providerOfTitle(image.title) : null;
import { prepareVisualImage } from '../lib/visual-resource-editing';

type ResourceClip = { segmentId: string; title: string; trimStartSeconds: number; trimEndSeconds: number; visualResources: VisualResource[]; included: boolean };
export function VisualResourcesPanel({ clips, selectedClip, enabled, disabled, message, onToggle, onRecommend, onAdd, onReplace, onChange, onSeek, ai }: {
  clips: ResourceClip[]; selectedClip?: ResourceClip; enabled: boolean; disabled: boolean; message: string;
  onToggle: () => void; onRecommend: () => void; onAdd: (segmentId: string, image: VisualResourceImage) => void;
  onReplace: (segmentId: string, id: string, image: VisualResourceImage) => void;
  onChange: (segmentId: string, resources: VisualResource[]) => void; onSeek: (segmentId: string, time: number) => void;
  ai?: AiPanelState;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<{ segmentId: string; replacementId?: string } | null>(null);
  const mountedRef = useRef(true);
  const uploadingRef = useRef(false);
  const callbacksRef = useRef({ onAdd, onReplace });
  useEffect(() => { callbacksRef.current = { onAdd, onReplace }; }, [onAdd, onReplace]);
  useEffect(() => {
    mountedRef.current = true;
    const input = uploadRef.current;
    const cancel = () => {
      uploadTargetRef.current = null;
      if (input) input.value = '';
    };
    input?.addEventListener('cancel', cancel);
    return () => {
      mountedRef.current = false;
      uploadTargetRef.current = null;
      input?.removeEventListener('cancel', cancel);
    };
  }, []);
  const resources = clips.filter((clip) => clip.included).flatMap((clip) => clip.visualResources.map((item) => ({ clip, item })));
  const locked = disabled || uploading || Boolean(ai?.running);
  const ready = (provider: AiImageProvider) => ai?.available?.[provider] === true;
  // Stock photos always work: Pexels with its free key, otherwise Openverse (public domain, no key).
  const stockReady = Boolean(ai?.available);
  const usable = (choice: AiChoice) => choice === 'pexels' ? stockReady : choice === 'both' ? PROVIDER_IDS.every(ready) : ready(choice);
  const aiChoice = ai && ai.prefs.provider !== 'pexels';
  const chosen: AiImageProvider[] = !ai || ai.prefs.provider === 'pexels' ? [] : ai.prefs.provider === 'both' ? PROVIDER_IDS : [ai.prefs.provider];
  const perImage = chosen.filter(ready).reduce((sum, provider) => sum + AI_PROVIDERS[provider].approxUsdPerImage, 0);
  const label = (image: VisualResourceImage) => { const source = imageProvider(image); return source ? SOURCE_LABELS[source] : null; };
  const openUpload = (segmentId: string, replacementId?: string) => {
    if (locked) return;
    uploadTargetRef.current = { segmentId, replacementId };
    if (uploadRef.current) {
      uploadRef.current.value = '';
      uploadRef.current.click();
    }
  };
  const upload = async (file?: File) => {
    const target = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (!file || !target || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true); setError('');
    try {
      const image = await prepareVisualImage(file);
      if (!mountedRef.current) return;
      // The selection can change during decoding; only update the original destination.
      if (target.replacementId) callbacksRef.current.onReplace(target.segmentId, target.replacementId, image);
      else callbacksRef.current.onAdd(target.segmentId, image);
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : 'No pudimos añadir esa imagen.');
    } finally {
      uploadingRef.current = false;
      if (mountedRef.current) {
        setUploading(false);
        if (uploadRef.current) uploadRef.current.value = '';
      }
    }
  };
  const patch = (clip: ResourceClip, resource: VisualResource, values: Partial<VisualResource>) => onChange(clip.segmentId, clip.visualResources.map((item) => item.id === resource.id ? { ...item, ...values } : item));
  return <section aria-label="Recursos visuales" className="max-h-[680px] space-y-4 overflow-y-auto overscroll-contain pr-1">
    <div><p className="flex items-center gap-2 text-sm font-semibold"><ImagePlus size={18} className="text-cyan-300" />Imágenes que acompañan tu voz</p><p className="mt-2 text-xs leading-5 text-zinc-400">Aparecen justo cuando dices la idea y se incluyen en el MP4. Studio las busca solo (fotos de Pexels, gratis) o las crea con Gemini o ChatGPT si pones sus claves.</p></div>
    {ai && <div className="space-y-3 rounded-2xl border border-[#FF7A00]/25 bg-[#FF7A00]/[.05] p-3" aria-label="Imágenes automáticas">
      <p className="flex items-center gap-2 text-xs font-semibold text-white"><WandSparkles size={15} className="text-[#FFB066]" />Imágenes automáticas</p>
      <p className="text-[10px] leading-4 text-zinc-400">Una imagen por cada momento clave de lo que dices (por ejemplo «la lechona», «tu equipo»), justo cuando lo dices.</p>
      <div role="radiogroup" aria-label="De dónde salen las imágenes" className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 p-1 text-[11px]">
        {(['pexels', ...PROVIDER_IDS, 'both'] as AiChoice[]).map((choice) => <button key={choice} type="button" role="radio" aria-checked={ai.prefs.provider === choice} disabled={locked || (ai.available !== null && !usable(choice))} onClick={() => ai.onPrefs({ ...ai.prefs, provider: choice })}
          className={`min-h-9 rounded-lg px-2 ${ai.prefs.provider === choice ? 'bg-white font-semibold text-black' : 'text-zinc-300'} disabled:opacity-35`} title={ai.available !== null && !usable(choice) ? 'Necesita su clave en Vercel' : undefined}>{CHOICE_LABELS[choice]}</button>)}
      </div>
      {ai.prefs.provider === 'pexels' && ai.available && !ai.available.pexels && <p className="flex gap-2 rounded-lg bg-black/30 p-2 text-[10px] leading-4 text-amber-100"><KeyRound size={13} className="mt-0.5 shrink-0" /><span>Falta la clave gratis de Pexels (<code>PEXELS_API_KEY</code> en Vercel). Mientras tanto se usan fotos de dominio público de Openverse, que encuentran menos temas.</span></p>}
      {aiChoice && <div role="radiogroup" aria-label="Estilo de las imágenes" className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 p-1 text-[11px]">
        {(Object.keys(AI_STYLES) as AiImageStyle[]).map((style) => <button key={style} type="button" role="radio" aria-checked={ai.prefs.style === style} disabled={locked} onClick={() => ai.onPrefs({ ...ai.prefs, style })}
          className={`min-h-9 rounded-lg px-2 ${ai.prefs.style === style ? 'bg-white font-semibold text-black' : 'text-zinc-300'}`}>{AI_STYLES[style].label}</button>)}
      </div>}
      <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-300"><span>Ponerlas solas en la edición automática</span><input type="checkbox" checked={ai.prefs.automatic} disabled={locked || !usable(ai.prefs.provider)} onChange={(event) => ai.onPrefs({ ...ai.prefs, automatic: event.target.checked })} className="h-4 w-4 accent-[#FF7A00]" /></label>
      {ai.running
        ? <button type="button" onClick={ai.onStop} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 text-xs text-zinc-200"><Square size={13} />Detener</button>
        : <button type="button" onClick={ai.onGenerate} disabled={locked || !usable(ai.prefs.provider) || ai.plannedCount === 0} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#FF7A00] p-3 text-xs font-semibold text-black disabled:opacity-40"><WandSparkles size={15} />{ai.plannedCount ? `Poner ${ai.plannedCount} ${ai.plannedCount === 1 ? 'imagen' : 'imágenes'} ahora` : 'Sin momentos nuevos para imágenes'}</button>}
      {ai.running && <p role="status" className="flex items-center gap-2 text-[11px] text-[#FFB066]"><LoaderCircle size={13} className="animate-spin" />{ai.progress || 'Buscando imágenes…'}</p>}
      {!ai.running && ai.plannedCount > 0 && (aiChoice
        ? perImage > 0 && <p className="text-[10px] text-zinc-500">Costo aproximado en tu cuenta: {(ai.plannedCount * perImage).toFixed(2).replace('.', ',')} USD ({ai.plannedCount} × {perImage.toFixed(3).replace('.', ',')}).</p>
        : <p className="text-[10px] text-zinc-500">Gratis · fotos con licencia de uso comercial de <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="text-zinc-300 underline">Pexels</a>{ai.available?.pexels ? '' : ' y Openverse'}.</p>)}
    </div>}
    <button type="button" aria-pressed={enabled} disabled={locked} onClick={onToggle} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border p-3 text-left text-xs ${enabled ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-zinc-400'}`}><span>Recursos en la edición automática</span><strong>{enabled ? 'Activados' : 'Desactivados'}</strong></button>
    <button type="button" onClick={onRecommend} disabled={locked} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 p-3 text-xs font-semibold disabled:opacity-40"><Sparkles size={15} />Detectar apoyos por palabras</button>
    <p role="status" className="text-[11px] leading-5 text-cyan-200">{message || `${resources.length} de 8 imágenes en el montaje. Tus imágenes elegidas se conservan.`}</p>
    <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Subir imagen de apoyo" disabled={locked} onChange={(event) => void upload(event.target.files?.[0])} />
    {resources.length > 0 && <div className="space-y-3" aria-label="Imágenes aplicadas">{resources.map(({ clip, item }) => <article key={`${clip.segmentId}:${item.id}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex gap-3">{/* Plain img also supports local data URLs without a remote optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resourceImageSrc(item.image)} alt={`Apoyo visual: ${item.keyword}`} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        <div className="min-w-0"><strong className="block text-xs text-white">«{item.keyword}»</strong><p className="mt-1 truncate text-[10px] text-zinc-500">{clip.title}</p><button type="button" disabled={locked} onClick={() => onSeek(clip.segmentId, item.startSeconds + .05)} className="mt-1 flex min-h-8 items-center gap-1 text-[11px] text-cyan-200"><Eye size={12} />Ver en el video</button></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[10px] text-zinc-400">Desde (s)<input aria-label={`Inicio de imagen ${item.keyword}`} type="number" step="0.1" min={clip.trimStartSeconds} max={item.endSeconds - .1} value={Number(item.startSeconds.toFixed(2))} disabled={locked} onChange={(event) => { const start = event.target.valueAsNumber; if (Number.isFinite(start) && start >= clip.trimStartSeconds && start <= item.endSeconds - .1 && item.endSeconds - start <= 12) patch(clip, item, { startSeconds: start }); }} className="mt-1 min-h-9 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label><label className="text-[10px] text-zinc-400">Hasta (s)<input aria-label={`Final de imagen ${item.keyword}`} type="number" step="0.1" min={item.startSeconds + .1} max={Math.min(clip.trimEndSeconds, item.startSeconds + 12)} value={Number(item.endSeconds.toFixed(2))} disabled={locked} onChange={(event) => { const end = event.target.valueAsNumber; if (Number.isFinite(end) && end <= clip.trimEndSeconds && end >= item.startSeconds + .1 && end - item.startSeconds <= 12) patch(clip, item, { endSeconds: end }); }} className="mt-1 min-h-9 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs text-white" /></label></div>
      <select aria-label={`Encuadre de imagen ${item.keyword}`} value={item.layout} disabled={locked} onChange={(event) => patch(clip, item, { layout: event.target.value as VisualResource['layout'] })} className="mt-2 min-h-10 w-full rounded-lg border border-white/10 bg-[#151822] p-2 text-xs"><option value="corner">Pequeña · esquina superior</option><option value="wide">Grande · apoyo central</option></select>
      {ai && <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          {label(item.image) && <span className="rounded-full bg-[#FF7A00]/15 px-2 py-0.5 text-[#FFB066]" title={item.image.kind === 'upload' ? item.image.title : undefined}>{label(item.image)}</span>}
          <button type="button" disabled={locked || !stockReady} onClick={() => ai.onRegenerate(clip.segmentId, item.id, 'stock')}
            className="flex min-h-8 items-center gap-1 rounded-lg border border-[#FF7A00]/30 px-2 text-[#FFB066] disabled:opacity-35"><ImagePlus size={11} />Otra foto</button>
          {PROVIDER_IDS.filter(ready).map((provider) => <button key={provider} type="button" disabled={locked} onClick={() => ai.onRegenerate(clip.segmentId, item.id, provider)}
            className="flex min-h-8 items-center gap-1 rounded-lg border border-[#FF7A00]/30 px-2 text-[#FFB066] disabled:opacity-35"><WandSparkles size={11} />Con {AI_PROVIDERS[provider].label}</button>)}
        </div>
        {(ai.alternatives[item.id]?.length ?? 0) > 0 && <div><p className="text-[10px] text-zinc-500">Otras versiones · toca para usarla</p><div className="mt-1 flex gap-1.5">{ai.alternatives[item.id].map((image, index) => <button key={index} type="button" disabled={locked} onClick={() => ai.onChooseAlternative(clip.segmentId, item.id, image)} className="relative overflow-hidden rounded-lg border border-white/10 disabled:opacity-40" aria-label={`Usar la versión ${index + 1}${label(image) ? ` de ${label(image)}` : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resourceImageSrc(image)} alt="" className="h-12 w-12 object-cover" />{label(image) && <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[8px] text-white">{label(image)}</span>}</button>)}</div></div>}
      </div>}
      <div className="mt-2 flex gap-2"><button type="button" disabled={locked} onClick={() => openUpload(clip.segmentId, item.id)} className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-white/10 text-[10px]"><Upload size={12} />Cambiar foto</button><button type="button" aria-label={`Quitar imagen ${item.keyword}`} disabled={locked} onClick={() => onChange(clip.segmentId, clip.visualResources.filter((entry) => entry.id !== item.id))} className="grid min-h-9 w-9 place-items-center rounded-lg border border-white/10 text-zinc-400"><Trash2 size={13} /></button></div>
    </article>)}</div>}
    <div className="border-t border-white/10 pt-4"><strong className="text-xs">Biblioteca visual</strong><p className="mt-1 text-[10px] leading-4 text-zinc-500">Catálogo inicial creado para Studio. Puedes usar tus propias fotos para otros temas.</p><div className="mt-3 grid grid-cols-3 gap-2">{VISUAL_RESOURCE_CATALOG.map((asset) => <button type="button" key={asset.id} aria-label={`Añadir imagen ${asset.title}`} disabled={locked || !selectedClip} onClick={() => { if (selectedClip) onAdd(selectedClip.segmentId, { kind: 'builtin', assetId: asset.id }); }} className="overflow-hidden rounded-lg border border-white/10 bg-white/5 text-left disabled:opacity-40">{/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset.src} alt="" className="aspect-square w-full object-cover" /><span className="block px-2 py-2 text-[10px]">{asset.title}</span></button>)}</div>
    <button type="button" disabled={locked || !selectedClip} onClick={() => { if (selectedClip) openUpload(selectedClip.segmentId); }} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-violet-300/30 text-xs text-violet-200">{uploading ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}{uploading ? 'Preparando imagen…' : 'Subir mi propia imagen'}</button><p className="mt-2 text-[10px] leading-4 text-zinc-500">Se añade a la toma seleccionada, en la posición del reproductor. Hasta 2 imágenes por toma; ajusta sus tiempos arriba.</p></div>
    {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
  </section>;
}
