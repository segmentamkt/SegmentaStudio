type DurationClip = {
  takeId: string;
  duration: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
};

/** Only call for source media whose stored duration was unknown. Preserve every other edit. */
export function repairUnknownTimelineDuration<T extends DurationClip>(clips: T[], takeId: string, duration: number): T[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Duración del video no válida.");
  return clips.map((clip) => {
    if (clip.takeId !== takeId) return clip;
    const placeholder = clip.duration <= .2 && clip.trimStartSeconds === 0 && clip.trimEndSeconds <= .2;
    return { ...clip, duration,
      trimStartSeconds: Math.min(clip.trimStartSeconds, Math.max(0, duration - .2)),
      trimEndSeconds: placeholder ? duration : Math.min(duration, clip.trimEndSeconds),
    };
  });
}
