/** Real spoken timing of one recognized word, in source-media seconds. */
export type CueWord = { text: string; startSeconds: number; endSeconds: number };
/**
 * A caption card. `words` keeps the recognizer's per-word timing so the
 * kinetic-caption skill can show one word at a time in sync with the voice.
 * Imported SRT/VTT cues and cues whose text was edited may not have it.
 */
export type CaptionCue = { startSeconds: number; endSeconds: number; text: string; words?: CueWord[] };
type Range = { start: number; end: number };

export const MAX_WORDS_PER_CUE = 16;

/** Keep only finite, ordered word timings that fall inside the cue. */
export function sanitizeCueWords(words: unknown, cue: { startSeconds: number; endSeconds: number }): CueWord[] | undefined {
  if (!Array.isArray(words) || !words.length || words.length > MAX_WORDS_PER_CUE) return undefined;
  const result: CueWord[] = [];
  for (const word of words) {
    if (!word || typeof word !== "object") return undefined;
    const { text, startSeconds, endSeconds } = word as Record<string, unknown>;
    if (typeof text !== "string" || !text.trim() || text.length > 60 || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
    if (typeof startSeconds !== "number" || typeof endSeconds !== "number" || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return undefined;
    const start = Math.max(cue.startSeconds, startSeconds);
    const end = Math.min(cue.endSeconds, endSeconds);
    if (end < start || start < cue.startSeconds - .001 || startSeconds > cue.endSeconds) return undefined;
    if (result.length && start < result[result.length - 1].startSeconds) return undefined;
    result.push({ text: text.trim(), startSeconds: start, endSeconds: end });
  }
  return result;
}

/** Word timings stay valid only while the cue text still has the same words. */
export function cueWordsMatchText(cue: CaptionCue) {
  const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
  return Boolean(cue.words?.length) && cue.words!.length === tokens.length;
}

/** Re-label recognized timings after a text correction, or drop them when the word count changed. */
export function retimeEditedCue(cue: CaptionCue, text: string): CaptionCue {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const { words, ...rest } = cue;
  if (words?.length && words.length === tokens.length) {
    return { ...rest, text, words: words.map((word, index) => ({ ...word, text: tokens[index] })) };
  }
  return { ...rest, text };
}

/**
 * One side of a cue split at `cut`. With word timings the text follows the
 * words actually spoken on that side; without them only the time is clipped.
 */
export function splitCueAt(cue: CaptionCue, cut: number, side: "left" | "right"): CaptionCue {
  const startSeconds = side === "left" ? cue.startSeconds : Math.max(cut, cue.startSeconds);
  const endSeconds = side === "left" ? Math.min(cut, cue.endSeconds) : cue.endSeconds;
  if (!cueWordsMatchText(cue)) {
    const { words: _unused, ...rest } = cue;
    void _unused;
    return { ...rest, startSeconds, endSeconds };
  }
  const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
  const kept = cue.words!.map((word, index) => ({ ...word, text: tokens[index] }))
    .filter((word) => side === "left" ? word.startSeconds < cut : word.startSeconds >= cut)
    .map((word) => ({ ...word, startSeconds: Math.max(startSeconds, word.startSeconds), endSeconds: Math.min(endSeconds, word.endSeconds) }));
  if (!kept.length) return { startSeconds, endSeconds: startSeconds, text: "" };
  return { startSeconds, endSeconds, text: kept.map((word) => word.text).join(" "), words: kept };
}

/** Clip a cue's words to a new [start, end] window (manual trims and splits). */
export function clampCueWords(words: CueWord[] | undefined, start: number, end: number): CueWord[] | undefined {
  if (!words?.length) return undefined;
  const kept = words.filter((word) => word.endSeconds > start && word.startSeconds < end)
    .map((word) => ({ ...word, startSeconds: Math.max(start, word.startSeconds), endSeconds: Math.min(end, word.endSeconds) }));
  return kept.length ? kept : undefined;
}

function timestamp(raw: string) {
  const match = raw.trim().match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;
  const milliseconds = Number(match[4].padEnd(3, "0"));
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + milliseconds / 1000;
}

export function parseCaptionCues(source: string): CaptionCue[] {
  const blocks = source.replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n/, "").trim().split(/\n\s*\n/);
  const cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [from, toWithSettings] = lines[timingIndex].split("-->");
    const startSeconds = timestamp(from || "");
    const endSeconds = timestamp((toWithSettings || "").trim().split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "").trim();
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text) continue;
    cues.push({ startSeconds, endSeconds, text: text.slice(0, 250) });
    if (cues.length >= 100) break;
  }
  return cues.sort((a, b) => a.startSeconds - b.startSeconds);
}

/** Map source-media time to output time after trimming and silence removal. */
function editedTime(sourceSeconds: number, ranges: Range[]) {
  let elapsed = 0;
  for (const range of ranges) {
    if (sourceSeconds <= range.start) break;
    elapsed += Math.max(0, Math.min(sourceSeconds, range.end) - range.start);
  }
  return elapsed;
}

export function mapCaptionCues(cues: CaptionCue[], ranges: Range[]): CaptionCue[] {
  return cues.flatMap((cue) => {
    const startSeconds = editedTime(cue.startSeconds, ranges);
    const endSeconds = editedTime(cue.endSeconds, ranges);
    if (endSeconds - startSeconds <= .15) return [];
    if (!cue.words?.length) return [{ startSeconds, endSeconds, text: cue.text }];
    // A word whose whole sound was removed with a pause keeps no screen time.
    const words = cue.words.map((word) => ({
      text: word.text,
      startSeconds: editedTime(word.startSeconds, ranges),
      endSeconds: editedTime(word.endSeconds, ranges),
    }));
    return [{ startSeconds, endSeconds, text: cue.text, words }];
  });
}
