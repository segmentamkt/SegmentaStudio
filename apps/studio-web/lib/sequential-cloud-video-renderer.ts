import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import { MAX_RENDER_BYTES, uploadRenderedMp4 } from "./cloud-render-upload";
import { capture } from "./cloud-video-renderer";
import { buildSoundDesignGraph, planCutSoundCues } from "./sound-design";
import { renderTextOverlay } from "./video-text-overlay";
import { renderVisualResourceImage } from "./visual-resource-image";
import { VISUAL_RESOURCE_LAYOUTS, type VisualResource } from "./visual-resources";
import { mapCaptionCues, type CaptionCue } from "./caption-cues";
import { MAX_RENDER_PREVIEW_BYTES, type RenderPreview } from "./render-preview";
import { buildKineticLayer, kineticInputArgs, kineticOverlayFilter, planKineticCaptions, type KineticLayer, type KineticZone } from "./skills/subtitulos-cineticos";

/** The kinetic skill places words under the chin by default; «Abajo/Arriba/Centro» keep their zones. */
function kineticZone(position: string | undefined, layeredStyle: boolean): KineticZone {
  if (layeredStyle) return "bottom";
  return position === "top" || position === "center" || position === "bottom" ? position : "chest";
}

type Range = { start: number; end: number };
type Clip = { id: string; name: string; object_key: string; duration_seconds: number; transcript: string; trim_start_seconds?: number; trim_end_seconds?: number; playback_speed?: number; audio_volume?: number; brightness?: number; contrast?: number; saturation?: number; label?: string; caption_cues?: CaptionCue[]; visual_resources?: VisualResource[] };
type EditContract = {
  objective: string;
  session: { title: string; script?: string };
  clips: Clip[];
  style_snapshot: {
    id?: string;
    transition: "cut" | "fade" | "dissolve";
    transitionDuration?: number;
    subtitle: { text: string; box: string; size: number; uppercase: boolean; position?: "top" | "center" | "chest" | "bottom"; mode?: "tarjeta" | "palabra" };
    execution?: {
      zoomPercent?: number; contrast?: number; saturation?: number; soundEffectVolume?: number; soundPreset?: "auto" | "none" | "soft" | "kinetic" | "cinematic" | "pop"; noiseReduction?: "off" | "light" | "medium";
      framing?: "fill" | "fit"; titleCards?: boolean; titleColor?: string;
    };
  };
  captions: { enabled: boolean; max_words_per_card: number };
  dead_air: { remove: boolean; threshold_ms: number; noise_db?: number };
  effects: { transitions: boolean; sound_effects: boolean; labels: boolean; images_or_broll?: boolean };
  quality_gates?: { effects?: boolean; timed_captions?: boolean; images?: boolean };
};
type Analysis = { duration: number; ranges: Range[]; removed: number; hasAudio: boolean };
type Progress = (progress: number, stage: string) => Promise<void>;
type RenderInput = {
  contract: EditContract;
  signedUrls: string[];
  outputObjectKey: string;
  accessToken: string;
  projectUrl: string;
  publishableKey: string;
  onProgress: Progress;
  onPreview?: (preview: RenderPreview) => void | Promise<void>;
};

const safeSeconds = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
const fixed = (value: number) => safeSeconds(value).toFixed(3);
const MAX_OUTPUT_SECONDS = 120;
// At the maximum 2x speed, 240s of selected source produces 120s of output.
const MAX_SELECTED_SOURCE_SECONDS = MAX_OUTPUT_SECONDS * 2;

/** Map only surviving source time; a removed pause never gets a substitute image. */
export function mapVisualResourceToOutput(resource: Pick<VisualResource, "startSeconds" | "endSeconds">, ranges: Range[], speed: number) {
  let offset = 0;
  let start: number | undefined;
  let end: number | undefined;
  for (const range of ranges) {
    const from = Math.max(range.start, resource.startSeconds);
    const to = Math.min(range.end, resource.endSeconds);
    if (to > from) {
      start ??= offset + from - range.start;
      end = offset + to - range.start;
    }
    offset += range.end - range.start;
  }
  return start !== undefined && end !== undefined ? { startSeconds: start / speed, endSeconds: end / speed } : null;
}

