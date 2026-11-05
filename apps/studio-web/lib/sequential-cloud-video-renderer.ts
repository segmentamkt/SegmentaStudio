import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import { MAX_RENDER_BYTES, uploadRenderedMp4 } from "./cloud-render-upload";
import { capture } from "./cloud-video-renderer";
import { buildSoundDesignGraph, planCutSoundCues } from "./sound-design";
import { renderTextOverlay } from "./video-text-overlay";
import { mapCaptionCues, type CaptionCue } from "./caption-cues";

type Range = { start: number; end: number };
type Clip = { id: string; name: string; object_key: string; duration_seconds: number; transcript: string; trim_start_seconds?: number; trim_end_seconds?: number; label?: string; caption_cues?: CaptionCue[] };
type EditContract = {
  objective: string;
  session: { title: string };
  clips: Clip[];
  style_snapshot: {
    transition: "cut" | "fade" | "dissolve";
    transitionDuration?: number;
    subtitle: { text: string; box: string; size: number; uppercase: boolean; position?: "top" | "center" | "bottom" };
    execution?: {
      zoomPercent?: number; contrast?: number; saturation?: number; soundEffectVolume?: number; soundPreset?: "auto" | "none" | "soft" | "kinetic" | "cinematic" | "pop";
      framing?: "fill" | "fit"; titleCards?: boolean; titleColor?: string;
    };
  };
  captions: { enabled: boolean; max_words_per_card: number };
  dead_air: { remove: boolean; threshold_ms: number; noise_db?: number };
  effects: { transitions: boolean; sound_effects: boolean; labels: boolean };
  quality_gates?: { effects?: boolean };
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
};

const safeSeconds = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
const fixed = (value: number) => safeSeconds(value).toFixed(3);

