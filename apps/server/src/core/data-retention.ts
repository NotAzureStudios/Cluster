export type RetentionCategoryKey =
  | "activity_events"
  | "persistence_audit_logs"
  | "expired_sessions"
  | "auth_challenges"
  | "sync_receipts"
  | "resolved_sync_conflicts"
  | "sync_tombstones"
  | "behavioral_analytics"
  | "notification_inbox";

export type RetentionPolicyDefinition = {
  key: RetentionCategoryKey;
  label: string;
  description: string;
  defaultDays: number;
  minimumDays: number;
  maximumDays: number;
};

export const DATA_RETENTION_SCHEMA_VERSION = 1;

export const CONFIGURABLE_RETENTION_POLICIES: readonly RetentionPolicyDefinition[] = [
  { key: "activity_events", label: "Activity history", description: "General activity-feed records. Security audit-chain evidence is not included.", defaultDays: 365, minimumDays: 30, maximumDays: 3650 },
  { key: "persistence_audit_logs", label: "Persistence history", description: "Operational persistence audit records used for troubleshooting and maintenance.", defaultDays: 365, minimumDays: 30, maximumDays: 3650 },
  { key: "expired_sessions", label: "Expired & revoked sessions", description: "Expired or explicitly revoked session history. Active sessions are never removed by retention.", defaultDays: 90, minimumDays: 7, maximumDays: 730 },
  { key: "auth_challenges", label: "Consumed authentication challenges", description: "Expired/consumed account-setup and Discord-link challenge records.", defaultDays: 30, minimumDays: 1, maximumDays: 180 },
  { key: "sync_receipts", label: "Offline sync receipts", description: "Completed offline-sync delivery receipts. Pending mutations are not stored here.", defaultDays: 30, minimumDays: 7, maximumDays: 365 },
  { key: "resolved_sync_conflicts", label: "Resolved sync conflicts", description: "Offline conflict records only after a user has resolved them. Open/quarantined conflicts remain protected.", defaultDays: 90, minimumDays: 30, maximumDays: 730 },
  { key: "sync_tombstones", label: "Sync deletion tombstones", description: "Deletion markers retained long enough for offline clients to observe removals.", defaultDays: 90, minimumDays: 30, maximumDays: 365 },
  { key: "behavioral_analytics", label: "Behavioral analytics", description: "Consent-gated first-party analytics events containing only coarse event/screen identifiers and client type.", defaultDays: 90, minimumDays: 7, maximumDays: 365 },
  { key: "notification_inbox", label: "Notification inbox", description: "Per-user work-inbox delivery and read/snooze state. Underlying authoritative work records are retained separately.", defaultDays: 180, minimumDays: 30, maximumDays: 730 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function clampDays(definition: RetentionPolicyDefinition, value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return definition.defaultDays;
  return Math.max(definition.minimumDays, Math.min(definition.maximumDays, Math.floor(number)));
}

export async function ensureRetentionPolicies(prisma: any) {
  for (const definition of CONFIGURABLE_RETENTION_POLICIES) {
    const defaultDays = definition.defaultDays;
    await prisma.dataRetentionPolicy.upsert({
      where: { category: definition.key },
      create: { category: definition.key, enabled: true, retentionDays: defaultDays, schemaVersion: DATA_RETENTION_SCHEMA_VERSION },
      update: {},
    });
  }
}

export async function readRetentionPolicies(prisma: any) {
  await ensureRetentionPolicies(prisma);
  const rows = await prisma.dataRetentionPolicy.findMany({ orderBy: { category: "asc" } });
  const byCategory = new Map(rows.map((row: any) => [String(row.category), row]));
  return CONFIGURABLE_RETENTION_POLICIES.map((definition) => {
    const row: any = byCategory.get(definition.key);
    return {
      ...definition,
      enabled: row?.enabled !== false,
      retentionDays: clampDays(definition, row?.retentionDays),
      updatedAt: row?.updatedAt || null,
      updatedById: row?.updatedById || null,
    };
  });
}

export async function updateRetentionPolicies(prisma: any, input: Array<{ category: string; enabled?: boolean; retentionDays?: number }>, actorUserId?: string | null) {
  const definitions = new Map(CONFIGURABLE_RETENTION_POLICIES.map((definition) => [definition.key, definition]));
  const seen = new Set<string>();
  const operations: any[] = [];
  for (const item of input) {
    const definition = definitions.get(item.category as RetentionCategoryKey);
    if (!definition) throw Object.assign(new Error(`Unknown retention category: ${item.category}`), { statusCode: 400, code: "RETENTION_CATEGORY_INVALID" });
    if (seen.has(item.category)) throw Object.assign(new Error(`Duplicate retention category: ${item.category}`), { statusCode: 400, code: "RETENTION_CATEGORY_INVALID" });
    seen.add(item.category);
    const requestedDays = Number(item.retentionDays);
    if (!Number.isInteger(requestedDays) || requestedDays < definition.minimumDays || requestedDays > definition.maximumDays) {
      throw Object.assign(new Error(`${definition.label} retention must be between ${definition.minimumDays} and ${definition.maximumDays} days.`), { statusCode: 400, code: "RETENTION_CATEGORY_INVALID" });
    }
    operations.push(prisma.dataRetentionPolicy.upsert({
      where: { category: definition.key },
      create: { category: definition.key, enabled: item.enabled !== false, retentionDays: requestedDays, updatedById: actorUserId || null, schemaVersion: DATA_RETENTION_SCHEMA_VERSION },
      update: { enabled: item.enabled !== false, retentionDays: requestedDays, updatedById: actorUserId || null, schemaVersion: DATA_RETENTION_SCHEMA_VERSION },
    }));
  }
  if (operations.length) await prisma.$transaction(operations);
}

function cutoff(days: number, now: Date) {
  return new Date(now.getTime() - Math.max(1, days) * DAY_MS);
}

async function categoryCounts(prisma: any, category: RetentionCategoryKey, cutoffAt: Date) {
  switch (category) {
    case "activity_events": return { total: await prisma.activityEvent.count(), eligible: await prisma.activityEvent.count({ where: { createdAt: { lt: cutoffAt } } }) };
    case "persistence_audit_logs": return { total: await prisma.persistenceAuditLog.count(), eligible: await prisma.persistenceAuditLog.count({ where: { createdAt: { lt: cutoffAt } } }) };
    case "expired_sessions": return {
      total: await prisma.session.count(),
      eligible: await prisma.session.count({ where: { OR: [{ expiresAt: { lt: cutoffAt } }, { revokedAt: { lt: cutoffAt } }] } }),
    };
    case "auth_challenges": return {
      total: await prisma.discordLinkChallenge.count(),
      eligible: await prisma.discordLinkChallenge.count({ where: { OR: [{ expiresAt: { lt: cutoffAt } }, { consumedAt: { lt: cutoffAt } }] } }),
    };
    case "sync_receipts": return { total: await prisma.clusterSyncReceipt.count(), eligible: await prisma.clusterSyncReceipt.count({ where: { createdAt: { lt: cutoffAt } } }) };
    case "resolved_sync_conflicts": return { total: await prisma.clusterSyncConflict.count(), eligible: await prisma.clusterSyncConflict.count({ where: { status: "RESOLVED", resolvedAt: { lt: cutoffAt } } }) };
    case "sync_tombstones": return { total: await prisma.syncTombstone.count(), eligible: await prisma.syncTombstone.count({ where: { deletedAt: { lt: cutoffAt } } }) };
    case "behavioral_analytics": return { total: await prisma.behavioralAnalyticsEvent.count(), eligible: await prisma.behavioralAnalyticsEvent.count({ where: { createdAt: { lt: cutoffAt } } }) };
    case "notification_inbox": return { total: await prisma.notificationInboxItem.count(), eligible: await prisma.notificationInboxItem.count({ where: { createdAt: { lt: cutoffAt } } }) };
  }
}

export async function retentionPreview(prisma: any, now = new Date()) {
  const policies = await readRetentionPolicies(prisma);
  const rows = [];
  for (const policy of policies) {
    const cutoffAt = cutoff(policy.retentionDays, now);
    const counts = await categoryCounts(prisma, policy.key, cutoffAt);
    rows.push({ ...policy, cutoff: cutoffAt.toISOString(), totalCount: counts.total, eligibleCount: policy.enabled ? counts.eligible : 0, wouldDelete: policy.enabled ? counts.eligible : 0 });
  }
  return rows;
}

export async function applyRetentionPolicies(prisma: any, options: { actorUserId?: string | null; trigger?: string; now?: Date } = {}) {
  const now = options.now || new Date();
  const preview = await retentionPreview(prisma, now);
  const run = await prisma.dataRetentionRun.create({
    data: { mode: "apply", trigger: options.trigger || "manual", actorUserId: options.actorUserId || null, status: "running", schemaVersion: DATA_RETENTION_SCHEMA_VERSION, resultJson: "{}" },
  });
  try {
    const operations: any[] = [];
    const operationKeys: RetentionCategoryKey[] = [];
    for (const row of preview) {
      if (!row.enabled || row.eligibleCount <= 0) continue;
      const cutoffAt = new Date(row.cutoff);
      switch (row.key as RetentionCategoryKey) {
        case "activity_events": operations.push(prisma.activityEvent.deleteMany({ where: { createdAt: { lt: cutoffAt } } })); break;
        case "persistence_audit_logs": operations.push(prisma.persistenceAuditLog.deleteMany({ where: { createdAt: { lt: cutoffAt } } })); break;
        case "expired_sessions": operations.push(prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoffAt } }, { revokedAt: { lt: cutoffAt } }] } })); break;
        case "auth_challenges": operations.push(prisma.discordLinkChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoffAt } }, { consumedAt: { lt: cutoffAt } }] } })); break;
        case "sync_receipts": operations.push(prisma.clusterSyncReceipt.deleteMany({ where: { createdAt: { lt: cutoffAt } } })); break;
        case "resolved_sync_conflicts": operations.push(prisma.clusterSyncConflict.deleteMany({ where: { status: "RESOLVED", resolvedAt: { lt: cutoffAt } } })); break;
        case "sync_tombstones": operations.push(prisma.syncTombstone.deleteMany({ where: { deletedAt: { lt: cutoffAt } } })); break;
        case "behavioral_analytics": operations.push(prisma.behavioralAnalyticsEvent.deleteMany({ where: { createdAt: { lt: cutoffAt } } })); break;
        case "notification_inbox": operations.push(prisma.notificationInboxItem.deleteMany({ where: { createdAt: { lt: cutoffAt } } })); break;
      }
      operationKeys.push(row.key as RetentionCategoryKey);
    }
    const results = operations.length ? await prisma.$transaction(operations) : [];
    const deletedByCategory: Record<string, number> = Object.fromEntries(CONFIGURABLE_RETENTION_POLICIES.map((definition) => [definition.key, 0]));
    results.forEach((result: any, index: number) => { deletedByCategory[operationKeys[index]] = (deletedByCategory[operationKeys[index]] || 0) + Number(result?.count || 0); });
    const totalDeleted = Object.values(deletedByCategory).reduce((sum, count) => sum + count, 0);
    const result = { schemaVersion: DATA_RETENTION_SCHEMA_VERSION, completedAt: new Date().toISOString(), totalDeleted, deletedByCategory, preview };
    await prisma.dataRetentionRun.update({ where: { id: run.id }, data: { status: "complete", completedAt: new Date(), resultJson: JSON.stringify(result) } });
    return { runId: run.id, ...result };
  } catch (error) {
    await prisma.dataRetentionRun.update({ where: { id: run.id }, data: { status: "failed", completedAt: new Date(), resultJson: JSON.stringify({ error: error instanceof Error ? error.message : "Retention failed" }) } }).catch(() => undefined);
    throw error;
  }
}