export async function analyzeSequentialClip(command: string, url: string, durationHint: number, remove: boolean, thresholdMs: number, noiseDb = -35, sourceWindow?: Range, deadline?: number): Promise<Analysis> {
  const threshold = Math.max(.35, thresholdMs / 1000);
  const window = sourceWindow ?? { start: 0, end: durationHint };
  const limit = window.end - window.start;
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start < 0 || limit < .2 || limit > MAX_SELECTED_SOURCE_SECONDS) {
    throw new Error("El intervalo de análisis no es válido. Conserva un montaje de hasta 2 minutos.");
  }
  const timeoutMs = Math.min(45_000, 15_000 + limit * 3_000, deadline === undefined ? Infinity : deadline - Date.now());
  if (timeoutMs <= 0) throw new Error("El proyecto excedió el tiempo seguro de exportación.");
  const events: Range[] = [];
  let pending: number | null = null;
  let tooManyEvents = false;
  const result = await capture(command, [
    "-hide_banner", "-nostdin", "-nostats", "-threads", "1", "-filter_threads", "1",
    "-ss", fixed(window.start), "-t", fixed(limit), "-i", url,
    "-map", "0:a:0?", "-vn", "-sn", "-dn",
    ...(remove ? ["-af", `silencedetect=noise=${[-35, -30, -25].includes(noiseDb) ? noiseDb : -30}dB:d=${threshold}`] : []),
    "-t", fixed(limit), "-f", "null", "-",
  ], {
    timeoutMs,
    onStderrLine: (line) => {
      const start = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
      if (start) pending = safeSeconds(Number(start[1]));
      const end = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
      if (end && pending !== null) {
        if (events.length >= 512) tooManyEvents = true;
        else events.push({ start: pending, end: Number(end[1]) });
        pending = null;
      }
    },
  });
  if (result.timedOut) throw new Error("La toma tardó demasiado en analizarse.");
  if (tooManyEvents) throw new Error("Demasiados cortes de silencio.");
  if (!/Stream #[^\n]*Video:/.test(result.stderr)) throw new Error("La toma no contiene video legible.");
  const hasAudio = /Stream #[^\n]*Audio:/.test(result.stderr);
  if (hasAudio && result.code !== 0) throw new Error(`El audio no pudo analizarse: ${result.stderr.slice(-400)}`);
  const mediaDuration = result.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const measured = mediaDuration ? Number(mediaDuration[1]) * 3600 + Number(mediaDuration[2]) * 60 + Number(mediaDuration[3]) : durationHint;
  if (!Number.isFinite(measured) || measured <= 0 || measured < window.end - .1) {
    throw new Error("El recorte solicitado supera el video disponible. Actualiza la duración de la toma.");
  }
  const duration = measured;
  const windowDuration = Math.min(window.end, duration) - window.start;
  if (windowDuration < .2) throw new Error("El recorte no contiene video suficiente.");
  if (!hasAudio || !remove) return { duration, ranges: [{ start: window.start, end: window.start + windowDuration }], removed: 0, hasAudio };
  if (pending !== null) events.push({ start: pending, end: windowDuration });
  const ranges: Range[] = [];
  let cursor = 0;
  let removed = 0;
  for (const event of events) {
    const start = Math.min(windowDuration, safeSeconds(event.start));
    const end = Math.min(windowDuration, safeSeconds(event.end));
    if (end - start < threshold) continue;
    const keepEnd = Math.min(windowDuration, start + .1);
    if (keepEnd - cursor > .16) ranges.push({ start: cursor, end: keepEnd });
    const next = Math.max(0, end - .1);
    removed += Math.max(0, next - keepEnd);
    cursor = next;
  }
  if (windowDuration - cursor > .16) ranges.push({ start: cursor, end: windowDuration });
  if (!ranges.length) ranges.push({ start: 0, end: windowDuration });
  // FFmpeg resets timestamps after input seeking. Restore source coordinates
  // once here so manual trims and timed captions share the same timeline.
  return { duration, ranges: ranges.map((range) => ({ start: range.start + window.start, end: range.end + window.start })), removed, hasAudio };
}

