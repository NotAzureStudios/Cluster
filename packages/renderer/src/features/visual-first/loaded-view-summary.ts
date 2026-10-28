/** Visual summaries of *loaded* authorized rows only. No network reads or inferred history. */
export function summarizeLoadedAssets(rows: readonly { status: string; kind: string }[]) {
  const active = rows.filter((row) => row.status === "active").length;
  const retired = rows.filter((row) => row.status === "retired").length;
  const categories = new Map<string, number>();
  for (const row of rows) {
    const kind = row.kind.trim().toLowerCase() || "unknown";
    categories.set(kind, (categories.get(kind) || 0) + 1);
  }
  return {
    total: rows.length,
    active,
    retired,
    other: rows.length - active - retired,
    kinds: [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, value]) => ({ id, label: id.replaceAll("_", " "), value })),
  };
}

export function summarizeLoadedProjectHealth(rows: readonly { health: { tone: string }; completeness: number }[]) {
  const healthy = rows.filter((row) => row.health.tone === "good").length;
  const attention = rows.length - healthy;
  const finite = rows.map((row) => row.completeness).filter((value) => Number.isFinite(value));
  const averageReadiness = finite.length
    ? Math.round(finite.reduce((sum, value) => sum + Math.min(100, Math.max(0, value)), 0) / finite.length)
    : null;
  return { total: rows.length, healthy, attention, averageReadiness };
}
