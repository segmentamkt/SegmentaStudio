export type CaptionCue = { startSeconds: number; endSeconds: number; text: string };
type Range = { start: number; end: number };

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

export function mapCaptionCues(cues: CaptionCue[], ranges: Range[]) {
  return cues.flatMap((cue) => {
    const startSeconds = editedTime(cue.startSeconds, ranges);
    const endSeconds = editedTime(cue.endSeconds, ranges);
    return endSeconds - startSeconds > .15 ? [{ startSeconds, endSeconds, text: cue.text }] : [];
  });
}
