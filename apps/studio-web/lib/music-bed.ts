/**
 * Pista de música: una canción del usuario va debajo de la voz en todo el video.
 * Se mezcla en una pasada final sobre el MP4 ya montado (el video se copia tal cual),
 * así la mezcla no cambia los cortes, los subtítulos ni la sincronía de la voz.
 */

/** Lo que el editor guarda de la pista de música. `object_key` vive en la carpeta de la producción. */
export type MusicTrack = {
  object_key: string;
  name: string;
  /** Ganancia lineal de la canción antes de la mezcla (0 = muda, 1 = tal cual). */
  volume: number;
  /** Baja la canción automáticamente mientras alguien habla. */
  ducking: boolean;
  /** Desvanecimiento al final del video, en segundos (0 = corte seco). */
  fade_out_seconds: number;
  /** Segundo de la canción donde empieza a sonar. */
  start_seconds: number;
};

export const MUSIC_DEFAULTS = { volume: .2, ducking: true, fade_out_seconds: 2, start_seconds: 0 } as const;
export const MUSIC_MAX_VOLUME = 1;
export const MUSIC_MAX_FADE_SECONDS = 6;
export const MUSIC_MAX_START_SECONDS = 600;
export const MUSIC_MAX_BYTES = 30 * 1024 * 1024;
/** Formatos que acepta la carpeta privada (bucket) y que FFmpeg lee sin conversiones previas. */
export const MUSIC_MIME_TYPES = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav"] as const;
const MIME_ALIASES: Record<string, string> = {
  "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4",
  "audio/aac": "audio/aac", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav",
};
const MUSIC_EXTENSIONS: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav" };

/** Tipo con el que se sube la canción: el que informa el navegador o, si falta, el de la extensión. */
export function musicMimeType(fileName: string, reportedType: string): string | null {
  const known = MIME_ALIASES[reportedType.toLowerCase()];
  if (known) return known;
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return MUSIC_EXTENSIONS[extension] ?? null;
}

/** Carpeta privada de música de una producción (las reglas del bucket exigen el dueño como primera carpeta). */
export function musicFolder(ownerId: string, sessionId: string) {
  return `${ownerId}/${sessionId}/music/`;
}

export function musicObjectKey(ownerId: string, sessionId: string, id: string, mimeType: string) {
  const extension = mimeType === "audio/mpeg" ? "mp3" : mimeType === "audio/wav" ? "wav" : mimeType === "audio/aac" ? "aac" : "m4a";
  return `${musicFolder(ownerId, sessionId)}${id}.${extension}`;
}

type Row = Record<string, unknown>;

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number, label: string) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} debe estar entre ${minimum} y ${maximum}.`);
  }
  return value;
}

/**
 * Valida la pista que manda el navegador. Solo se acepta una ruta dentro de la carpeta de música
 * de esta producción; el nombre visible se limpia y se recorta.
 */
export function normalizeMusicTrack(value: unknown, ownerId: string, sessionId: string): MusicTrack | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("La música no tiene un formato válido.");
  const raw = value as Row;
  const objectKey = typeof raw.object_key === "string" ? raw.object_key : "";
  const folder = musicFolder(ownerId, sessionId);
  if (!objectKey.startsWith(folder) || !/^[A-Za-z0-9-]{8,80}\.(mp3|m4a|aac|wav)$/.test(objectKey.slice(folder.length))) {
    throw new Error("La canción no pertenece a esta producción.");
  }
  const name = typeof raw.name === "string" ? raw.name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 120) : "";
  if (typeof raw.ducking !== "undefined" && typeof raw.ducking !== "boolean") throw new Error("La opción de bajar la música no es válida.");
  return {
    object_key: objectKey,
    name: name || "Canción",
    volume: boundedNumber(raw.volume, MUSIC_DEFAULTS.volume, 0, MUSIC_MAX_VOLUME, "El volumen de la música"),
    ducking: typeof raw.ducking === "boolean" ? raw.ducking : MUSIC_DEFAULTS.ducking,
    fade_out_seconds: boundedNumber(raw.fade_out_seconds, MUSIC_DEFAULTS.fade_out_seconds, 0, MUSIC_MAX_FADE_SECONDS, "El desvanecimiento de la música"),
    start_seconds: boundedNumber(raw.start_seconds, MUSIC_DEFAULTS.start_seconds, 0, MUSIC_MAX_START_SECONDS, "El inicio de la canción"),
  };
}

const fixed = (value: number) => Math.max(0, value).toFixed(3);

/** Grafo de mezcla: canción recortada, con entrada suave, salida desvanecida y (opcional) bajada bajo la voz. */
export function buildMusicMixGraph(music: Pick<MusicTrack, "volume" | "ducking" | "fade_out_seconds">, videoSeconds: number) {
  const duration = Math.max(.2, videoSeconds);
  const fade = Math.min(music.fade_out_seconds, duration / 2);
  const musicChain = [
    `atrim=0:${fixed(duration)}`, "asetpts=PTS-STARTPTS", "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=stereo", `volume=${music.volume.toFixed(3)}`,
    "afade=t=in:st=0:d=0.400",
    ...(fade > 0 ? [`afade=t=out:st=${fixed(duration - fade)}:d=${fixed(fade)}`] : []),
  ].join(",");
  const voice = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  // Ventana de mezcla: la voz manda la duración; picos por debajo de −1 dBFS como el resto del render.
  const mix = "amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.891:level=false";
  return music.ducking
    ? [
      `[1:a]${musicChain}[music]`,
      `[0:a]${voice},asplit=2[voice][key]`,
      // La voz (a −14 LUFS) empuja la canción unos 10 dB hacia abajo mientras alguien habla.
      "[music][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350:makeup=1[ducked]",
      `[voice][ducked]${mix}[mix]`,
    ].join(";")
    : [`[1:a]${musicChain}[music]`, `[0:a]${voice}[voice]`, `[voice][music]${mix}[mix]`].join(";");
}

/** Argumentos de FFmpeg para la pasada final: copia el video y vuelve a codificar solo el audio. */
export function buildMusicMixArgs(input: { video: string; musicUrl: string; output: string; videoSeconds: number; music: MusicTrack }) {
  return [
    "-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-threads", "1",
    "-i", input.video,
    ...(input.music.start_seconds > 0 ? ["-ss", fixed(input.music.start_seconds)] : []),
    "-i", input.musicUrl,
    "-filter_complex", buildMusicMixGraph(input.music, input.videoSeconds),
    "-map", "0:v:0", "-map", "[mix]", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart", input.output,
  ];
}
