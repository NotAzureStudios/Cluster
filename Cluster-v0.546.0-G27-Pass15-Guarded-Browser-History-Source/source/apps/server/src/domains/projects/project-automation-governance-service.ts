import { createHash, randomUUID } from "node:crypto";

function parsePayload(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string") return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
}

function checksum(payload: Record<string, any>) {
  return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}

function comparable(payload: Record<string, any>) {
  const next = { ...payload };
  delete next.runCount; delete next.lastRunAt; delete next.lastResult; delete next.consecutiveFailures; delete next.disabledReason;
  return next;
}

function changedKeys(before: Record<string, any>, after: Record<string, any>) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(stable(before[key])) !== JSON.stringify(stable(after[key]))).slice(0, 80);
}

export function createProjectAutomationGovernanceService(prisma: any) {
  async function recordVersion(input: { rule: any; before?: Record<string, any>; after?: Record<string, any>; actorId?: string | null; reason: string }) {
    const before = comparable(input.before || {});
    const after = comparable(input.after || parsePayload(input.rule.payload));
    const governance = parsePayload(after.governance);
    const payload = {
      ruleId: input.rule.id,
      projectId: input.rule.projectId,
      recordRevision: input.rule.revision,
      governanceVersion: Number(governance.version || 0),
      governanceState: governance.state || (input.rule.status === "draft" ? "draft" : "published"),
      reason: input.reason,
      actorId: input.actorId || null,
      changedKeys: changedKeys(before, after),
      checksum: checksum(after),
      snapshot: after,
      recordedAt: new Date().toISOString(),
    };
    return prisma.clusterPersistenceRecord.create({ data: { id: randomUUID(), kind: "projectAutomationVersion", title: `${input.rule.title} · v${payload.governanceVersion || input.rule.revision}`, projectId: input.rule.projectId, entityType: "automation", entityId: input.rule.id, ownerId: input.actorId || null, userId: input.actorId || null, status: payload.governanceState, visibility: "internal", sourceKey: "project-automation-c3", checksum: payload.checksum, payload: JSON.stringify(payload), syncedAt: new Date(), revision: 1 } });
  }

  async function versions(projectId: string, ruleId: string, limit = 30) {
    const rows = await prisma.clusterPersistenceRecord.findMany({ where: { projectId, kind: "projectAutomationVersion", entityType: "automation", entityId: ruleId, archived: false }, orderBy: { createdAt: "desc" }, take: Math.max(1, Math.min(100, limit)) });
    return rows.map((row: any) => ({ id: row.id, createdAt: row.createdAt, ...parsePayload(row.payload) }));
  }

  async function studioGovernance(workspaceId: string) {
    const projects = await prisma.project.findMany({ where: { workspaceId, archived: false }, select: { id: true, name: true, projectType: true }, take: 1000 });
    const projectIds = projects.map((project: any) => project.id);
    const rules = projectIds.length ? await prisma.projectControlRecord.findMany({ where: { projectId: { in: projectIds }, kind: "automation", archived: false }, orderBy: { updatedAt: "desc" }, take: 5000 }) : [];
    const projectById = new Map<string, any>(projects.map((project: any) => [String(project.id), project]));
    const rows = rules.map((rule: any) => {
      const payload = parsePayload(rule.payload);
      const governance = parsePayload(payload.governance);
      const state = String(governance.state || (rule.status === "draft" ? "draft" : "published"));
      const failures = Number(payload.consecutiveFailures || 0);
      return { id: rule.id, projectId: rule.projectId, projectName: projectById.get(rule.projectId)?.name || rule.projectId, projectType: projectById.get(rule.projectId)?.projectType || "general", title: rule.title, ownerId: rule.ownerId || null, state, status: rule.status, enabled: payload.enabled !== false, failures, version: Number(governance.version || 0), updatedAt: rule.updatedAt, lastRunAt: payload.lastRunAt || null };
    });
    return {
      workspaceId,
      generatedAt: new Date().toISOString(),
      total: rows.length,
      published: rows.filter((row: any) => row.state === "published").length,
      drafts: rows.filter((row: any) => row.state === "draft").length,
      paused: rows.filter((row: any) => row.status === "paused" || !row.enabled).length,
      failing: rows.filter((row: any) => row.failures > 0).length,
      unowned: rows.filter((row: any) => !row.ownerId).length,
      rules: rows.slice(0, 500),
      methodology: "Governance counts are direct rule state, ownership, enablement, and consecutive-failure evidence. They are not a generated health score.",
    };
  }

  return { recordVersion, versions, studioGovernance };
}
