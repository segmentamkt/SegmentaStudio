/** A short sample of a completed scene, never a claim that the final MP4 is ready. */
export type RenderPreview = {
  clipIndex: number;
  totalClips: number;
  takeId: string;
  title: string;
  videoDataUrl: string;
  durationSeconds: number;
  captionCount: number;
  soundEffectCount: number;
  removedSilenceSeconds: number;
};

// Twelve maximum-sized samples remain below 4.5 MB even after base64 encoding.
export const MAX_RENDER_PREVIEW_BYTES = 256 * 1024;
const PREFIX = "data:video/mp4;base64,";

/** Keep remote URLs, oversized media and malformed progress out of the player. */
export function parseRenderPreview(value: unknown): RenderPreview | null {
  if (!value || typeof value !== "object") return null;
  const preview = value as Record<string, unknown>;
  if (!Number.isInteger(preview.clipIndex) || !Number.isInteger(preview.totalClips)
    || Number(preview.totalClips) < 1 || Number(preview.totalClips) > 12
    || Number(preview.clipIndex) < 0 || Number(preview.clipIndex) >= Number(preview.totalClips)) return null;
  if (typeof preview.takeId !== "string" || !preview.takeId || preview.takeId.length > 256
    || typeof preview.title !== "string" || preview.title.length > 200) return null;
  if (typeof preview.videoDataUrl !== "string" || !preview.videoDataUrl.startsWith(PREFIX)) return null;
  const encoded = preview.videoDataUrl.slice(PREFIX.length);
  if (!encoded || encoded.length > Math.ceil(MAX_RENDER_PREVIEW_BYTES / 3) * 4
    || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  if (typeof preview.durationSeconds !== "number" || !Number.isFinite(preview.durationSeconds)
    || preview.durationSeconds <= 0 || preview.durationSeconds > 3) return null;
  for (const key of ["captionCount", "soundEffectCount"] as const) {
    if (!Number.isInteger(preview[key]) || Number(preview[key]) < 0 || Number(preview[key]) > 100) return null;
  }
  if (typeof preview.removedSilenceSeconds !== "number" || !Number.isFinite(preview.removedSilenceSeconds)
    || preview.removedSilenceSeconds < 0 || preview.removedSilenceSeconds > 120) return null;
  return preview as RenderPreview;
}