export async function analyzeSequentialClip(command: string, url: string, durationHint: number, remove: boolean, thresholdMs: number, noiseDb = -35): Promise<Analysis> {
  const threshold = Math.max(.35, thresholdMs / 1000);
  const limit = Math.min(120, Math.max(1, safeSeconds(durationHint) + .5));
  const events: Range[] = [];
  let pending: number | null = null;
  let tooManyEvents = false;
  const result = await capture(command, [
    "-hide_banner", "-nostdin", "-nostats", "-threads", "1", "-filter_threads", "1", "-i", url,
    "-map", "0:a:0?", "-vn", "-sn", "-dn",
    ...(remove ? ["-af", `silencedetect=noise=${[-35, -30, -25].includes(noiseDb) ? noiseDb : -30}dB:d=${threshold}`] : []),
    "-t", fixed(limit), "-f", "null", "-",
  ], {
    timeoutMs: Math.min(45_000, 15_000 + durationHint * 3_000),
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
  const duration = Math.min(limit, Math.max(.1, measured));
  if (!hasAudio || !remove) return { duration, ranges: [{ start: 0, end: duration }], removed: 0, hasAudio };
  if (pending !== null) events.push({ start: pending, end: duration });
  const ranges: Range[] = [];
  let cursor = 0;
  let removed = 0;
  for (const event of events) {
    const start = Math.min(duration, safeSeconds(event.start));
    const end = Math.min(duration, safeSeconds(event.end));
    if (end - start < threshold) continue;
    const keepEnd = Math.min(duration, start + .1);
    if (keepEnd - cursor > .16) ranges.push({ start: cursor, end: keepEnd });
    const next = Math.max(0, end - .1);
    removed += Math.max(0, next - keepEnd);
    cursor = next;
  }
  if (duration - cursor > .16) ranges.push({ start: cursor, end: duration });
  if (!ranges.length) ranges.push({ start: 0, end: duration });
  return { duration, ranges, removed, hasAudio };
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

export async function renderSequentialClip(input: {
  command: string; contract: EditContract; analysis: Analysis; url: string; index: number;
  output: string; videoKbps: number; transitionSeconds: number; deadline: number;
}) {
  const { command, contract, analysis, url, index, output, videoKbps, transitionSeconds, deadline } = input;
  const execution = contract.style_snapshot.execution || {};
  const duration = analysis.ranges.reduce((total, range) => total + range.end - range.start, 0);
  const select = analysis.ranges.map((range) => `between(t,${fixed(range.start)},${fixed(range.end)})`).join("+");
  const fit = execution.framing === "fit";
  const zoom = Math.max(0, Math.min(10, Number(execution.zoomPercent || 0)));
  const contrast = Math.max(.8, Math.min(1.3, Number(execution.contrast || 1.04)));
  const saturation = Math.max(.7, Math.min(1.4, Number(execution.saturation || 1.06)));
  const scale = fit
    ? "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x09090b"
    : `scale=${Math.round(1080 * (1 + zoom / 100))}:${Math.round(1920 * (1 + zoom / 100))}:force_original_aspect_ratio=increase,crop=1080:1920`;
  const fade = transitionSeconds > 0
    ? `,fade=t=in:st=0:d=${fixed(index > 0 ? transitionSeconds : 0)},fade=t=out:st=${fixed(Math.max(0, duration - transitionSeconds))}:d=${fixed(index < contract.clips.length - 1 ? transitionSeconds : 0)}`
    : "";
  const audioFade = transitionSeconds > 0
    ? `,afade=t=in:st=0:d=${fixed(index > 0 ? transitionSeconds : 0)},afade=t=out:st=${fixed(Math.max(0, duration - transitionSeconds))}:d=${fixed(index < contract.clips.length - 1 ? transitionSeconds : 0)}`
    : "";
  const filters: string[] = [
    `[0:v]fps=30,select='${select}',setpts=N/(30*TB),${scale},setsar=1,eq=contrast=${contrast}:saturation=${saturation},format=yuv420p${fade}[vbase]`,
  ];
  const audioSource = analysis.hasAudio ? 0 : 1;
  const audioTrim = analysis.hasAudio
    ? `aselect='${select}',asetpts=N/SR/TB,aresample=48000:async=1:first_pts=0`
    : `atrim=0:${fixed(duration)},asetpts=PTS-STARTPTS,aresample=48000`;
  // loudnorm may emit no short voice stream when mixed with generated SFX.
  // A streaming compressor keeps speech audible and bounds peak level.
  filters.push(`[${audioSource}:a]${audioTrim},aformat=sample_fmts=fltp:channel_layouts=stereo${analysis.hasAudio ? ",acompressor=threshold=-18dB:ratio=2:attack=5:release=60" : ""}${audioFade}[abase]`);
  const overlays: Buffer[] = [];
  let videoLabel = "vbase";
  let captionCount = 0;
  const fontFile = join(process.cwd(), "assets", "fonts", "Inter.ttf");
  const title = contract.session.title.trim();
  const label = contract.clips[index].label?.trim();
  const showTitle = index === 0 && contract.effects.labels && execution.titleCards !== false
    && Boolean(title) && !label && !/^edici[oó]n de \d+ videos?$/i.test(title);
  const addOverlay = async (text: string, start: number, end: number, position: string, title = false) => {
    if (overlays.length >= 96) throw new Error("Demasiadas tarjetas de texto en una toma.");
    const slot = 1 + Number(!analysis.hasAudio) + overlays.length;
    const out = `vo${overlays.length}`;
    overlays.push(await renderTextOverlay({
      text, fontFile, fontSize: title ? 54 : contract.style_snapshot.subtitle.size,
      textColor: title ? "#FFFFFF" : contract.style_snapshot.subtitle.text,
      boxColor: title ? execution.titleColor || "#09090B" : contract.style_snapshot.subtitle.box,
      boxOpacity: title ? .9 : .85,
    }));
    filters.push(`[${videoLabel}][${slot}:v]overlay=x=(W-w)/2:y=${position}:enable='between(t,${fixed(start)},${fixed(end)})':eof_action=repeat:shortest=0[${out}]`);
    videoLabel = out;
  };
  if (showTitle) {
    await addOverlay(title, .15, Math.min(duration, 2.6), "H*0.08", true);
  }
  if (label && contract.effects.labels) {
    await addOverlay(label, .15, Math.min(duration, 2.6), "H*0.07", true);
  }
  if (contract.captions.enabled) {
    const position = contract.style_snapshot.subtitle.position === "top" ? "H*0.11" : contract.style_snapshot.subtitle.position === "center" ? "(H-h)/2" : "H-h-H*0.10";
    const clip = contract.clips[index];
    const sourceCues = clip.caption_cues?.length ? clip.caption_cues : [{ startSeconds: 0, endSeconds: analysis.duration, text: clip.transcript }];
    for (const cue of mapCaptionCues(sourceCues, analysis.ranges)) {
      const items = cards(cue.text, contract.captions.max_words_per_card || 5, contract.style_snapshot.subtitle.uppercase);
      for (const [cardIndex, text] of items.entries()) {
        await addOverlay(text, cue.startSeconds + (cue.endSeconds - cue.startSeconds) * cardIndex / items.length, cue.startSeconds + (cue.endSeconds - cue.startSeconds) * (cardIndex + 1) / items.length, position);
        captionCount += 1;
      }
    }
  }
  let audioLabel = "abase";
  let cueCount = 0;
  if (contract.effects.sound_effects) {
    let position = 0;
    const internalCuts = analysis.ranges.slice(0, -1).map((range) => { position += range.end - range.start; return position; });
    const cueTimes = [...(index > 0 || showTitle || label ? [.15] : []), ...internalCuts];
    const cues = planCutSoundCues(cueTimes, execution.soundPreset && execution.soundPreset !== "auto" ? execution.soundPreset : (contract.style_snapshot as { id?: string }).id);
    const sound = buildSoundDesignGraph({
      inputLabel: audioLabel, cues, durationSeconds: duration,
      volume: Number(execution.soundEffectVolume ?? .35), outputLabel: "audiofx",
    });
    filters.push(...sound.filters);
    audioLabel = sound.outputLabel;
    cueCount = sound.renderedCueCount;
  }
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-filter_complex_threads", "1", "-threads", "1", "-i", url];
  if (!analysis.hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  overlays.forEach((_, overlayIndex) => args.push("-f", "image2pipe", "-framerate", "30", "-c:v", "png", "-i", `pipe:${overlayIndex + 3}`));
  args.push(
    "-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`,
    "-t", fixed(duration), "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "22",
    "-maxrate", `${videoKbps}k`, "-bufsize", `${videoKbps * 2}k`, "-g", "60", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", output,
  );
  await ffmpegFile(command, args, overlays, deadline);
  return { duration, captionCount, cueCount, labelCount: Number(showTitle) + Number(Boolean(label && contract.effects.labels)) };
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
  for (const [index, clip] of input.contract.clips.entries()) {
    const result = await analyzeSequentialClip(command, input.signedUrls[index], clip.duration_seconds, input.contract.dead_air.remove, input.contract.dead_air.threshold_ms, input.contract.dead_air.noise_db ?? -30);
    analyses.push(trimSequentialAnalysis(result, clip));
    await input.onProgress(14 + Math.round((index + 1) / input.contract.clips.length * 20), `Analizando toma ${index + 1} de ${input.contract.clips.length}`);
  }
  const totalDuration = analyses.reduce((sum, item) => sum + item.ranges.reduce((value, range) => value + range.end - range.start, 0), 0);
  if (totalDuration > 120) throw new Error("Esta versión cloud procesa hasta 2 minutos por edición.");
  const transitionSeconds = input.contract.effects.transitions && input.contract.style_snapshot.transition !== "cut"
    ? Math.max(0, Math.min(.35, Number(input.contract.style_snapshot.transitionDuration ?? .18))) : 0;
  const kbps = Math.max(800, Math.min(8000, Math.floor((44_000_000 * 8 / Math.max(1, totalDuration) - 160_000) / 1000)));
  const directory = await mkdtemp(join(tmpdir(), "segmenta-sequential-"));
  try {
    const clips: string[] = [];
    let captions = 0;
    let captionedClips = 0;
    let effects = 0;
    for (const [index, analysis] of analyses.entries()) {
      const path = join(directory, `clip-${index}.mp4`);
      const rendered = await renderSequentialClip({
        command, contract: input.contract, analysis, url: input.signedUrls[index], index,
        output: path, videoKbps: kbps, transitionSeconds, deadline,
      });
      clips.push(path);
      captions += rendered.captionCount;
      if (rendered.captionCount > 0) captionedClips += 1;
      effects += rendered.cueCount + rendered.labelCount + (index > 0 && transitionSeconds > 0 ? 1 : 0);
      await input.onProgress(36 + Math.round((index + 1) / analyses.length * 42), `Editando toma ${index + 1} de ${analyses.length}`);
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
      caption_count: captions, effect_count: effects,
      removed_silence_seconds: Number(analyses.reduce((sum, item) => sum + item.removed, 0).toFixed(2)),
      silent_source_clips: analyses.filter((item) => !item.hasAudio).length,
      style_applied: true, style_id: (input.contract.style_snapshot as { id?: string }).id || null,
      subtitle_position: input.contract.style_snapshot.subtitle.position || "bottom",
      zoom_percent: Math.max(0, Math.min(10, Number(input.contract.style_snapshot.execution?.zoomPercent || 0))),
      transition: transitionSeconds ? "fade" : "cut",
      transition_fallback: transitionSeconds > 0 && input.contract.style_snapshot.transition === "dissolve" ? "dip-to-black" : null,
      release_gate: { passed: totalDuration > 0 && (!input.contract.captions.enabled || captionedClips === input.contract.clips.length) && (!input.contract.quality_gates?.effects || effects > 0) },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
