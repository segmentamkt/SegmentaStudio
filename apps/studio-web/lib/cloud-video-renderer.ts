import { spawn } from "node:child_process";
import { join } from "node:path";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import { buildSoundDesignGraph, planCutSoundCues } from "./sound-design";

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

type ClipAnalysis = { duration: number; ranges: Array<{ start: number; end: number }>; removed: number; hasAudio: boolean };

function capture(command: string, args: string[]) {
  return new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
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
  ]);
  if (result.code !== 0) throw new Error(`El MP4 guardado no pasó la verificación de reproducción: ${result.stderr.slice(-800)}`);
  const video = result.stderr.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  const hasAudio = /Audio:[^\n]*/.test(result.stderr);
  if (!video || !hasAudio) throw new Error("El MP4 guardado no contiene video y audio verificables.");
  return { width: Number(video[1]), height: Number(video[2]), has_audio: hasAudio, playable: true, verified_sample_seconds: Math.min(3, parseDuration(result.stderr) || 3) };
}

async function analyzeClip(command: string, url: string, fallbackDuration: number, removeSilence: boolean, thresholdMs: number): Promise<ClipAnalysis> {
  const threshold = Math.max(0.35, thresholdMs / 1000);
  const args = ["-hide_banner", "-nostdin", "-i", url, "-vn"];
  if (removeSilence) args.push("-af", `silencedetect=noise=-35dB:d=${threshold}`);
  args.push("-f", "null", "-");
  const result = await capture(command, args);
  const hasVideo = /Stream #[^\n]*Video:/.test(result.stderr);
  const hasAudio = /Stream #[^\n]*Audio:/.test(result.stderr);
  if (!hasVideo) throw new Error(`La toma no contiene una pista de video legible: ${result.stderr.slice(-500)}`);
  if (result.code !== 0 && hasAudio) throw new Error(`No pudimos analizar una toma: ${result.stderr.slice(-700)}`);
  const duration = parseDuration(result.stderr) || fallbackDuration;
  if (!duration) throw new Error("No pudimos medir la duración de una toma.");
  if (!hasAudio || !removeSilence) return { duration, ranges: [{ start: 0, end: duration }], removed: 0, hasAudio };
  const lines = result.stderr.split("\n");
  const silences: Array<{ start: number; end: number }> = [];
  let pending: number | null = null;
  for (const line of lines) {
    const start = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (start) pending = Math.max(0, Number(start[1]));
    const end = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (end && pending !== null) {
      silences.push({ start: pending, end: Math.min(duration, Number(end[1])) });
      pending = null;
    }
  }
  if (pending !== null) silences.push({ start: pending, end: duration });
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  let removed = 0;
  for (const silence of silences) {
    if (silence.end - silence.start < threshold) continue;
    const keepEnd = Math.min(duration, silence.start + 0.1);
    if (keepEnd - cursor > 0.16) ranges.push({ start: cursor, end: keepEnd });
    const next = Math.max(0, silence.end - 0.1);
    removed += Math.max(0, next - keepEnd);
    cursor = next;
  }
  if (duration - cursor > 0.16) ranges.push({ start: cursor, end: duration });
  if (!ranges.length) ranges.push({ start: 0, end: duration });
  return { duration, ranges, removed, hasAudio };
}

function ffText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/[\r\n]+/g, " ").trim();
}

function ffColor(value: string, alpha = "") {
  return `0x${value.replace("#", "")}${alpha}`;
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
    analyses.push(await analyzeClip(command, input.signedUrls[index], clip.duration_seconds, input.contract.dead_air.remove, input.contract.dead_air.threshold_ms));
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
    const captionY = input.contract.style_snapshot.subtitle.position === "top" ? "h*0.11" : input.contract.style_snapshot.subtitle.position === "center" ? "(h-text_h)/2" : "h-text_h-h*0.10";
    input.contract.clips.forEach((clip, clipIndex) => {
      const items = cards(clip.transcript, input.contract.captions.max_words_per_card || 5, input.contract.style_snapshot.subtitle.uppercase);
      const duration = clipDurations[clipIndex];
      items.forEach((text, cardIndex) => {
        const start = clipStarts[clipIndex] + (duration * cardIndex) / Math.max(1, items.length);
        const end = clipStarts[clipIndex] + (duration * (cardIndex + 1)) / Math.max(1, items.length);
        const output = `vsub${captionCount}`;
        filters.push(`[${videoLabel}]drawtext=fontfile='${ffText(fontFile)}':text='${ffText(text)}':fontcolor=${ffColor(input.contract.style_snapshot.subtitle.text)}:fontsize=${input.contract.style_snapshot.subtitle.size}:box=1:boxcolor=${ffColor(input.contract.style_snapshot.subtitle.box, "D9")}:boxborderw=24:x=(w-text_w)/2:y=${captionY}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${output}]`);
        videoLabel = output;
        captionCount += 1;
      });
    });
  }
  let effectCount = Math.max(0, input.contract.clips.length - 1) * (transitionDuration ? 1 : 0);
  if (input.contract.effects.labels && execution.titleCards !== false) {
    const output = "vtitle";
    filters.push(`[${videoLabel}]drawtext=fontfile='${ffText(fontFile)}':text='${ffText(input.contract.session.title)}':fontcolor=white:fontsize=54:box=1:boxcolor=${ffColor(execution.titleColor || "#09090b", "E6")}:boxborderw=22:x=(w-text_w)/2:y=h*0.08:enable='between(t,0.15,2.6)'[${output}]`);
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
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
  input.signedUrls.forEach((url) => args.push("-i", url));
  if (analyses.some((analysis) => !analysis.hasAudio)) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  args.push("-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completion = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
  const storagePath = input.outputObjectKey.split("/").map(encodeURIComponent).join("/");
  const upload = fetch(`${input.projectUrl}/storage/v1/object/kiko-videos/${storagePath}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      apikey: input.publishableKey,
      "content-type": "video/mp4",
      "x-upsert": "true",
    },
    body: Readable.toWeb(child.stdout) as ReadableStream,
    // Node fetch requires duplex for streamed request bodies.
    ...({ duplex: "half" } as Record<string, string>),
  });
  await input.onProgress(72, "Renderizando y subiendo el MP4");
  const [code, uploadResponse] = await Promise.all([completion, upload]);
  if (code !== 0) throw new Error(`FFmpeg no pudo terminar el render: ${stderr.slice(-1200)}`);
  if (!uploadResponse.ok) throw new Error(`No se pudo guardar el render: ${await uploadResponse.text()}`);
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
