/** Move within one visible list while preserving the slots of takes outside it. */
export function reorderReviewTakes(order: string[], visibleIds: string[], draggedId: string, targetId: string, edge: "before" | "after") {
  const visible = new Set(visibleIds);
  const sequence = order.filter((id) => visible.has(id));
  if (draggedId === targetId || !sequence.includes(draggedId) || !sequence.includes(targetId)) return order;
  const next = sequence.filter((id) => id !== draggedId);
  next.splice(next.indexOf(targetId) + (edge === "after" ? 1 : 0), 0, draggedId);
  let index = 0;
  return order.map((id) => visible.has(id) ? next[index++] : id);
}
