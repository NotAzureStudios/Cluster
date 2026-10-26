export type OperatorAlertSeverity = "critical" | "warning" | "info";
export type OperatorAlert = {
  id: string;
  severity: OperatorAlertSeverity;
  area: "runtime" | "database" | "storage" | "jobs" | "sync" | "media" | "audit" | "events";
  title: string;
  detail: string;
  action?: "server-config" | "maintenance" | "reports";
};

type SnapshotInput = {
  operational?: { ready?: boolean; state?: string; checks?: Array<{ key?: string; status?: string; detail?: string }> };
  performance?: { status?: string; failures?: number; warnings?: number };
  postgres?: { connections?: { lockWaits?: number }; workload?: { cacheHitRatio?: number; deadRowRatio?: number; temporaryBytes?: number } };
  storage?: { ok?: boolean; failures?: Array<{ key?: string; error?: string }> };
  backgroundTasks?: Array<{ key?: string; name?: string; consecutiveFailures?: number; lastError?: string | null }>;
  jobs?: { counts?: { queued?: number; running?: number; failed?: number; deadLetter?: number }; pressure?: { oldestQueuedAgeMs?: number | null; stalledLeases?: number; byQueue?: Array<{ queue: string; queued: number; running: number; failed: number; deadLetter: number }> } };
  sync?: { devices?: { total?: number; active15m?: number; stale7d?: number }; openConflicts?: number; failedReceipts24h?: number };
  media?: { workers?: { total?: number; online?: number; active?: number }; queue?: { queued?: number; running?: number; failed?: number; deadLetter?: number } };
  audit?: { ok?: boolean; writeFailures?: number; checked?: number; error?: string | null };
  events?: { consumerFailures?: number; deadLettered?: number };
  automation?: { queued?: number; running?: number; failed?: number; deadLetter?: number; disabledRules?: number; draftRules?: number };
  backup?: { enabled?: boolean; latestCreatedAt?: string | null; latestVerified?: boolean | null; latestVerificationOk?: boolean | null; latestRestoreDrillAt?: string | null; retentionDays?: number; generationCount?: number };
  security?: { failures24h?: number; privilegedFailures24h?: number };
};

const severityRank: Record<OperatorAlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