/** Keep source timestamps intact so FFmpeg can select the exact manual range. */
export function trimSequentialAnalysis(analysis: Analysis, clip: Clip): Analysis {
  const start = Math.max(0, Number(clip.trim_start_seconds ?? 0));
  const end = Math.min(analysis.duration, Number(clip.trim_end_seconds ?? analysis.duration));
  const ranges = analysis.ranges.map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) }))
    .filter((range) => range.end - range.start > .16);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < .2 || !ranges.length) {
    throw new Error(`El recorte de “${clip.name}” no contiene video suficiente.`);
  }
  const kept = ranges.reduce((total, range) => total + range.end - range.start, 0);
  return { ...analysis, ranges, removed: Math.max(0, end - start - kept) };
}

function cards(text: string, size: number, uppercase: boolean): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const output: string[] = [];
  for (let i = 0; i < words.length; i += Math.max(1, size)) {
    const card = words.slice(i, i + Math.max(1, size)).join(" ");
    output.push(uppercase ? card.toUpperCase() : card);
  }
  return output;
}

/** Every FFmpeg invocation has one source clip, bounded diagnostics and a deadline. */
async function ffmpegFile(command: string, args: string[], overlays: Buffer[], deadline: number): Promise<void> {
  const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe", ...overlays.map(() => "pipe" as const)] });
  const remaining = deadline - Date.now();
  if (remaining <= 0) { child.kill("SIGKILL"); throw new Error("El proyecto excedió el tiempo seguro de exportación."); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, remaining);
  overlays.forEach((bytes, index) => {
    const pipe = child.stdio[index + 3] as Writable;
    pipe.on("error", () => undefined);
    pipe.end(bytes);
  });
  let diagnostic = "";
  (child.stderr as Readable).setEncoding("utf8");
  (child.stderr as Readable).on("data", (part: string) => { diagnostic = (diagnostic + part).slice(-64 * 1024); });
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (value) => resolve(value ?? -1));
    });
    if (timedOut) throw new Error("La exportación excedió el tiempo seguro de esta versión cloud.");
    if (code !== 0) throw new Error(`FFmpeg detuvo la exportación: ${diagnostic.slice(-900)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Encode only an already-rendered scene. This sample contains the real baked-in edits. */
export async function createRenderPreview(input: {
  command: string; source: string; output: string; durationSeconds: number; deadline: number;
}): Promise<{ videoDataUrl: string; durationSeconds: number }> {
  const durationSeconds = Math.min(3, input.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("La escena no tiene duración para una muestra.");
  await ffmpegFile(input.command, [
    "-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-threads", "1", "-filter_threads", "1",
    "-i", input.source, "-map", "0:v:0", "-map", "0:a:0?", "-t", fixed(durationSeconds),
    "-vf", "scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2,fps=15",
    "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-crf", "30",
    "-maxrate", "256k", "-bufsize", "384k", "-pix_fmt", "yuv420p", "-g", "30",
    "-c:a", "aac", "-b:a", "48k", "-ac", "1", "-movflags", "+faststart", input.output,
  ], [], input.deadline);
  const details = await stat(input.output);
  if (details.size <= 0 || details.size > MAX_RENDER_PREVIEW_BYTES) throw new Error("La muestra excede el tamaño permitido.");
  const bytes = await readFile(input.output);
  return { videoDataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`, durationSeconds };
}

