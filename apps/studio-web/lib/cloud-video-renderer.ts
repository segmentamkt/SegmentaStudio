import { spawn } from "node:child_process";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import { MAX_RENDER_BYTES, uploadRenderedMp4 } from "./cloud-render-upload";
import { buildSoundDesignGraph, planCutSoundCues } from "./sound-design";
import { renderTextOverlay } from "./video-text-overlay";

type ContractClip = {
  id: string;
  name: string;
  object_key: string;
  duration_seconds: number;
  transcript: string;
};

type EditContract = {
  objective: string;
  session: { title: string };
  clips: ContractClip[];
  style_snapshot: {
    transition: "cut" | "fade" | "dissolve";
    transitionDuration?: number;
    subtitle: { text: string; box: string; size: number; uppercase: boolean; position?: "top" | "center" | "bottom" };
    execution?: {
      zoomPercent?: number; contrast?: number; saturation?: number; soundEffectVolume?: number;
      framing?: "fill" | "fit"; titleCards?: boolean; titleColor?: string;
    };
  };
  captions: { enabled: boolean; max_words_per_card: number };
  dead_air: { remove: boolean; threshold_ms: number };
  effects: { transitions: boolean; sound_effects: boolean; labels: boolean };
};

type ClipAnalysis = { duration: number; ranges: Array<{ start: number; end: number }>; removed: number; hasAudio: boolean; videoCodec: string | null; audioCodec: string | null };

type CaptureOptions = { timeoutMs?: number; onStderrLine?: (line: string) => void };

/** Keep FFmpeg diagnostics bounded even when damaged media floods stderr. */
export function capture(command: string, args: string[], options: CaptureOptions = {}) {
  return new Promise<{ code: number; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const headLimit = 32 * 1024;
    const tailLimit = 128 * 1024;
    let head = "";
    let tail = "";
    let total = 0;
    let partialLine = "";
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs ?? 60_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      total += chunk.length;
      if (head.length < headLimit) head += chunk.slice(0, headLimit - head.length);
      tail = (tail + chunk).slice(-tailLimit);
      if (options.onStderrLine) {
        const lines = (partialLine + chunk).split(/\r\n|\r|\n/);
        partialLine = (lines.pop() || "").slice(-8192);
        for (const line of lines) options.onStderrLine(line);
      }
    });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (partialLine && options.onStderrLine) options.onStderrLine(partialLine);
      resolve({ code: code ?? -1, stderr: total <= headLimit ? head : `${head}\n[diagnóstico recortado]\n${tail}`, timedOut });
    });
  });
}

