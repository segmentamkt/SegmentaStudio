"use client";

import { Upload } from "tus-js-client";
import { createClient as createSupabaseClient } from "./supabase/browser";
import { MUSIC_DEFAULTS, MUSIC_MAX_BYTES, musicMimeType, musicObjectKey, type MusicTrack } from "./music-bed";

/** Sube una canción propia a la carpeta privada de la producción (subida reanudable, como las tomas). */
export async function uploadMusicTrack(file: File, sessionId: string, onProgress: (percent: number) => void): Promise<MusicTrack> {
  const mimeType = musicMimeType(file.name, file.type);
  if (!mimeType) throw new Error("Elige una canción MP3, M4A, AAC o WAV.");
  if (file.size > MUSIC_MAX_BYTES) throw new Error("La canción supera 30 MB. Usa un MP3 o M4A más liviano.");
  const supabase = createSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Tu sesión venció. Vuelve a iniciar sesión.");
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const projectId = new URL(projectUrl).hostname.split(".")[0];
  const objectKey = musicObjectKey(session.user.id, sessionId, crypto.randomUUID(), mimeType);
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${session.access_token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: "kiko-videos", objectName: objectKey, contentType: mimeType, cacheControl: "3600" },
      onError: (reason) => reject(/mime|content type|415|not supported/i.test(String(reason))
        ? new Error("Studio todavía no acepta archivos de audio en tu almacenamiento. Falta activar la música en la base de datos.")
        : reason),
      onProgress: (uploaded, total) => onProgress(Math.max(1, Math.round((uploaded / total) * 100))),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
  const name = file.name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 120) || "Canción";
  return { object_key: objectKey, name, ...MUSIC_DEFAULTS };
}

/** Enlace temporal para escuchar la canción en el editor (las reglas del bucket solo dejan leer al dueño). */
export async function signedMusicUrl(objectKey: string): Promise<string | null> {
  const supabase = createSupabaseClient();
  const signed = await supabase.storage.from("kiko-videos").createSignedUrl(objectKey, 3600);
  return signed.data?.signedUrl ?? null;
}
