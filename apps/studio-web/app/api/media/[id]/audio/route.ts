import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { createClient } from "../../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../../lib/request-user";
import { extractSpeechWindow, shouldRepairSourceDuration, speechAudioWindow, SpeechAudioError } from "../../../../../lib/speech-audio";
import { repairMeasuredTakeDuration } from "../../../../../lib/media-duration-repair";

export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Toma inválida." }, { status: 400 });
  const supabase = await createClient();
  const take = await supabase.from("kiko_takes").select("object_key,duration_ms,session_id")
    .eq("id", id).eq("owner_id", user.userId).eq("status", "approved").maybeSingle();
  if (take.error) return Response.json({ error: "No pudimos consultar la toma." }, { status: 500 });
  if (!take.data) return Response.json({ error: "No encontramos una toma aprobada." }, { status: 404 });
  let window;
  try { window = speechAudioWindow(new URL(request.url).searchParams, take.data.duration_ms); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Intervalo inválido.", code: "invalid_audio_window" }, { status: 400 }); }
  if (!ffmpegPath) return Response.json({ error: "El extractor de audio no está disponible.", code: "audio_extractor_unavailable" }, { status: 503 });
  const signed = await supabase.storage.from("kiko-videos").createSignedUrl(take.data.object_key, 120);
  if (signed.error || !signed.data?.signedUrl) return Response.json({ error: "No pudimos abrir el archivo de la toma." }, { status: 500 });
  const directory = await mkdtemp(join(tmpdir(), "segmenta-speech-"));
  try {
    const wav = join(directory, "voice.wav");
    const audio = await extractSpeechWindow(ffmpegPath, signed.data.signedUrl, wav, window);
    let reviewPreserved: boolean | undefined;
    if (shouldRepairSourceDuration(take.data.duration_ms, audio.sourceDurationSeconds)) {
      const repaired = await repairMeasuredTakeDuration(supabase, user.userId, take.data.session_id, id, audio.sourceDurationSeconds!);
      reviewPreserved = repaired.reviewPreserved;
    }
    return new Response(audio.bytes, {
      headers: { "Content-Type": "audio/wav", "Content-Length": String(audio.bytes.byteLength), "Cache-Control": "private, no-store",
        "X-Audio-Start-Seconds": String(window.startSeconds), "X-Audio-End-Seconds": String(window.startSeconds + audio.durationSeconds),
        "X-Audio-Duration-Seconds": String(audio.durationSeconds),
        ...(audio.sourceDurationSeconds ? { "X-Source-Duration-Seconds": String(audio.sourceDurationSeconds) } : {}),
        ...(reviewPreserved !== undefined ? { "X-Media-Review-Preserved": reviewPreserved ? "1" : "0" } : {}),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof SpeechAudioError ? error.message : "No pudimos preparar el audio.", code: error instanceof SpeechAudioError ? error.code : "audio_extraction_failed" }, { status: error instanceof SpeechAudioError ? error.status : 422 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Resolve unknown upload duration with the same bounded, owner-authorized extraction. */
export async function HEAD(request: Request, context: { params: Promise<{ id: string }> }) {
  const response = await GET(request, context);
  return new Response(null, { status: response.status, headers: response.headers });
}
