/** A newly confirmed review replaces the source order, while keeping cuts and text edits. */
export function alignReviewedTimeline<T extends { takeId: string; included: boolean }>(clips: T[], orderedTakeIds: string[]): T[] {
  const rank = new Map(orderedTakeIds.map((id, index) => [id, index]));
  const activeTakes = new Set(clips.filter((clip) => clip.included).map((clip) => clip.takeId));
  return clips.filter((clip) => rank.has(clip.takeId))
    .map((clip) => {
      // Keep excluded portions of a split take excluded. An explicitly reapproved
      // take that was entirely off needs only its first saved segment restored.
      const included = clip.included || !activeTakes.has(clip.takeId);
      if (included) activeTakes.add(clip.takeId);
      return { ...clip, included };
    })
    .sort((a, b) => rank.get(a.takeId)! - rank.get(b.takeId)!);
}