export async function dataInventorySnapshot(prisma: any, settings: any) {
  const policies = await retentionPreview(prisma);
  const [securityAuditEvents, legalPolicies, policyAcceptances, privacyRequests, projects, projectFiles, users, backupsDelegated] = await Promise.all([
    prisma.securityAuditEvent.count(),
    prisma.legalPolicyVersion.count(),
    prisma.policyAcceptance.count(),
    prisma.privacyDataRequest.count(),
    prisma.project.count(),
    prisma.projectFile.count(),
    prisma.user.count(),
    Promise.resolve(Number(settings?.backupRetentionDays || 14)),
  ]);
  return {
    schemaVersion: DATA_RETENTION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    configurable: policies,
    protected: [
      { key: "security_audit_events", label: "Security audit trail", count: securityAuditEvents, retention: "protected", reason: "Append-only tamper-evident security evidence is excluded from generic retention." },
      { key: "legal_policy_versions", label: "Legal policy versions", count: legalPolicies, retention: "protected", reason: "Published policy history is immutable evidence and is not automatically erased." },
      { key: "policy_acceptances", label: "Policy acceptance evidence", count: policyAcceptances, retention: "protected", reason: "Auditable acknowledgement/acceptance evidence is excluded from generic age-based cleanup; deletion or anonymization requires an explicit legal/operator workflow." },
      { key: "privacy_requests", label: "Privacy request evidence", count: privacyRequests, retention: "manual", reason: "Request evidence may be subject to legal or operator retention obligations." },
      { key: "core_work_records", label: "Users & project work", count: users + projects, retention: "manual", reason: "Authoritative account/project records are not subject to unattended age-based deletion." },
      { key: "authoritative_uploads", label: "Project file records", count: projectFiles, retention: "manual", reason: "Authoritative project files follow explicit project/file deletion workflows, not generic retention." },
    ],
    delegated: [
      { key: "backup_generations", label: "Backup generations", retentionDays: backupsDelegated, retention: "backup-policy", reason: "Managed by the signed backup-generation retention system, which preserves at least three committed generations." },
      { key: "mutation_receipts", label: "Mutation receipts", retentionDays: 7, retention: "protocol-fixed", reason: "Step 11 idempotency receipts use a fixed seven-day safety window." },
      { key: "upload_staging", label: "Upload staging", retentionDays: 7, retention: "protocol-fixed", reason: "Incomplete resumable upload staging is temporary and pruned independently." },
    ],
  };
}
