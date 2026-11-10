/**
 * Prueba aislada de la skill «Subtítulos cinéticos» sobre un video local.
 *
 *   npx tsx scripts/skills/subtitulos-cineticos-preview.ts <video> <carpeta-salida> [--palabras palabras.json] [--sin-silencios]
 *
 * 1. Reconoce la voz con el mismo modelo y opciones que Studio usa en el navegador
 *    (whisper-base con tiempos por palabra), o lee palabras ya guardadas.
 * 2. Arma los subtítulos igual que la app (timedCaptionCards) y los pasa por el
 *    MISMO motor de render de producción (renderSequentialClip) con el estilo
 *    «Segmenta cinético».
 * 3. Guarda el MP4, el plan de palabras y una hoja de contacto para revisar.
 *
 * No sube nada ni usa claves: todo ocurre en este equipo.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { getEditorStyle } from "../../lib/editor-presets";
import { analyzeSequentialClip, renderSequentialClip } from "../../lib/sequential-cloud-video-renderer";
import { mapCaptionCues } from "../../lib/caption-cues";
import { timedCaptionCards, type SpeechWord } from "../../lib/transcription-core";
import { planKineticCaptions, summarizeKineticPlan } from "../../lib/skills/subtitulos-cineticos";

const MODEL = "onnx-community/whisper-base_timestamped";
const REVISION = "608c49e61301901684bc36cac8f74b95ff6b5a8e";

function run(args: string[], encoding: "buffer" | "utf8" = "utf8") {
  const result = spawnSync(ffmpegPath!, args, { encoding: encoding === "utf8" ? "utf8" : undefined, maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr).slice(-1500));
  return result;
}

function durationOf(video: string) {
  const probe = spawnSync(ffmpegPath!, ["-hide_banner", "-i", video], { encoding: "utf8" });
  const match = probe.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error("No se pudo medir la duración del video.");
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function recognize(video: string): Promise<SpeechWord[]> {
  const pcm = run(["-hide_banner", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], "buffer").stdout as unknown as Buffer;
  const waveform = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const { pipeline } = await import("@huggingface/transformers");
  const transcriber = await pipeline("automatic-speech-recognition", MODEL, { dtype: "q8", revision: REVISION });
  const output = await transcriber(waveform, { language: "spanish", task: "transcribe", return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, do_sample: false }) as { chunks?: Array<{ text: string; timestamp: [number | null, number | null] }> };
  return (output.chunks ?? []).flatMap((chunk) => chunk.timestamp[0] === null ? [] : [{
    text: chunk.text.trim(),
    startInSeconds: Number(chunk.timestamp[0]),
    endInSeconds: Number(chunk.timestamp[1] ?? chunk.timestamp[0]),
  }]).filter((word) => word.text);
}

async function main() {
  const [videoArg, outArg, ...rest] = process.argv.slice(2);
  if (!videoArg || !outArg) throw new Error("Uso: subtitulos-cineticos-preview.ts <video> <carpeta-salida> [--palabras archivo.json] [--sin-silencios]");
  if (!ffmpegPath) throw new Error("ffmpeg-static no está disponible.");
  const video = resolve(videoArg);
  const out = resolve(outArg);
  await mkdir(out, { recursive: true });
  const wordsFile = rest.includes("--palabras") ? rest[rest.indexOf("--palabras") + 1] : undefined;
  const removeSilence = !rest.includes("--sin-silencios");
  const duration = durationOf(video);
  const started = Date.now();
  const words = wordsFile ? JSON.parse(await readFile(wordsFile, "utf8")) as SpeechWord[] : await recognize(video);
  if (!wordsFile) await writeFile(join(out, "palabras.json"), JSON.stringify(words, null, 2));
  console.log(`Palabras reconocidas: ${words.length} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  const cues = timedCaptionCards(words, duration, 4);
  const style = getEditorStyle("segmenta-cinetico");
  const contract = {
    objective: "Prueba de subtítulos cinéticos",
    session: { title: "" },
    clips: [{ id: "local", name: "Toma local", object_key: "local", duration_seconds: duration, transcript: cues.map((cue) => cue.text).join(" "), caption_cues: cues }],
    style_snapshot: { ...style, subtitle: { ...style.subtitle }, execution: { ...style.execution } },
    captions: { enabled: true, max_words_per_card: 4 },
    dead_air: { remove: removeSilence, threshold_ms: style.execution.silenceThresholdMs, noise_db: -30 },
    effects: { transitions: false, sound_effects: false, labels: false, images_or_broll: false },
  };
  const deadline = Date.now() + 600_000;
  const analysis = await analyzeSequentialClip(ffmpegPath, video, duration, removeSilence, style.execution.silenceThresholdMs, -30, { start: 0, end: duration }, deadline);
  const plan = planKineticCaptions(mapCaptionCues(cues, analysis.ranges), { durationSeconds: analysis.ranges.reduce((sum, range) => sum + range.end - range.start, 0) });
  await writeFile(join(out, "plan.json"), JSON.stringify({ resumen: summarizeKineticPlan(plan), palabras: plan }, null, 2));
  const output = join(out, "subtitulos-cineticos.mp4");
  const renderStarted = Date.now();
  const rendered = await renderSequentialClip({ command: ffmpegPath, contract: contract as never, analysis, url: video, index: 0, output, videoKbps: 8000, transitionSeconds: 0, deadline });
  const renderSeconds = (Date.now() - renderStarted) / 1000;
  console.log(`Render: ${rendered.duration.toFixed(2)} s de video en ${renderSeconds.toFixed(1)} s · ${rendered.captionCount} palabras · ${rendered.estimatedCaptionWords} estimadas · silencio retirado ${analysis.removed.toFixed(2)} s`);
  console.log("Resumen del plan:", summarizeKineticPlan(plan));
  // Hoja de contacto: un cuadro en mitad de 12 palabras repartidas.
  const picks = plan.filter((_, index) => index % Math.max(1, Math.floor(plan.length / 12)) === 0).slice(0, 12);
  const select = picks.map((word) => `between(t,${((word.startSeconds + word.endSeconds) / 2).toFixed(3)},${((word.startSeconds + word.endSeconds) / 2 + .034).toFixed(3)})`).join("+");
  run(["-y", "-hide_banner", "-loglevel", "error", "-i", output, "-vf", `select='${select}',scale=270:480,tile=6x2`, "-frames:v", "1", join(out, "hoja-contacto.jpg")]);
  console.log(`Listo: ${output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
