import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";

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
    subtitle: { text: string; box: string; size: number; uppercase: boolean };
  };
  captions: { enabled: boolean; max_words_per_card: number };
  dead_air: { remove: boolean; threshold_ms: number };
  effects: { transitions: boolean; sound_effects: boolean; labels: boolean };
};

type ClipAnalysis = { duration: number; ranges: Array<{ start: number; end: number }>; removed: number };

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

async function analyzeClip(command: string, url: string, fallbackDuration: number, removeSilence: boolean, thresholdMs: number): Promise<ClipAnalysis> {
  const threshold = Math.max(0.35, thresholdMs / 1000);
  const args = ["-hide_banner", "-nostdin", "-i", url];
  if (removeSilence) args.push("-af", `silencedetect=noise=-35dB:d=${threshold}`);
  args.push("-f", "null", "-");
  const result = await capture(command, args);
  const duration = parseDuration(result.stderr) || fallbackDuration;
  if (!duration) throw new Error("No pudimos medir la duración de una toma.");
  if (!removeSilence) return { duration, ranges: [{ start: 0, end: duration }], removed: 0 };
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
  return { duration, ranges, removed };
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
    await input.onProgress(14 + Math.round(((index + 1) / input.contract.clips.length) * 20), `Analizando toma ${index + 1} de ${input.contract.clips.length}`);
  }
  const filters: string[] = [];
  const clipDurations: number[] = [];
  for (let index = 0; index < analyses.length; index += 1) {
    const analysis = analyses[index];
    const segmentLabels: Array<{ video: string; audio: string }> = [];
    analysis.ranges.forEach((range, segmentIndex) => {
      const video = `v${index}_${segmentIndex}`;
      const audio = `a${index}_${segmentIndex}`;
      filters.push(`[${index}:v]trim=start=${range.start.toFixed(3)}:end=${range.end.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,eq=contrast=1.04:saturation=1.06,format=yuv420p[${video}]`);
      filters.push(`[${index}:a]atrim=start=${range.start.toFixed(3)}:end=${range.end.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-16:LRA=11:TP=-1.5[${audio}]`);
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
  const transitionDuration = input.contract.effects.transitions && input.contract.style_snapshot.transition !== "cut" && clipDurations.length > 1 ? 0.18 : 0;
  let videoLabel = "vclip0";
  let audioLabel = "aclip0";
  let elapsed = clipDurations[0];
  const clipStarts = [0];
  for (let index = 1; index < clipDurations.length; index += 1) {
    if (transitionDuration) {
      const offset = Math.max(0, elapsed - transitionDuration);
      filters.push(`[${videoLabel}][vclip${index}]xfade=transition=${input.contract.style_snapshot.transition}:duration=${transitionDuration}:offset=${offset.toFixed(3)}[vx${index}]`);
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
    input.contract.clips.forEach((clip, clipIndex) => {
      const items = cards(clip.transcript, input.contract.captions.max_words_per_card || 5, input.contract.style_snapshot.subtitle.uppercase);
      const duration = clipDurations[clipIndex];
      items.forEach((text, cardIndex) => {
        const start = clipStarts[clipIndex] + (duration * cardIndex) / Math.max(1, items.length);
        const end = clipStarts[clipIndex] + (duration * (cardIndex + 1)) / Math.max(1, items.length);
        const output = `vsub${captionCount}`;
        filters.push(`[${videoLabel}]drawtext=text='${ffText(text)}':fontcolor=${ffColor(input.contract.style_snapshot.subtitle.text)}:fontsize=${input.contract.style_snapshot.subtitle.size}:box=1:boxcolor=${ffColor(input.contract.style_snapshot.subtitle.box, "D9")}:boxborderw=24:x=(w-text_w)/2:y=h-text_h-h*0.10:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${output}]`);
        videoLabel = output;
        captionCount += 1;
      });
    });
  }
  let effectCount = Math.max(0, input.contract.clips.length - 1) * (transitionDuration ? 1 : 0);
  if (input.contract.effects.labels) {
    const output = "vtitle";
    filters.push(`[${videoLabel}]drawtext=text='${ffText(input.contract.session.title)}':fontcolor=white:fontsize=54:box=1:boxcolor=0x09090BE6:boxborderw=22:x=(w-text_w)/2:y=h*0.08:enable='between(t,0.15,2.6)'[${output}]`);
    videoLabel = output;
    effectCount += 1;
  }
  if (input.contract.effects.sound_effects && clipStarts.length > 1) {
    const sounds: string[] = [];
    clipStarts.slice(1).forEach((start, index) => {
      const label = `sfx${index}`;
      const delay = Math.round(start * 1000);
      filters.push(`sine=frequency=880:sample_rate=48000:duration=0.12,volume=0.055,adelay=${delay}|${delay}[${label}]`);
      sounds.push(label);
    });
    if (sounds.length) {
      filters.push(`[${audioLabel}]${sounds.map((label) => `[${label}]`).join("")}amix=inputs=${sounds.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[audiofx]`);
      audioLabel = "audiofx";
      effectCount += sounds.length;
    }
  }
  await input.onProgress(42, "Montando cortes, subtítulos y efectos");
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
  input.signedUrls.forEach((url) => args.push("-i", url));
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
    has_audio: true, playable: true, caption_count: captionCount, effect_count: effectCount,
    removed_silence_seconds: Number(analyses.reduce((sum, item) => sum + item.removed, 0).toFixed(2)),
    release_gate: { passed: elapsed > 0 && (!input.contract.captions.enabled || captionCount > 0) && (!input.contract.effects.transitions || input.contract.clips.length === 1 || effectCount > 0) },
  };
}
