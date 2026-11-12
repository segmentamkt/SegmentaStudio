"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Music2, Play, Square, Trash2, UploadCloud } from "lucide-react";
import { MUSIC_MAX_FADE_SECONDS, MUSIC_MAX_START_SECONDS, type MusicTrack } from "../lib/music-bed";
import { uploadMusicTrack, useSignedMusicUrl } from "../lib/music-upload";

type Props = {
  sessionId: string;
  music: MusicTrack | null;
  busy: boolean;
  onChange: (music: MusicTrack | null) => void;
};

/** Canción propia bajo la voz: subir, escuchar y ajustar volumen, bajada automática y final. */
export function MusicPanel({ sessionId, music, busy, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const url = useSignedMusicUrl(music?.object_key ?? "");

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(1, music?.volume ?? 1);
  }, [music?.volume, url]);

  const pick = async (file: File | undefined) => {
    if (!file || !sessionId) return;
    setError(""); setProgress(0);
    try {
      const uploaded = await uploadMusicTrack(file, sessionId, setProgress);
      onChange(music ? { ...uploaded, volume: music.volume, ducking: music.ducking, fade_out_seconds: music.fade_out_seconds } : uploaded);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo subir la canción.");
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const listen = () => {
    const audio = audioRef.current;
    if (!audio || !music) return;
    if (!audio.paused) { audio.pause(); return; }
    audio.currentTime = music.start_seconds;
    void audio.play().catch(() => setError("El navegador no pudo reproducir la canción."));
  };

  const update = (patch: Partial<MusicTrack>) => { if (music) onChange({ ...music, ...patch }); };
  const uploading = progress !== null;

  return (
    <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[.04] p-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-emerald-100"><Music2 size={14} />Música</p>
      <input ref={inputRef} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,.mp3,.m4a,.aac,.wav" className="hidden" onChange={(event) => void pick(event.target.files?.[0])} />
      {!music ? (
        <>
          <p className="mt-1 text-[10px] leading-4 text-zinc-400">Sube una canción tuya o con licencia para redes. Suena debajo de la voz en todo el video.</p>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || uploading || !sessionId} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">
            {uploading ? <><LoaderCircle size={14} className="animate-spin" />Subiendo {progress} %</> : <><UploadCloud size={14} />Elegir canción (MP3, M4A, WAV)</>}
          </button>
        </>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={listen} disabled={!url} aria-label={playing ? "Detener la canción" : "Escuchar la canción"} className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-300 text-black disabled:opacity-40">
              {playing ? <Square size={12} /> : <Play size={13} />}
            </button>
            <p className="min-w-0 flex-1 truncate text-xs text-zinc-200" title={music.name}>{music.name}</p>
            <button type="button" onClick={() => { audioRef.current?.pause(); onChange(null); }} disabled={busy} aria-label="Quitar la música" className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-400 hover:text-red-300 disabled:opacity-40"><Trash2 size={13} /></button>
          </div>
          {url && <audio ref={audioRef} src={url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
          <label className="block text-[10px] text-zinc-400">Volumen de la música · {Math.round(music.volume * 100)} %
            <input type="range" min={0} max={100} step={5} value={Math.round(music.volume * 100)} disabled={busy} onChange={(event) => update({ volume: Number(event.target.value) / 100 })} className="mt-1 w-full accent-emerald-300" />
          </label>
          <label className="flex items-start gap-2 text-[10px] text-zinc-300">
            <input type="checkbox" checked={music.ducking} disabled={busy} onChange={() => update({ ducking: !music.ducking })} className="mt-0.5 accent-emerald-300" />
            <span>Bajar la música cuando hablas<small className="block text-[9px] text-zinc-500">Vuelve sola en los silencios.</small></span>
          </label>
          <label className="block text-[10px] text-zinc-400">Desvanecer al final · {music.fade_out_seconds.toFixed(1)} s
            <input type="range" min={0} max={MUSIC_MAX_FADE_SECONDS} step={0.5} value={music.fade_out_seconds} disabled={busy} onChange={(event) => update({ fade_out_seconds: Number(event.target.value) })} className="mt-1 w-full accent-emerald-300" />
          </label>
          <label className="block text-[10px] text-zinc-400">Empezar la canción en el segundo
            <input type="number" min={0} max={MUSIC_MAX_START_SECONDS} step={1} value={music.start_seconds} disabled={busy} onChange={(event) => update({ start_seconds: Math.max(0, Math.min(MUSIC_MAX_START_SECONDS, Number(event.target.value) || 0)) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white" />
          </label>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || uploading} className="w-full rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300 disabled:opacity-40">
            {uploading ? `Subiendo ${progress} %` : "Cambiar canción"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[10px] leading-4 text-red-300">{error}</p>}
      <p className="mt-2 text-[9px] leading-4 text-zinc-600">Se mezcla al exportar el MP4. Usa solo música que tengas derecho a publicar.</p>
    </div>
  );
}
