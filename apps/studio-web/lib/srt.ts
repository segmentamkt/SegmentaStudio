/** Subtítulos en formato SRT a partir de los tiempos del video final (segundos). */
export type SrtCue = { start: number; end: number; text: string };

export function srtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)},${pad(ms, 3)}`;
}

export function buildSrt(cues: SrtCue[]): string {
  return cues
    .map((cue) => ({ ...cue, text: cue.text.replace(/\s+/g, " ").trim() }))
    .filter((cue) => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end - cue.start >= .05)
    .sort((left, right) => left.start - right.start)
    .map((cue, index) => `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text}\n`)
    .join("\n");
}
