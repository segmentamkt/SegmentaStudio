'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, Scissors, Trash2, X } from 'lucide-react';
import { saveVideoToDevice, videoDeviceFile } from '../lib/save-video-device';
import { LARGE_DEVICE_COPY_MESSAGE, MAX_DEVICE_COPY_BYTES, readTakeDeviceCopy } from '../lib/take-device-copy';

type GalleryTake = { id: string; status: string; durationMs?: number | null; mimeType?: string | null; bytes?: number | null };
const statusLabels: Record<string, string> = { approved: 'Aprobada', pending: 'Por revisar', blooper: 'Blooper', rejected: 'Descartada' };

export function TakeGalleryCard({ take, title, onSegment, onDelete }: {
  take: GalleryTake; title: string; onSegment: () => void; onDelete: () => void;
}) {
  const [prepared, setPrepared] = useState<{ takeId: string; file: File } | null>(null);
  const [preparingId, setPreparingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ takeId: string; text: string } | null>(null);
  const [videoErrorId, setVideoErrorId] = useState('');
  const mountedRef = useRef(true);
  const activeTakeIdRef = useRef(take.id);
  const requestRef = useRef<AbortController | null>(null);
  const shareRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    activeTakeIdRef.current = take.id;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [take.id]);
  const preparing = preparingId === take.id;
  const readyFile = prepared?.takeId === take.id ? prepared.file : null;
  const duration = typeof take.durationMs === 'number' && Number.isFinite(take.durationMs) && take.durationMs > 0 ? Math.round(take.durationMs / 1000) : null;
  const size = typeof take.bytes === 'number' && Number.isFinite(take.bytes) && take.bytes > 0 ? take.bytes : null;
  const mediaUrl = `/api/media/${encodeURIComponent(take.id)}`;

  const prepareCopy = async () => {
    if (requestRef.current || shareRef.current) return;
    if (size && size > MAX_DEVICE_COPY_BYTES) { setNotice({ takeId: take.id, text: LARGE_DEVICE_COPY_MESSAGE }); return; }
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrent = () => mountedRef.current && requestRef.current === controller && !controller.signal.aborted;
    setPreparingId(take.id); setNotice(null);
    try {
      const response = await fetch(mediaUrl, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
      const blob = await readTakeDeviceCopy(response, controller.signal, take.mimeType || '');
      if (!isCurrent()) return;
      setPrepared({ takeId: take.id, file: videoDeviceFile(blob, title || `Toma-${take.id}`) });
      setNotice({ takeId: take.id, text: 'Copia preparada. Pulsa Guardar en dispositivo y elige el destino disponible.' });
    } catch (reason) {
      if (isCurrent()) setNotice({ takeId: take.id, text: reason instanceof Error ? reason.message : 'No pudimos preparar el video. Inténtalo otra vez.' });
    } finally {
      if (isCurrent()) { requestRef.current = null; setPreparingId(''); }
    }
  };

  const cancelPreparation = () => {
    requestRef.current?.abort(); requestRef.current = null; setPreparingId('');
    setNotice({ takeId: take.id, text: 'Preparación cancelada. Tu toma sigue guardada en Studio.' });
  };

  const saveCopy = async () => {
    if (!readyFile || shareRef.current) return;
    shareRef.current = true; setSaving(true);
    try {
      // This call must remain before any await/fetch to retain the click's activation on iOS.
      const result = await saveVideoToDevice(readyFile, readyFile.name);
      if (!mountedRef.current || activeTakeIdRef.current !== take.id) return;
      setNotice({ takeId: take.id, text: result.mode === 'shared'
        ? 'Acción enviada al menú del dispositivo. Studio no puede confirmar que se haya guardado en Fotos o Galería.'
        : result.mode === 'download' ? 'Descarga solicitada. Revisa Descargas o Archivos; no se confirmó un guardado en la galería.'
          : 'Se cerró el menú sin confirmar una copia. Puedes volver a intentarlo.' });
      if (result.mode !== 'cancelled') setPrepared(null);
    } catch (reason) {
      if (mountedRef.current && activeTakeIdRef.current === take.id) setNotice({ takeId: take.id, text: reason instanceof Error ? reason.message : 'No pudimos abrir las opciones de guardado.' });
    } finally {
      shareRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return <article className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
    <div data-theme="dark" className="aspect-[9/12] bg-black">
      <video controls playsInline src={mediaUrl} preload="metadata" aria-label={title || 'Toma grabada'} className="h-full w-full object-contain" onError={() => setVideoErrorId(take.id)} onLoadedMetadata={() => setVideoErrorId('')} />
    </div>
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="truncate text-xs font-medium text-white" title={title}>{title || 'Toma grabada'}</p><p className="mt-1 text-[10px] text-zinc-500">{duration !== null ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : ''}{duration !== null && size !== null ? ' · ' : ''}{size !== null ? `${(size / (1024 * 1024)).toFixed(1)} MB` : ''}</p></div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${take.status === 'approved' ? 'bg-emerald-300/10 text-emerald-300' : take.status === 'blooper' ? 'bg-amber-300/10 text-amber-200' : 'bg-white/5 text-zinc-300'}`}>{statusLabels[take.status] || 'Por revisar'}</span>
      </div>
      {videoErrorId === take.id && <p className="text-xs text-amber-200">No pudimos reproducir esta toma. Puedes intentar preparar una copia.</p>}
      <button type="button" onClick={onSegment} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white"><Scissors size={15} />Recortar y dividir</button>
      <div className="flex gap-2">
        <button type="button" disabled={preparing || saving} onClick={() => void (readyFile ? saveCopy() : prepareCopy())} className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 px-2 py-2 text-xs text-zinc-200 disabled:opacity-50">
          {preparing || saving ? <LoaderCircle size={15} className="shrink-0 animate-spin" /> : <Download size={15} className="shrink-0" />}{preparing ? 'Preparando…' : saving ? 'Abriendo opciones…' : readyFile ? 'Guardar en dispositivo' : 'Preparar copia'}
        </button>
        <button type="button" onClick={onDelete} disabled={saving} aria-label={`Eliminar ${title || 'toma'}`} className="grid min-h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-400 hover:text-red-300 disabled:opacity-40"><Trash2 size={16} /></button>
      </div>
      {preparing && <button type="button" onClick={cancelPreparation} className="flex min-h-11 w-full items-center justify-center gap-2 text-xs text-zinc-400"><X size={14} />Cancelar preparación</button>}
      {notice?.takeId === take.id && <p role="status" className="text-[11px] leading-5 text-cyan-100">{notice.text}</p>}
    </div>
  </article>;
}