export async function renderSequentialClip(input: {
  command: string; contract: EditContract; analysis: Analysis; url: string; index: number;
  output: string; videoKbps: number; transitionSeconds: number; deadline: number;
}) {
  const { command, contract, analysis, url, index, output, videoKbps, transitionSeconds, deadline } = input;
  const execution = contract.style_snapshot.execution || {};
  const clip = contract.clips[index];
  const speed = Math.max(.5, Math.min(2, Number(clip.playback_speed ?? 1)));
  const volume = Math.max(0, Math.min(2, Number(clip.audio_volume ?? 1)));
  const sourceDuration = analysis.ranges.reduce((total, range) => total + range.end - range.start, 0);
  const duration = sourceDuration / speed;
  const sourceStart = analysis.ranges[0]?.start ?? NaN;
  const sourceEnd = analysis.ranges[analysis.ranges.length - 1]?.end ?? NaN;
  if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceStart < 0 || sourceEnd - sourceStart < .2 || sourceEnd - sourceStart > MAX_SELECTED_SOURCE_SECONDS || duration > MAX_OUTPUT_SECONDS) {
    throw new Error("El intervalo del render no es válido.");
  }
  const clipTransition = Math.min(transitionSeconds, duration / 3);
  const select = analysis.ranges.map((range) => `between(t,${fixed(range.start - sourceStart)},${fixed(range.end - sourceStart)})`).join("+");
  const fit = execution.framing === "fit";
  const zoom = Math.max(0, Math.min(10, Number(execution.zoomPercent || 0)));
  const brightness = Math.max(-.2, Math.min(.2, Number(clip.brightness ?? 0)));
  const contrast = Math.max(.8, Math.min(1.3, Number(execution.contrast || 1.04) * Number(clip.contrast ?? 1)));
  const saturation = Math.max(.5, Math.min(1.5, Number(execution.saturation || 1.06) * Number(clip.saturation ?? 1)));
  const scale = fit
    ? "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x09090b"
    : `scale=${Math.round(1080 * (1 + zoom / 100))}:${Math.round(1920 * (1 + zoom / 100))}:force_original_aspect_ratio=increase,crop=1080:1920`;
  const fade = clipTransition > 0
    ? `,fade=t=in:st=0:d=${fixed(index > 0 ? clipTransition : 0)},fade=t=out:st=${fixed(Math.max(0, duration - clipTransition))}:d=${fixed(index < contract.clips.length - 1 ? clipTransition : 0)}`
    : "";
  const audioFade = clipTransition > 0
    ? `,afade=t=in:st=0:d=${fixed(index > 0 ? clipTransition : 0)},afade=t=out:st=${fixed(Math.max(0, duration - clipTransition))}:d=${fixed(index < contract.clips.length - 1 ? clipTransition : 0)}`
    : "";
  const filters: string[] = [
    `[0:v]fps=30,select='${select}',setpts=N/(30*TB*${speed}),${scale},setsar=1,eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation},format=yuv420p${fade}[vbase]`,
  ];
  const audioSource = analysis.hasAudio ? 0 : 1;
  const audioTrim = analysis.hasAudio
    ? `aselect='${select}',asetpts=N/SR/TB,atempo=${speed},aresample=48000:async=1:first_pts=0`
    : `atrim=0:${fixed(duration)},asetpts=PTS-STARTPTS,aresample=48000`;
  // loudnorm may emit no short voice stream when mixed with generated SFX.
  // A streaming compressor keeps speech audible and bounds peak level.
  const denoise = analysis.hasAudio && execution.noiseReduction !== "off" && execution.noiseReduction
    ? `,afftdn=nr=${execution.noiseReduction === "medium" ? 10 : 6}:nf=-40`
    : "";
  filters.push(`[${audioSource}:a]${audioTrim},aformat=sample_fmts=fltp:channel_layouts=stereo${denoise}${analysis.hasAudio ? ",acompressor=threshold=-18dB:ratio=2:attack=5:release=60" : ""},volume=${volume}${audioFade}[abase]`);
  const overlays: Buffer[] = [];
  let videoLabel = "vbase";
  let captionCount = 0;
  let imageCount = 0;
  const fontFile = join(process.cwd(), "assets", "fonts", "Inter.ttf");
  const title = contract.session.title.trim();
  const label = clip.label?.trim();
  const layeredStyle = contract.style_snapshot.id === "ia-en-capas";
  const meaningfulTitle = !/^edici[oó]n de \d+ videos?$/i.test(title) && title !== "Nueva producción" ? title : "";
  const firstScriptLine = contract.session.script?.split(/\n/).map((line) => line.replace(/[*#_]/g, "").trim()).find(Boolean) || "";
  const headerText = (label || meaningfulTitle || firstScriptLine).slice(0, 56);
  const showLayeredHeader = layeredStyle && contract.effects.labels && execution.titleCards !== false && Boolean(headerText);
  const showTitle = !layeredStyle && index === 0 && contract.effects.labels && execution.titleCards !== false
    && Boolean(title) && !label && !/^edici[oó]n de \d+ videos?$/i.test(title);
  const addOverlay = async (text: string, start: number, end: number, position: string, title = false, highlight = false) => {
    if (overlays.length >= 96) throw new Error("Demasiadas tarjetas de texto en una toma.");
    const slot = 1 + Number(!analysis.hasAudio) + overlays.length;
    const out = `vo${overlays.length}`;
    overlays.push(await renderTextOverlay({
      text, fontFile, fontSize: title ? 54 : contract.style_snapshot.subtitle.size,
      textColor: title ? "#FFFFFF" : contract.style_snapshot.subtitle.text,
      boxColor: title ? execution.titleColor || "#09090B" : contract.style_snapshot.subtitle.box,
      boxOpacity: title ? .9 : layeredStyle ? .34 : .85,
      highlightLastWord: highlight,
      highlightColor: "#FACC15",
    }));
    filters.push(`[${videoLabel}][${slot}:v]overlay=x=(W-w)/2:y=${position}:enable='between(t,${fixed(start)},${fixed(end)})':eof_action=repeat:shortest=0[${out}]`);
    videoLabel = out;
  };
  // Images use the exact same source→edited mapping as captions. Resources
  // wholly inside a removed pause disappear instead of shifting into other speech.
  if (contract.effects.images_or_broll) {
    if ((clip.visual_resources?.length ?? 0) > 2) throw new Error("Se admiten hasta dos imágenes de apoyo por toma.");
    for (const resource of clip.visual_resources ?? []) {
      const mapped = mapVisualResourceToOutput(resource, analysis.ranges, speed);
      if (!mapped) continue;
      if (overlays.length >= 96) throw new Error("Demasiadas superposiciones en una toma.");
      const slot = 1 + Number(!analysis.hasAudio) + overlays.length;
      const out = `vo${overlays.length}`;
      const geometry = VISUAL_RESOURCE_LAYOUTS[resource.layout];
      if (!geometry) throw new Error("La posición de la imagen no es válida.");
      overlays.push(await renderVisualResourceImage(resource));
      filters.push(`[${videoLabel}][${slot}:v]overlay=x=${geometry.x}:y=${geometry.y}:enable='gte(t,${fixed(mapped.startSeconds)})*lt(t,${fixed(mapped.endSeconds)})':eof_action=repeat:shortest=0[${out}]`);
      videoLabel = out;
      imageCount += 1;
    }
  }
  if (showTitle) {
    await addOverlay(title, .15, Math.min(duration, 2.6), "H*0.08", true);
  }
  if (showLayeredHeader) {
    await addOverlay(headerText, .05, duration, "H*0.08", true);
  }
  if (label && contract.effects.labels && !layeredStyle) {
    await addOverlay(label, .15, Math.min(duration, 2.6), "H*0.07", true);
  }
  let kineticLayer: KineticLayer | null = null;
  let estimatedCaptionWords = 0;
  const kineticCaptions = contract.style_snapshot.subtitle.mode === "palabra";
  if (contract.captions.enabled && kineticCaptions) {
    // Skill «Subtítulos cinéticos»: una palabra a la vez con los tiempos reales de la voz.
    const sourceCues = clip.caption_cues?.length ? clip.caption_cues : [{ startSeconds: 0, endSeconds: analysis.duration, text: clip.transcript }];
    const outputCues = mapCaptionCues(sourceCues, analysis.ranges).map((cue) => ({
      ...cue,
      startSeconds: cue.startSeconds / speed, endSeconds: cue.endSeconds / speed,
      words: cue.words?.map((word) => ({ ...word, startSeconds: word.startSeconds / speed, endSeconds: word.endSeconds / speed })),
    }));
    const words = planKineticCaptions(outputCues, { uppercase: contract.style_snapshot.subtitle.uppercase, durationSeconds: duration });
    kineticLayer = await buildKineticLayer(words, {
      directory: join(dirname(output), `kinetic-${index}`),
      fontDir: join(process.cwd(), "assets", "fonts"),
      durationSeconds: duration,
      zone: kineticZone(contract.style_snapshot.subtitle.position, layeredStyle),
      sizeScale: Math.max(.6, Math.min(1.4, Number(contract.style_snapshot.subtitle.size || 72) / 72)),
    });
    if (kineticLayer) {
      const slot = 1 + Number(!analysis.hasAudio) + overlays.length;
      filters.push(kineticOverlayFilter({ videoLabel, inputIndex: slot, layer: kineticLayer, outputLabel: "vkinetic" }));
      videoLabel = "vkinetic";
      captionCount += kineticLayer.words;
      estimatedCaptionWords = words.filter((word) => word.estimated).length;
    }
  } else if (contract.captions.enabled) {
    const position = layeredStyle ? "H-h-H*0.22" : contract.style_snapshot.subtitle.position === "top" ? "H*0.11" : contract.style_snapshot.subtitle.position === "center" ? "(H-h)/2" : contract.style_snapshot.subtitle.position === "chest" ? "H*0.64-h/2" : "H-h-H*0.10";
    const sourceCues = clip.caption_cues?.length ? clip.caption_cues : [{ startSeconds: 0, endSeconds: analysis.duration, text: clip.transcript }];
    for (const cue of mapCaptionCues(sourceCues, analysis.ranges)) {
      const items = cards(cue.text, contract.captions.max_words_per_card || 5, contract.style_snapshot.subtitle.uppercase);
      for (const [cardIndex, text] of items.entries()) {
        await addOverlay(text, (cue.startSeconds + (cue.endSeconds - cue.startSeconds) * cardIndex / items.length) / speed, (cue.startSeconds + (cue.endSeconds - cue.startSeconds) * (cardIndex + 1) / items.length) / speed, position, false, layeredStyle);
        captionCount += 1;
      }
    }
  }
  let audioLabel = "abase";
  let cueCount = 0;
  if (contract.effects.sound_effects) {
    // A silence trim is a technical cut, not a creative beat. Sounding every trim
    // makes spoken reels noisy and repetitive; accent only a new scene or title.
    const newScene = index > 0 && contract.clips[index - 1].id !== clip.id;
    const cueTimes = newScene || showTitle || (index === 0 && showLayeredHeader) ? [.15] : [];
    const cues = planCutSoundCues(cueTimes, execution.soundPreset && execution.soundPreset !== "auto" ? execution.soundPreset : (contract.style_snapshot as { id?: string }).id);
    const sound = buildSoundDesignGraph({
      inputLabel: audioLabel, cues, durationSeconds: duration,
      volume: Number(execution.soundEffectVolume ?? .35), outputLabel: "audiofx",
    });
    filters.push(...sound.filters);
    audioLabel = sound.outputLabel;
    cueCount = sound.renderedCueCount;
  }
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-filter_complex_threads", "1", "-threads", "1",
    "-ss", fixed(sourceStart), "-t", fixed(sourceEnd - sourceStart), "-i", url];
  if (!analysis.hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  overlays.forEach((_, overlayIndex) => args.push("-f", "image2pipe", "-framerate", "30", "-c:v", "png", "-i", `pipe:${overlayIndex + 3}`));
  // The kinetic layer is the last input: its index was computed after every pipe overlay.
  if (kineticLayer) args.push(...kineticInputArgs(kineticLayer));
  args.push(
    "-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`,
    "-t", fixed(duration), "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "22",
    "-maxrate", `${videoKbps}k`, "-bufsize", `${videoKbps * 2}k`, "-g", "60", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", output,
  );
  await ffmpegFile(command, args, overlays, deadline);
  return { duration, captionCount, estimatedCaptionWords, captionMode: kineticCaptions ? "palabra" as const : "tarjeta" as const, cueCount, imageCount, labelCount: Number(showTitle) + Number(showLayeredHeader) + Number(Boolean(label && contract.effects.labels && !layeredStyle)) };
}

/**
 * Memory-safe fallback: HEVC sources are decoded one at a time. The final
 * concat only copies already-normalized H.264/AAC intermediates. A requested
 * dissolve is rendered as a short dip-to-black fade between adjacent clips.
 */
export async function renderSequentialCloudEdit(input: RenderInput) {
  const command = ffmpegPath;
  if (!command) throw new Error("El motor FFmpeg no está disponible.");
  if (!input.contract.clips.length || input.contract.clips.length !== input.signedUrls.length) throw new Error("Faltan tomas para la edición.");
  const deadline = Date.now() + 250_000;
  await input.onProgress(14, "Analizando voz y silencios");
  const analyses: Analysis[] = [];
  let plannedDuration = 0;
  for (const clip of input.contract.clips) {
    const start = clip.trim_start_seconds ?? 0;
    const end = clip.trim_end_seconds ?? clip.duration_seconds;
    const speed = clip.playback_speed ?? 1;
    if (![start, end, speed].every(Number.isFinite) || start < 0 || end > clip.duration_seconds || end - start < .2 || speed < .5 || speed > 2) {
      throw new Error("Un recorte o su velocidad no es válido.");
    }
    plannedDuration += (end - start) / speed;
  }
  if (input.contract.effects.images_or_broll && input.contract.clips.reduce((total, clip) => total + (clip.visual_resources?.length ?? 0), 0) > 8) throw new Error("Se admiten hasta ocho imágenes de apoyo por montaje.");
  if (plannedDuration > MAX_OUTPUT_SECONDS) throw new Error("Esta versión cloud procesa hasta 2 minutos de video final por edición.");
  for (const [index, clip] of input.contract.clips.entries()) {
    const result = await analyzeSequentialClip(command, input.signedUrls[index], clip.duration_seconds, input.contract.dead_air.remove, input.contract.dead_air.threshold_ms, input.contract.dead_air.noise_db ?? -30,
      { start: clip.trim_start_seconds ?? 0, end: clip.trim_end_seconds ?? clip.duration_seconds }, deadline);
    analyses.push(trimSequentialAnalysis(result, clip));
    await input.onProgress(14 + Math.round((index + 1) / input.contract.clips.length * 20), `Analizando toma ${index + 1} de ${input.contract.clips.length}`);
  }
  const totalDuration = analyses.reduce((sum, item, index) => sum + item.ranges.reduce((value, range) => value + range.end - range.start, 0) / Math.max(.5, Math.min(2, Number(input.contract.clips[index].playback_speed ?? 1))), 0);
  if (totalDuration > MAX_OUTPUT_SECONDS) throw new Error("Esta versión cloud procesa hasta 2 minutos por edición.");
  const transitionSeconds = input.contract.effects.transitions && input.contract.style_snapshot.transition !== "cut"
    ? Math.max(0, Math.min(.35, Number(input.contract.style_snapshot.transitionDuration ?? .18))) : 0;
  const kbps = Math.max(800, Math.min(8000, Math.floor((44_000_000 * 8 / Math.max(1, totalDuration) - 160_000) / 1000)));
  const directory = await mkdtemp(join(tmpdir(), "segmenta-sequential-"));
  try {
    const clips: string[] = [];
    let captions = 0;
    let estimatedCaptionWords = 0;
    let captionedClips = 0;
    let effects = 0;
    let images = 0;
    let previewTimeMs = 0;
    for (const [index, analysis] of analyses.entries()) {
      const path = join(directory, `clip-${index}.mp4`);
      await input.onProgress(36 + Math.round(index / analyses.length * 42), `Editando toma ${index + 1} de ${analyses.length}`);
      const rendered = await renderSequentialClip({
        command, contract: input.contract, analysis, url: input.signedUrls[index], index,
        output: path, videoKbps: kbps, transitionSeconds, deadline,
      });
      clips.push(path);
      captions += rendered.captionCount;
      estimatedCaptionWords += rendered.estimatedCaptionWords;
      if (rendered.captionCount > 0) captionedClips += 1;
      images += rendered.imageCount;
      effects += rendered.cueCount + rendered.labelCount + rendered.imageCount + (index > 0 && transitionSeconds > 0 ? 1 : 0);
      await input.onProgress(36 + Math.round((index + 1) / analyses.length * 42), `Toma ${index + 1} de ${analyses.length} editada`);
      // Samples are optional and must not take the final render's remaining budget.
      // Bound cumulative overhead to 12s and keep 15s reserved for final assembly/upload.
      const previewBudget = Math.min(2_000, 12_000 - previewTimeMs, deadline - Date.now() - 15_000);
      if (input.onPreview && previewBudget > 250) {
        const startedAt = Date.now();
        try {
          const sample = await createRenderPreview({
            command, source: path, output: join(directory, `preview-${index}.mp4`),
            durationSeconds: rendered.duration, deadline: startedAt + previewBudget,
          });
          const clip = input.contract.clips[index];
          await input.onPreview({
            clipIndex: index, totalClips: analyses.length, takeId: clip.id, title: clip.name.slice(0, 200),
            ...sample, captionCount: rendered.captionCount, soundEffectCount: rendered.cueCount, imageCount: rendered.imageCount,
            removedSilenceSeconds: Number(analysis.removed.toFixed(2)),
          });
        } catch {
          // The complete MP4 remains the deliverable when an optional sample is unavailable.
          console.info("[cloud-render] scene preview unavailable", { clipIndex: index });
        } finally {
          previewTimeMs += Date.now() - startedAt;
        }
      }
    }
    const list = join(directory, "concat.txt");
    await writeFile(list, clips.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"));
    const output = join(directory, "final.mp4");
    await ffmpegFile(command, ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output], [], deadline);
    const bytes = await readFile(output);
    if (bytes.length > MAX_RENDER_BYTES) throw new Error("El MP4 supera el límite de 48 MB. Divide el proyecto.");
    await input.onProgress(82, "Subiendo el MP4 en partes seguras");
    await uploadRenderedMp4({
      bytes, objectKey: input.outputObjectKey, accessToken: input.accessToken,
      projectUrl: input.projectUrl, publishableKey: input.publishableKey,
    });
    await input.onProgress(94, "Verificando el archivo final");
    return {
      duration_seconds: Number(totalDuration.toFixed(2)), width: 1080, height: 1920,
      caption_count: captions, effect_count: effects, image_count: images,
      // Honest QA: kinetic words without recognized timing were spread by syllables inside their cue.
      caption_mode: input.contract.style_snapshot.subtitle.mode === "palabra" ? "palabra" : "tarjeta",
      estimated_caption_words: estimatedCaptionWords,
      removed_silence_seconds: Number(analyses.reduce((sum, item) => sum + item.removed, 0).toFixed(2)),
      silent_source_clips: analyses.filter((item) => !item.hasAudio).length,
      style_applied: true, style_id: (input.contract.style_snapshot as { id?: string }).id || null,
      subtitle_position: input.contract.style_snapshot.subtitle.position || "bottom",
      zoom_percent: Math.max(0, Math.min(10, Number(input.contract.style_snapshot.execution?.zoomPercent || 0))),
      transition: transitionSeconds ? "fade" : "cut",
      transition_fallback: transitionSeconds > 0 && input.contract.style_snapshot.transition === "dissolve" ? "dip-to-black" : null,
      release_gate: { passed: totalDuration > 0 && (!input.contract.captions.enabled || captionedClips === input.contract.clips.length) && (!input.contract.quality_gates?.timed_captions || input.contract.clips.every((clip) => Boolean(clip.caption_cues?.length))) && (!input.contract.quality_gates?.effects || effects > 0) && (!input.contract.quality_gates?.images || images > 0) },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
