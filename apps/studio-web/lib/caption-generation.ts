import type { CaptionCue } from "./caption-cues";

export type CaptionGenerationClip = {
  segmentId: string;
  takeId: string;
  included: boolean;
  duration: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  transcript: string;
  captionCues: CaptionCue[];
};

export type CaptionGenerationTarget = {
  takeId: string;
  durationSeconds: number;
  segments: Array<{ segmentId: string; signature: string }>;
};

function captionSignature(clip: CaptionGenerationClip) {
  return JSON.stringify([
    clip.takeId, clip.included, clip.duration, clip.trimStartSeconds, clip.trimEndSeconds,
    clip.transcript, clip.captionCues,
  ]);
}

/** Transcribe a source once, while retaining the exact segments the user requested. */
export function getCaptionGenerationTargets(
  timeline: CaptionGenerationClip[],
  input: { scope: "missing" | "selected"; selectedSegmentId?: string },
): CaptionGenerationTarget[] {
  const targets = new Map<string, CaptionGenerationTarget>();
  for (const clip of timeline) {
    const selected = input.scope === "selected"
      ? clip.segmentId === input.selectedSegmentId
      : clip.included && !clip.captionCues.length;
    if (!selected) continue;
    const target = targets.get(clip.takeId) || { takeId: clip.takeId, durationSeconds: clip.duration, segments: [] };
    target.durationSeconds = Math.max(target.durationSeconds, clip.duration);
    target.segments.push({ segmentId: clip.segmentId, signature: captionSignature(clip) });
    targets.set(clip.takeId, target);
  }
  return [...targets.values()];
}

/** Apply only requested, unchanged segments. Captions retain source-media timestamps. */
export function mergeCaptionGenerationResult<T extends CaptionGenerationClip>(
  timeline: T[],
  target: CaptionGenerationTarget,
  result: { captionCues: CaptionCue[] },
) {
  const requested = new Map(target.segments.map((segment) => [segment.segmentId, segment.signature]));
  const updatedSegmentIds: string[] = [];
  const skippedSegmentIds: string[] = [];
  const failedSegments: Array<{ segmentId: string; message: string }> = [];
  const seen = new Set<string>();
  const next = timeline.map((clip) => {
    const signature = requested.get(clip.segmentId);
    if (signature === undefined) return clip;
    seen.add(clip.segmentId);
    if (clip.takeId !== target.takeId || captionSignature(clip) !== signature) {
      skippedSegmentIds.push(clip.segmentId);
      return clip;
    }
    const start = Math.max(0, clip.trimStartSeconds);
    const end = Math.min(clip.duration, clip.trimEndSeconds);
    const captionCues = result.captionCues
      .filter((cue) => Number.isFinite(cue.startSeconds) && Number.isFinite(cue.endSeconds) && cue.text.trim())
      .map((cue) => ({
        startSeconds: Math.max(start, cue.startSeconds),
        endSeconds: Math.min(end, cue.endSeconds),
        text: cue.text.trim(),
      }))
      .filter((cue) => cue.endSeconds - cue.startSeconds >= .1)
      .sort((left, right) => left.startSeconds - right.startSeconds);
    const transcript = captionCues.map((cue) => cue.text).join(" ");
    const message = !captionCues.length
      ? "No se detectó voz con tiempos dentro del recorte de este segmento. Puedes ajustar el recorte o importar SRT/VTT."
      : captionCues.length > 100 || captionCues.some((cue) => cue.text.length > 250) || transcript.length > 1_000
        ? "Este segmento contiene demasiado texto. Divídelo en partes más cortas antes de generar sus subtítulos."
        : "";
    if (message) {
      failedSegments.push({ segmentId: clip.segmentId, message });
      return clip;
    }
    updatedSegmentIds.push(clip.segmentId);
    return { ...clip, transcript, captionCues };
  });
  for (const segmentId of requested.keys()) if (!seen.has(segmentId)) skippedSegmentIds.push(segmentId);
  return { timeline: updatedSegmentIds.length ? next : timeline, updatedSegmentIds, skippedSegmentIds, failedSegments };
}