function parseDuration(value: string) {
  const match = value.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

/** Decode a sample from the uploaded object, not the local FFmpeg pipe. */
export async function verifyCloudRender(signedUrl: string) {
  if (!ffmpegPath) throw new Error("El motor FFmpeg no está disponible para verificar el video.");
  const result = await capture(ffmpegPath, [
    "-hide_banner", "-nostdin", "-xerror", "-i", signedUrl,
    "-map", "0:v:0", "-map", "0:a:0", "-t", "3", "-f", "null", "-",
  ], { timeoutMs: 60_000 });
  if (result.timedOut) throw new Error("El MP4 guardado tardó demasiado en verificarse.");
  if (result.code !== 0) throw new Error(`El MP4 guardado no pasó la verificación de reproducción: ${result.stderr.slice(-800)}`);
  const video = result.stderr.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  const hasAudio = /Audio:[^\n]*/.test(result.stderr);
  if (!video || !hasAudio) throw new Error("El MP4 guardado no contiene video y audio verificables.");
  return { width: Number(video[1]), height: Number(video[2]), has_audio: hasAudio, playable: true, verified_sample_seconds: Math.min(3, parseDuration(result.stderr) || 3) };
}

async function analyzeClip(command: string, url: string, fallbackDuration: number, removeSilence: boolean, thresholdMs: number): Promise<ClipAnalysis> {
  const threshold = Math.max(0.35, thresholdMs / 1000);
  const mediaLimit = Math.min(120, Math.max(1, fallbackDuration + 0.5));
  const timeoutMs = Math.min(45_000, 15_000 + Math.max(0, fallbackDuration) * 3_000);
  const args = ["-hide_banner", "-nostdin", "-nostats", "-threads", "1", "-filter_threads", "1", "-i", url, "-map", "0:a:0?", "-vn", "-sn", "-dn"];
  if (removeSilence) args.push("-af", `silencedetect=noise=-35dB:d=${threshold}`);
  args.push("-t", mediaLimit.toFixed(3), "-f", "null", "-");
  const silences: Array<{ start: number; end: number }> = [];
  let pending: number | null = null;
  let tooManySilences = false;
  const result = await capture(command, args, {
    timeoutMs,
    onStderrLine: (line) => {
      const start = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
      if (start) pending = Math.max(0, Number(start[1]));
      const end = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
      if (end && pending !== null) {
        if (silences.length < 512) silences.push({ start: pending, end: Number(end[1]) });
        else tooManySilences = true;
        pending = null;
      }
    },
  });
  if (result.timedOut) throw new Error("La toma excedió el tiempo seguro de análisis. Prueba una toma más corta o de menor resolución.");
  if (tooManySilences) throw new Error("La toma contiene demasiados cambios de silencio para procesarla en la nube.");
  const hasVideo = /Stream #[^\n]*Video:/.test(result.stderr);
  const hasAudio = /Stream #[^\n]*Audio:/.test(result.stderr);
  const videoCodec = result.stderr.match(/Stream #[^\n]*Video:\s*([a-zA-Z0-9_]+)/)?.[1] || null;
  const audioCodec = result.stderr.match(/Stream #[^\n]*Audio:\s*([a-zA-Z0-9_]+)/)?.[1] || null;
  if (!hasVideo) throw new Error(`La toma no contiene una pista de video legible: ${result.stderr.slice(-500)}`);
  if (result.code !== 0 && hasAudio) throw new Error(`No pudimos analizar una toma: ${result.stderr.slice(-700)}`);
  const duration = Math.min(parseDuration(result.stderr) || fallbackDuration, mediaLimit);
  if (!duration) throw new Error("No pudimos medir la duración de una toma.");
  if (!hasAudio || !removeSilence) return { duration, ranges: [{ start: 0, end: duration }], removed: 0, hasAudio, videoCodec, audioCodec };
  if (pending !== null) silences.push({ start: pending, end: duration });
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  let removed = 0;
  for (const silence of silences) {
    const silenceStart = Math.min(duration, silence.start);
    const silenceEnd = Math.min(duration, silence.end);
    if (silenceEnd - silenceStart < threshold) continue;
    const keepEnd = Math.min(duration, silenceStart + 0.1);
    if (keepEnd - cursor > 0.16) ranges.push({ start: cursor, end: keepEnd });
    const next = Math.max(0, silenceEnd - 0.1);
    removed += Math.max(0, next - keepEnd);
    cursor = next;
  }
  if (duration - cursor > 0.16) ranges.push({ start: cursor, end: duration });
  if (!ranges.length) ranges.push({ start: 0, end: duration });
  return { duration, ranges, removed, hasAudio, videoCodec, audioCodec };
}

function cards(text: string, size: number, uppercase: boolean) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const result: string[] = [];
  for (let index = 0; index < words.length; index += size) {
    const value = words.slice(index, index + size).join(" ");
    result.push(uppercase ? value.toUpperCase() : value);
  }
  return result;
}

export async function renderCloudEdit(input: {
  contract: EditContract;
  signedUrls: string[];
  outputObjectKey: string;
  accessToken: string;
  projectUrl: string;
  publishableKey: string;
  onProgress: (progress: number, stage: string) => Promise<void>;
}) {
  const command = ffmpegPath;
  if (!command) throw new Error("El motor FFmpeg no está disponible en este servidor.");
  if (!input.contract.clips.length || input.contract.clips.length !== input.signedUrls.length) throw new Error("El contrato de edición no contiene todas las tomas.");
  await input.onProgress(14, "Analizando voz y silencios");
  const analyses: ClipAnalysis[] = [];
  for (let index = 0; index < input.contract.clips.length; index += 1) {
    const clip = input.contract.clips[index];
    const rssBeforeMb = Math.round(process.memoryUsage().rss / 1048576);
    console.info("[cloud-render] clip analysis start", { index: index + 1, total: input.contract.clips.length, declaredDurationSeconds: clip.duration_seconds, rssMb: rssBeforeMb });
    let analysis: ClipAnalysis;
    try {
      analysis = await analyzeClip(command, input.signedUrls[index], clip.duration_seconds, input.contract.dead_air.remove, input.contract.dead_air.threshold_ms);
    } catch (error) {
      console.error("[cloud-render] clip analysis failed", { index: index + 1, total: input.contract.clips.length, rssMb: Math.round(process.memoryUsage().rss / 1048576), errorType: error instanceof Error ? error.name : typeof error });
      throw new Error(`No se pudo analizar la toma ${index + 1} de ${input.contract.clips.length}: ${error instanceof Error ? error.message : "error desconocido"}`);
    }
    analyses.push(analysis);
    console.info("[cloud-render] clip analysis complete", { index: index + 1, total: input.contract.clips.length, declaredDurationSeconds: clip.duration_seconds, measuredDurationSeconds: analysis.duration, videoCodec: analysis.videoCodec, audioCodec: analysis.audioCodec, rssBeforeMb, rssAfterMb: Math.round(process.memoryUsage().rss / 1048576) });
    if (analyses.reduce((total, item) => total + item.duration, 0) > 120) {
      throw new Error("Esta versión cloud procesa hasta 2 minutos de material por edición. Divide el proyecto en escenas más cortas.");
    }
    await input.onProgress(14 + Math.round(((index + 1) / input.contract.clips.length) * 20), `Analizando toma ${index + 1} de ${input.contract.clips.length}`);
  }
  const filters: string[] = [];
  const clipDurations: number[] = [];
  const fontFile = join(process.cwd(), "assets", "fonts", "Inter.ttf");
  const execution = input.contract.style_snapshot.execution || {};
  const zoom = Math.max(0, Math.min(10, Number(execution.zoomPercent || 0)));
  const contrast = Math.max(.8, Math.min(1.3, Number(execution.contrast || 1.04)));
  const saturation = Math.max(.7, Math.min(1.4, Number(execution.saturation || 1.06)));
  const fit = execution.framing === "fit";
  const silentAudioInput = input.signedUrls.length;
  const needsSilentAudio = analyses.some((analysis) => !analysis.hasAudio);
  const overlayInputStart = input.signedUrls.length + Number(needsSilentAudio);
  const overlayBuffers: Buffer[] = [];
  for (let index = 0; index < analyses.length; index += 1) {
    const analysis = analyses[index];
    const segmentLabels: Array<{ video: string; audio: string }> = [];
    analysis.ranges.forEach((range, segmentIndex) => {
      const video = `v${index}_${segmentIndex}`;
      const audio = `a${index}_${segmentIndex}`;
      const scale = fit
        ? "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x09090b"
        : `scale=${Math.round(1080 * (1 + zoom / 100))}:${Math.round(1920 * (1 + zoom / 100))}:force_original_aspect_ratio=increase,crop=1080:1920`;
      filters.push(`[${index}:v]trim=start=${range.start.toFixed(3)}:end=${range.end.toFixed(3)},setpts=PTS-STARTPTS,${scale},setsar=1,fps=30,eq=contrast=${contrast}:saturation=${saturation},format=yuv420p[${video}]`);
      const sourceAudio = analysis.hasAudio ? index : silentAudioInput;
      const voiceProcessing = analysis.hasAudio ? ",loudnorm=I=-16:LRA=11:TP=-1.5" : "";
      filters.push(`[${sourceAudio}:a]atrim=start=${range.start.toFixed(3)}:end=${range.end.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo${voiceProcessing}[${audio}]`);
      segmentLabels.push({ video, audio });
    });
    if (segmentLabels.length === 1) {
      filters.push(`[${segmentLabels[0].video}]null[vclip${index}]`);
      filters.push(`[${segmentLabels[0].audio}]anull[aclip${index}]`);
    } else {
      filters.push(`${segmentLabels.map((item) => `[${item.video}][${item.audio}]`).join("")}concat=n=${segmentLabels.length}:v=1:a=1[vclip${index}][aclip${index}]`);
    }
    clipDurations.push(analysis.ranges.reduce((sum, range) => sum + range.end - range.start, 0));
  }
  const requestedTransition = Math.max(0, Math.min(.8, Number(input.contract.style_snapshot.transitionDuration ?? .18)));
  const transitionDuration = input.contract.effects.transitions && input.contract.style_snapshot.transition !== "cut" && clipDurations.length > 1 ? requestedTransition : 0;
  let videoLabel = "vclip0";
  let audioLabel = "aclip0";
  let elapsed = clipDurations[0];
  const clipStarts = [0];
  for (let index = 1; index < clipDurations.length; index += 1) {
    if (transitionDuration) {
      const offset = Math.max(0, elapsed - transitionDuration);
      filters.push(`[${videoLabel}]settb=AVTB[vbase${index}]`);
      filters.push(`[vclip${index}]settb=AVTB[vnext${index}]`);
      filters.push(`[vbase${index}][vnext${index}]xfade=transition=${input.contract.style_snapshot.transition}:duration=${transitionDuration}:offset=${offset.toFixed(3)}[vx${index}]`);
      filters.push(`[${audioLabel}][aclip${index}]acrossfade=d=${transitionDuration}[ax${index}]`);
      videoLabel = `vx${index}`;
      audioLabel = `ax${index}`;
      clipStarts.push(offset);
      elapsed += clipDurations[index] - transitionDuration;
    } else {
      filters.push(`[${videoLabel}][${audioLabel}][vclip${index}][aclip${index}]concat=n=2:v=1:a=1[vx${index}][ax${index}]`);
      videoLabel = `vx${index}`;
      audioLabel = `ax${index}`;
      clipStarts.push(elapsed);
      elapsed += clipDurations[index];
    }
  }
  let captionCount = 0;
  if (input.contract.captions.enabled) {
    const captionY = input.contract.style_snapshot.subtitle.position === "top" ? "H*0.11" : input.contract.style_snapshot.subtitle.position === "center" ? "(H-h)/2" : "H-h-H*0.10";
    for (const [clipIndex, clip] of input.contract.clips.entries()) {
      const items = cards(clip.transcript, input.contract.captions.max_words_per_card || 5, input.contract.style_snapshot.subtitle.uppercase);
      const duration = clipDurations[clipIndex];
      for (const [cardIndex, text] of items.entries()) {
        if (overlayBuffers.length >= 96) throw new Error("Esta edición contiene demasiadas tarjetas de texto. Divide el video en escenas más cortas.");
        const start = clipStarts[clipIndex] + (duration * cardIndex) / Math.max(1, items.length);
        const end = clipStarts[clipIndex] + (duration * (cardIndex + 1)) / Math.max(1, items.length);
        const overlayInput = overlayInputStart + overlayBuffers.length;
        overlayBuffers.push(await renderTextOverlay({
          text, fontFile, fontSize: input.contract.style_snapshot.subtitle.size,
          textColor: input.contract.style_snapshot.subtitle.text,
          boxColor: input.contract.style_snapshot.subtitle.box, boxOpacity: .85,
        }));
        const output = `vsub${captionCount}`;
        filters.push(`[${videoLabel}][${overlayInput}:v]overlay=x=(W-w)/2:y=${captionY}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':eof_action=repeat:shortest=0[${output}]`);
        videoLabel = output;
        captionCount += 1;
      }
    }
  }
  let effectCount = Math.max(0, input.contract.clips.length - 1) * (transitionDuration ? 1 : 0);
  if (input.contract.effects.labels && execution.titleCards !== false && input.contract.session.title.trim()) {
    if (overlayBuffers.length >= 96) throw new Error("Esta edición contiene demasiadas tarjetas de texto. Divide el video en escenas más cortas.");
    const overlayInput = overlayInputStart + overlayBuffers.length;
    overlayBuffers.push(await renderTextOverlay({
      text: input.contract.session.title, fontFile, fontSize: 54,
      textColor: "#FFFFFF", boxColor: execution.titleColor || "#09090B", boxOpacity: .9,
    }));
    const output = "vtitle";
    filters.push(`[${videoLabel}][${overlayInput}:v]overlay=x=(W-w)/2:y=H*0.08:enable='between(t,0.15,2.6)':eof_action=repeat:shortest=0[${output}]`);
    videoLabel = output;
    effectCount += 1;
  }
  if (input.contract.effects.sound_effects) {
    const internalCuts = analyses.flatMap((analysis, index) => {
      let position = clipStarts[index];
      return analysis.ranges.slice(0, -1).map((range) => {
        position += range.end - range.start;
        return position;
      });
    });
    const cues = planCutSoundCues([...clipStarts.slice(1), ...internalCuts], (input.contract.style_snapshot as { id?: string }).id);
    filters.push(`[${audioLabel}]aresample=48000:async=1:first_pts=0[audio48]`);
    audioLabel = "audio48";
    const sound = buildSoundDesignGraph({
      inputLabel: audioLabel, cues,
      volume: Number(execution.soundEffectVolume ?? .35),
      durationSeconds: elapsed, outputLabel: "audiofx",
    });
    filters.push(...sound.filters);
    audioLabel = sound.outputLabel;
    effectCount += sound.renderedCueCount;
  }
  await input.onProgress(42, "Montando cortes, subtítulos y efectos");
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-filter_complex_threads", "1"];
  input.signedUrls.forEach((url) => args.push("-threads", "1", "-i", url));
  if (needsSilentAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  overlayBuffers.forEach((_, index) => args.push("-f", "image2pipe", "-framerate", "30", "-c:v", "png", "-i", `pipe:${index + 3}`));
  // Keep even a two-minute export below the Free plan's 50 MB object limit.
  const maxVideoKbps = Math.max(800, Math.min(8000, Math.floor((44_000_000 * 8 / Math.max(1, elapsed) - 160_000) / 1000)));
  args.push("-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "22", "-maxrate", `${maxVideoKbps}k`, "-bufsize", `${maxVideoKbps * 2}k`, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
  await input.onProgress(60, "Renderizando el MP4");
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe", ...overlayBuffers.map(() => "pipe" as const)] });
  let renderTimedOut = false;
  const renderTimeout = setTimeout(() => { renderTimedOut = true; child.kill("SIGKILL"); }, 240_000);
  overlayBuffers.forEach((buffer, index) => {
    const pipe = child.stdio[index + 3] as Writable;
    pipe.on("error", () => undefined); // FFmpeg can close a pipe when an earlier input fails.
    pipe.end(buffer);
  });
  let stderr = "";
  (child.stderr as Readable).setEncoding("utf8");
  (child.stderr as Readable).on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-128 * 1024); });
  const completion = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
  const chunks: Buffer[] = [];
  let byteCount = 0;
  const output = (async () => {
    for await (const chunk of child.stdout as Readable) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteCount += bytes.length;
      if (byteCount > MAX_RENDER_BYTES) {
        child.kill("SIGTERM");
        throw new Error("El MP4 supera el límite de 48 MB de esta edición. Divide el proyecto en videos más cortos.");
      }
      chunks.push(bytes);
    }
  })();
  const [processResult, outputResult] = await Promise.allSettled([completion, output]);
  clearTimeout(renderTimeout);
  if (renderTimedOut) throw new Error("La exportación excedió el tiempo seguro de esta versión cloud. Divide el proyecto en videos más cortos.");
  if (outputResult.status === "rejected") throw outputResult.reason;
  if (processResult.status === "rejected") throw processResult.reason;
  if (processResult.value !== 0) throw new Error(`FFmpeg no pudo terminar el render: ${stderr.slice(-1200)}`);
  await input.onProgress(72, "Subiendo el MP4 en partes seguras");
  await uploadRenderedMp4({
    bytes: Buffer.concat(chunks, byteCount),
    objectKey: input.outputObjectKey,
    accessToken: input.accessToken,
    projectUrl: input.projectUrl,
    publishableKey: input.publishableKey,
  });
  await input.onProgress(94, "Verificando el archivo final");
  return {
    duration_seconds: Number(elapsed.toFixed(2)), width: 1080, height: 1920,
    caption_count: captionCount, effect_count: effectCount,
    removed_silence_seconds: Number(analyses.reduce((sum, item) => sum + item.removed, 0).toFixed(2)),
    silent_source_clips: analyses.filter((analysis) => !analysis.hasAudio).length,
    style_applied: true, style_id: (input.contract.style_snapshot as { id?: string }).id || null,
    subtitle_position: input.contract.style_snapshot.subtitle.position || "bottom", zoom_percent: zoom,
    transition: transitionDuration ? input.contract.style_snapshot.transition : "cut",
    release_gate: { passed: elapsed > 0 && (!input.contract.captions.enabled || captionCount > 0) },
  };
}
