export type SchedulableBlock = { id: string; startsAt: string };

export function mergeScheduleBlocks<T extends SchedulableBlock>(current: readonly T[], updates: readonly T[]): T[] {
  if (!updates.length) return current.slice();
  const updatedIds = new Set(updates.map((block) => block.id));
  const next = current.filter((block) => !updatedIds.has(block.id));
  next.push(...updates);
  next.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return next;
}
