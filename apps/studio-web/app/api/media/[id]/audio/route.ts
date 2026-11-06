import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { createClient } from "../../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../../lib/request-user";

export const maxDuration = 60;

const MAX_DURATION_MS = 120_000;
const MAX_WAV_BYTES = 4_500_000;

async function extractSpeech(sourceUrl: string, target: string, durationSeconds: number) {
  if (!ffmpegPath) throw new Error("El extractor de audio no está disponible.");
  const args = [
    "-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-threads", "1",
    "-i", sourceUrl, "-map", "0:a:0", "-vn", "-t", String(Math.min(120, durationSeconds + 1)),
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", target,
  ];
  const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let diagnostic = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (part: string) => { diagnostic = (diagnostic + part).slice(-2_000); });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 45_000);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (value) => resolve(value ?? -1));
    });
    if (timedOut) throw new Error("La extracción de voz tardó demasiado.");
    if (code !== 0) {
      const noAudio = /matches no streams|Stream map '0:a:0' matches no streams/i.test(diagnostic);
      throw new Error(noAudio ? "Esta toma no contiene una pista de voz." : "No pudimos leer la voz de esta toma.");
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Toma inválida." }, { status: 400 });
  const supabase = await createClient();
  const take = await supabase.from("kiko_takes").select("object_key,duration_ms")
    .eq("id", id).eq("owner_id", user.userId).eq("status", "approved").maybeSingle();
  if (take.error) return Response.json({ error: "No pudimos consultar la toma." }, { status: 500 });
  if (!take.data) return Response.json({ error: "No encontramos una toma aprobada." }, { status: 404 });
  const durationMs = Number(take.data.duration_ms);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
    return Response.json({ error: "La transcripción local admite tomas de hasta 2 minutos." }, { status: 400 });
  }
  const signed = await supabase.storage.from("kiko-videos").createSignedUrl(take.data.object_key, 120);
  if (signed.error) return Response.json({ error: "No pudimos abrir el archivo de la toma." }, { status: 500 });
  const directory = await mkdtemp(join(tmpdir(), "segmenta-speech-"));
  try {
    const wav = join(directory, "voice.wav");
    await extractSpeech(signed.data.signedUrl, wav, durationMs / 1000);
    const size = (await stat(wav)).size;
    if (size < 44 || size > MAX_WAV_BYTES) throw new Error("El audio de esta toma no se pudo preparar.");
    return new Response(new Uint8Array(await readFile(wav)), {
      headers: { "Content-Type": "audio/wav", "Content-Length": String(size), "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No pudimos preparar el audio." }, { status: 422 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
