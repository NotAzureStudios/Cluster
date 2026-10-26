export async function recordEfficiencyMetric(prisma: any, key: string, bytes = 0, operations = 1) {
  const normalized = String(key || "").trim().replace(/[^a-z0-9:_-]+/gi, "_").slice(0, 120);
  if (!normalized) return null;
  const boundedBytes = BigInt(Math.max(0, Math.trunc(Number.isFinite(bytes) ? bytes : 0)));
  const boundedOperations = BigInt(Math.max(0, Math.trunc(Number.isFinite(operations) ? operations : 0)));
  return prisma.efficiencyMetric.upsert({
    where: { key: normalized },
    update: { bytes: { increment: boundedBytes }, operations: { increment: boundedOperations } },
    create: { key: normalized, bytes: boundedBytes, operations: boundedOperations },
  });
}

export async function efficiencyMetricsSnapshot(prisma: any) {
  const rows = await prisma.efficiencyMetric.findMany({ orderBy: { key: "asc" }, take: 100 }).catch(() => []);
  return {
    metrics: rows.map((row: any) => ({
      key: row.key,
      operations: String(row.operations || 0),
      bytes: String(row.bytes || 0),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    })),
  };
}
