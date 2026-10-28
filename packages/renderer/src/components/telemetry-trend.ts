/** A bounded local chart history. Does not trigger requests or retain user data. */
export type TrendSample = { at: number; requestP95Ms: number | null; databaseP95Ms: number | null };

export function appendTrendSample(history: TrendSample[], incoming: TrendSample, limit = 60): TrendSample[] {
  if (!Number.isFinite(incoming.at) || incoming.at <= 0) return history;
  const normalize = (value: number | null) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const sample = { at: incoming.at, requestP95Ms: normalize(incoming.requestP95Ms), databaseP95Ms: normalize(incoming.databaseP95Ms) };
  const previous = history[history.length - 1];
  // Cached responses repeat the same generatedAt. They must not create fake
  // time-series samples whenever a component remounts or refreshes.
  if (previous && incoming.at <= previous.at) return history;
  return [...history.slice(-(Math.max(1, limit) - 1)), sample];
}
