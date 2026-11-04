/** Stable, bounded Project workspace tabs. When the selected tool would
 * otherwise be hidden behind More, promote it to the last visible slot.
 * Do not add unavailable tools or invent extra navigation destinations. */
export function projectPrimaryTabIds<Id extends string>(
  available: readonly { id: Id }[],
  requested: readonly Id[],
  active: Id,
  limit = 6,
): Id[] {
  if (!Number.isInteger(limit) || limit < 1) return [];
  const allowed = new Set(available.map((item) => item.id));
  const unique = [...new Set(requested)].filter((id) => allowed.has(id));
  const primary = (unique.length ? unique : available.map((item) => item.id)).slice(0, limit);
  if (!allowed.has(active) || primary.includes(active)) return primary;
  if (primary.length < limit) primary.push(active);
  else primary[primary.length - 1] = active;
  return primary;
}