export function buildOperatorAlerts(input: SnapshotInput): OperatorAlert[] {
  const alerts: OperatorAlert[] = [];
  const push = (alert: OperatorAlert) => alerts.push(alert);
  const checks = input.operational?.checks || [];
  for (const check of checks) {
    if (check.status === "fail") push({ id: `health:${check.key || "unknown"}`, severity: "critical", area: check.key === "database" ? "database" : check.key === "storage" ? "storage" : "runtime", title: `${check.key || "Runtime"} health failed`, detail: check.detail || "A critical operational health check failed.", action: check.key === "database" || check.key === "storage" ? "maintenance" : "server-config" });
    else if (check.status === "warn") push({ id: `health:${check.key || "unknown"}`, severity: "warning", area: check.key === "database" ? "database" : check.key === "storage" ? "storage" : "runtime", title: `${check.key || "Runtime"} health needs review`, detail: check.detail || "An operational health check is outside its preferred range.", action: check.key === "database" || check.key === "storage" ? "maintenance" : "server-config" });
  }
  if ((input.performance?.failures || 0) > 0) push({ id: "performance:fail", severity: "critical", area: "runtime", title: "Performance budgets are failing", detail: `${input.performance?.failures || 0} server performance budget${input.performance?.failures === 1 ? " is" : "s are"} outside the release threshold.`, action: "maintenance" });
  else if ((input.performance?.warnings || 0) > 0) push({ id: "performance:warn", severity: "warning", area: "runtime", title: "Performance pressure is elevated", detail: `${input.performance?.warnings || 0} performance budget${input.performance?.warnings === 1 ? " is" : "s are"} in warning range.`, action: "maintenance" });

  const lockWaits = Number(input.postgres?.connections?.lockWaits || 0);
  if (lockWaits > 0) push({ id: "postgres:locks", severity: lockWaits >= 5 ? "critical" : "warning", area: "database", title: "PostgreSQL lock waits detected", detail: `${lockWaits} current lock wait${lockWaits === 1 ? "" : "s"} can delay workspace mutations.`, action: "maintenance" });
  const hitRatio = input.postgres?.workload?.cacheHitRatio;
  if (hitRatio != null && hitRatio < 0.9) push({ id: "postgres:cache", severity: "warning", area: "database", title: "Database cache hit ratio is low", detail: `Current cache hit ratio is ${(hitRatio * 100).toFixed(1)}%.`, action: "maintenance" });
  const deadRatio = input.postgres?.workload?.deadRowRatio;
  if (deadRatio != null && deadRatio >= 0.15) push({ id: "postgres:dead-rows", severity: "warning", area: "database", title: "Dead-row pressure is elevated", detail: `${(deadRatio * 100).toFixed(1)}% dead-row ratio may warrant database maintenance.`, action: "maintenance" });

  if (input.storage?.ok === false) push({ id: "storage:writable", severity: "critical", area: "storage", title: "Critical storage is not writable", detail: `${input.storage.failures?.length || 1} storage probe${input.storage.failures?.length === 1 ? "" : "s"} failed.`, action: "maintenance" });

  const failedTasks = (input.backgroundTasks || []).filter((task) => Number(task.consecutiveFailures || 0) >= 3);
  if (failedTasks.length) push({ id: "tasks:failures", severity: failedTasks.some((task) => Number(task.consecutiveFailures || 0) >= 8) ? "critical" : "warning", area: "jobs", title: "Background task failures are repeating", detail: `${failedTasks.length} scheduled task${failedTasks.length === 1 ? " has" : "s have"} a sustained failure streak.`, action: "maintenance" });

  const jobCounts = input.jobs?.counts || {};
  if ((jobCounts.deadLetter || 0) > 0) push({ id: "jobs:dead-letter", severity: "critical", area: "jobs", title: "Dead-letter jobs require review", detail: `${jobCounts.deadLetter} background job${jobCounts.deadLetter === 1 ? " is" : "s are"} no longer retrying automatically.`, action: "maintenance" });
  else if ((jobCounts.failed || 0) > 0) push({ id: "jobs:failed", severity: "warning", area: "jobs", title: "Background jobs failed", detail: `${jobCounts.failed} failed job${jobCounts.failed === 1 ? "" : "s"} are retained for operator review.`, action: "maintenance" });
  const oldestAge = Number(input.jobs?.pressure?.oldestQueuedAgeMs || 0);
  if (oldestAge >= 15 * 60_000) push({ id: "jobs:age", severity: oldestAge >= 60 * 60_000 ? "critical" : "warning", area: "jobs", title: "Background queue is aging", detail: `The oldest runnable queued job has waited about ${minutes(oldestAge)} minutes.`, action: "maintenance" });
  if ((input.jobs?.pressure?.stalledLeases || 0) > 0) push({ id: "jobs:leases", severity: "critical", area: "jobs", title: "Expired job leases detected", detail: `${input.jobs?.pressure?.stalledLeases || 0} running job lease${input.jobs?.pressure?.stalledLeases === 1 ? " has" : "s have"} expired and may need worker recovery.`, action: "maintenance" });

  if ((input.sync?.openConflicts || 0) > 0) push({ id: "sync:conflicts", severity: "warning", area: "sync", title: "Open sync conflicts remain", detail: `${input.sync?.openConflicts || 0} unresolved synchronization conflict${input.sync?.openConflicts === 1 ? "" : "s"} remain across the client fleet.`, action: "reports" });
  if ((input.sync?.failedReceipts24h || 0) >= 10) push({ id: "sync:failures", severity: "warning", area: "sync", title: "Sync replay failures are elevated", detail: `${input.sync?.failedReceipts24h || 0} failed sync replay receipts were recorded in the last 24 hours.`, action: "reports" });
  if ((input.sync?.devices?.stale7d || 0) > 0) push({ id: "sync:stale-devices", severity: "info", area: "sync", title: "Stale client registrations exist", detail: `${input.sync?.devices?.stale7d || 0} registered client${input.sync?.devices?.stale7d === 1 ? " has" : "s have"} not checked in for at least seven days.`, action: "reports" });

  const mediaQueue = input.media?.queue || {};
  const workers = input.media?.workers || {};
  if ((mediaQueue.queued || 0) > 0 && (workers.online || 0) === 0) push({ id: "media:no-workers", severity: "critical", area: "media", title: "Media work is queued without an online worker", detail: `${mediaQueue.queued || 0} media job${mediaQueue.queued === 1 ? " is" : "s are"} waiting while no media worker is online.`, action: "maintenance" });
  if ((mediaQueue.deadLetter || 0) > 0 || (mediaQueue.failed || 0) > 0) push({ id: "media:failed", severity: (mediaQueue.deadLetter || 0) > 0 ? "critical" : "warning", area: "media", title: "Media processing needs review", detail: `${mediaQueue.failed || 0} failed and ${mediaQueue.deadLetter || 0} dead-letter media jobs are retained.`, action: "maintenance" });

  if (input.audit?.ok === false) push({ id: "audit:integrity", severity: "critical", area: "audit", title: "Security audit integrity check failed", detail: input.audit.error || "The tamper-evident audit chain did not verify.", action: "reports" });
  else if ((input.audit?.writeFailures || 0) > 0) push({ id: "audit:writes", severity: "critical", area: "audit", title: "Security audit writes have failed", detail: `${input.audit?.writeFailures || 0} audit write failure${input.audit?.writeFailures === 1 ? " has" : "s have"} been observed since server start.`, action: "reports" });
  if ((input.events?.deadLettered || 0) > 0) push({ id: "events:dead-letter", severity: "critical", area: "events", title: "Durable domain events reached dead letter", detail: `${input.events?.deadLettered || 0} domain event${input.events?.deadLettered === 1 ? " is" : "s are"} no longer retrying automatically.`, action: "maintenance" });
  else if ((input.events?.consumerFailures || 0) > 0) push({ id: "events:failed", severity: "warning", area: "events", title: "Domain event delivery failures detected", detail: `${input.events?.consumerFailures || 0} consumer failure${input.events?.consumerFailures === 1 ? " has" : "s have"} been observed since server start.`, action: "maintenance" });

  const automation = input.automation || {};
  if ((automation.deadLetter || 0) > 0) push({ id: "automation:dead-letter", severity: "critical", area: "jobs", title: "Automation work reached dead letter", detail: `${automation.deadLetter || 0} automation action${automation.deadLetter === 1 ? " is" : "s are"} no longer retrying automatically.`, action: "maintenance" });
  else if ((automation.failed || 0) > 0) push({ id: "automation:failed", severity: "warning", area: "jobs", title: "Automation actions failed", detail: `${automation.failed || 0} failed automation action${automation.failed === 1 ? "" : "s"} remain available for retry and inspection.`, action: "maintenance" });

  const backup = input.backup || {};
  if (backup.enabled === false) push({ id: "backup:disabled", severity: "warning", area: "storage", title: "Scheduled backups are disabled", detail: "No automatic backup schedule is enabled for this Cluster server.", action: "server-config" });
  if (backup.enabled !== false && !backup.latestCreatedAt) push({ id: "backup:missing", severity: "critical", area: "storage", title: "No backup generation is available", detail: "Backup scheduling is enabled but no recoverable generation is present.", action: "maintenance" });
  if (backup.latestCreatedAt) {
    const ageMs = Date.now() - new Date(backup.latestCreatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 72 * 60 * 60_000) push({ id: "backup:stale", severity: ageMs >= 7 * 24 * 60 * 60_000 ? "critical" : "warning", area: "storage", title: "Latest backup is stale", detail: `The newest backup generation is about ${Math.max(3, Math.round(ageMs / 3_600_000))} hours old.`, action: "maintenance" });
  }
  if (backup.latestVerificationOk === false) push({ id: "backup:verification", severity: "critical", area: "storage", title: "Latest backup verification failed", detail: "The newest backup generation did not pass its recorded verification posture.", action: "maintenance" });
  if (backup.latestCreatedAt && !backup.latestRestoreDrillAt) push({ id: "backup:no-drill", severity: "info", area: "storage", title: "No recent restore drill is recorded", detail: "Backups exist, but the operator history does not contain a successful restore drill yet.", action: "maintenance" });

  if ((input.security?.privilegedFailures24h || 0) >= 5) push({ id: "security:privileged-failures", severity: "warning", area: "audit", title: "Privileged operation failures are elevated", detail: `${input.security?.privilegedFailures24h || 0} failed privileged security events were recorded in the last 24 hours.`, action: "reports" });

  const deduped = new Map<string, OperatorAlert>();
  for (const alert of alerts) if (!deduped.has(alert.id)) deduped.set(alert.id, alert);
  return [...deduped.values()].sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.area.localeCompare(b.area) || a.title.localeCompare(b.title)).slice(0, 24);
}

export function operatorPosture(alerts: OperatorAlert[]) {
  if (alerts.some((alert) => alert.severity === "critical")) return "critical" as const;
  if (alerts.some((alert) => alert.severity === "warning")) return "warning" as const;
  return "healthy" as const;
}
