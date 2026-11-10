/**
 * Prepara tomas locales para el banco de pruebas de la sala (/sala-demo, solo en desarrollo).
 *   npx tsx scripts/skills/sala-demo-data.ts "Título|video.mp4|palabras.json" ["Título 2|video2.mov|palabras2.json"]
 * Escribe en public/_dev/sala (ignorado por Git): video H.264, audio WAV 16 kHz y data.json.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { timedCaptionCards, type SpeechWord } from "../../lib/transcription-core";

const out = join(process.cwd(), "public", "_dev", "sala");
const run = (args: string[]) => { const result = spawnSync(ffmpegPath!, args, { encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr.slice(-800)); return result.stderr; };

async function main() {
  await mkdir(out, { recursive: true });
  const clips = [];
  for (const [index, spec] of process.argv.slice(2).entries()) {
    const [title, video, wordsFile] = spec.split("|");
    const probe = spawnSync(ffmpegPath!, ["-hide_banner", "-i", resolve(video)], { encoding: "utf8" }).stderr;
    const match = probe.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)!;
    const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    run(["-y", "-hide_banner", "-loglevel", "error", "-i", resolve(video), "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", join(out, `toma-${index}.mp4`)]);
    run(["-y", "-hide_banner", "-loglevel", "error", "-i", resolve(video), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", join(out, `toma-${index}.wav`)]);
    const words = JSON.parse(await readFile(resolve(wordsFile), "utf8")) as SpeechWord[];
    clips.push({ id: `toma-${index}`, title, videoUrl: `/_dev/sala/toma-${index}.mp4`, audioUrl: `/_dev/sala/toma-${index}.wav`, window: { start: 0, end: duration }, cues: timedCaptionCards(words, duration, 4) });
  }
  await writeFile(join(out, "data.json"), JSON.stringify({ projectName: "Prueba local · sala de edición", clips }, null, 2));
  console.log(`Listo: ${clips.length} tomas en ${out}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
