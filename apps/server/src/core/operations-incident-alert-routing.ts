/**
 * Durable, bounded alert routing for the *existing* OperationsIncident store.
 * Recipients must have active admin/owner membership; owning a Team or
 * Department does not, on its own, grant privileged incident access.
 * Notification Inbox state and incident acknowledgement are separate.
 */
export const SYSTEM_ALERT_KEYS = ["cluster:dependency:storage", "cluster:dependency:background-tasks", "cluster:native:gateway", "cluster:native:api-process", "cluster:native:api-dependencies", "cluster:native:native-host", "cluster:native:network-deployment"] as const;
export type SystemAlertKey = typeof SYSTEM_ALERT_KEYS[number];
export type AlertTargetType = "admins" | "user" | "team" | "department";
export type AlertRoutingPolicy = {
  key: string;
  enabled: boolean;
  recipientType: AlertTargetType;
  recipientId: string | null;
  escalationType: AlertTargetType;
  escalationId: string | null;
  acknowledgeMinutes: number;
  reminderMinutes: number;
};
const INACTIVE_STATES = ["SUSPENDED", "DISABLED", "LOCKED", "PRIVACY_ERASED"];
export const ACTIVE_INCIDENT_STATUSES = ["open", "investigating", "mitigating", "monitoring"] as const;

export function defaultAlertPolicy(key: string): AlertRoutingPolicy {
  return {
    key, enabled: true, recipientType: "admins", recipientId: null,
    escalationType: "admins", escalationId: null,
    acknowledgeMinutes: 15, reminderMinutes: 10,
  };
}

export function validateAlertPolicy(input: AlertRoutingPolicy): boolean {
  return SYSTEM_ALERT_KEYS.includes(input.key as SystemAlertKey) &&
    ["admins", "user", "team", "department"].includes(input.recipientType) &&
    ["admins", "user", "team", "department"].includes(input.escalationType) &&
    (input.recipientType === "admins" ? input.recipientId === null : Boolean(input.recipientId)) &&
    (input.escalationType === "admins" ? input.escalationId === null : Boolean(input.escalationId)) &&
    Number.isInteger(input.acknowledgeMinutes) && input.acknowledgeMinutes >= 2 && input.acknowledgeMinutes <= 1440 &&
    Number.isInteger(input.reminderMinutes) && input.reminderMinutes >= 2 && input.reminderMinutes <= 1440;
}

export async function loadAlertPolicy(tx: any, key: string): Promise<AlertRoutingPolicy> {
  const found = await tx.operationsAlertPolicy.findUnique({ where: { key } });
  return found || defaultAlertPolicy(key);
}

/** Returns only active admin/owner accounts, never an unbounded target group. */
export async function eligibleAlertAdminIds(tx: any, now: Date) {
  const memberships = await tx.workspaceMember.findMany({
    where: { role: { in: ["owner", "admin"] }, user: {
      archived: false, accountState: { notIn: INACTIVE_STATES },
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }],
    } },
    select: { userId: true }, orderBy: [{ role: "desc" }, { userId: "asc" }], take: 65,
  });
  if (memberships.length > 64) throw new Error("OPERATIONS_ALERT_ADMIN_SCOPE_EXCEEDED");
  return [...new Set(memberships.map((member: any) => String(member.userId)))];
}

export async function resolveAlertRecipients(tx: any, policy: AlertRoutingPolicy, stage: string, now: Date) {
  const admins = await eligibleAlertAdminIds(tx, now);
  const permitted = new Set(admins);
  const targetType = stage.startsWith("escalation") ? policy.escalationType : policy.recipientType;
  const targetId = stage.startsWith("escalation") ? policy.escalationId : policy.recipientId;
  if (targetType === "admins") return admins;
  let selected: string[] = [];
  if (targetType === "user" && targetId) selected = [targetId];
  if (targetType === "team" && targetId) {
    const team = await tx.studioTeam.findFirst({ where: { id: targetId, archived: false }, select: {
      leadUserId: true,
      members: { where: { archived: false }, select: { userId: true }, take: 65 },
    } });
    if (team) selected = [team.leadUserId, ...team.members.map((m: any) => m.userId)].filter(Boolean);
  }
  if (targetType === "department" && targetId) {
    const department = await tx.department.findFirst({ where: { id: targetId, archived: false }, select: { leadUserId: true } });
    if (department) {
      const employed = await tx.employment.findMany({ where: { departmentId: targetId, active: true }, select: { userId: true }, take: 65 });
      selected = [department.leadUserId, ...employed.map((m: any) => m.userId)].filter(Boolean);
    }
  }
  // Never silently fall back to everybody for an explicitly configured target.
  // Escalation may use a distinct target (usually admins) to cover an empty group.
  if (selected.length > 64) throw new Error("OPERATIONS_ALERT_TARGET_SCOPE_EXCEEDED");
  const scoped = [...new Set(selected)].filter((id) => permitted.has(id)).slice(0, 64);
  // Never strand an alert because an assigned team has no active admin.
  return scoped.length ? scoped : admins;
}

export function alertStageForIncident(input: {
  openedAt: Date | string; acknowledgedAt?: Date | string | null; status: string;
}, policy: AlertRoutingPolicy, now: Date): string | null {
  if (!policy.enabled || input.acknowledgedAt || !ACTIVE_INCIDENT_STATUSES.includes(input.status as any)) return null;
  const ageMinutes = (now.getTime() - new Date(input.openedAt).getTime()) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return null;
  if (ageMinutes >= policy.acknowledgeMinutes * 2) return "escalation-2";
  if (ageMinutes >= policy.acknowledgeMinutes) return "escalation-1";
  const reminder = Math.min(3, Math.floor(ageMinutes / policy.reminderMinutes));
  return reminder >= 1 ? `reminder-${reminder}` : null;
}

/** Always called inside the same DB transaction as the corresponding incident change. */
export async function deliverIncidentAlert(tx: any, incident: any, stage: string, now: Date, policyInput?: AlertRoutingPolicy) {
  const policy = policyInput || await loadAlertPolicy(tx, String(incident.automationKey));
  if (!policy.enabled || !validateAlertPolicy(policy)) return [];
  const ids = await resolveAlertRecipients(tx, policy, stage, now);
  const delivered: any[] = [];
  for (const userId of ids) {
    const claim = await tx.operationsIncidentAlertDispatch.createMany({ data: [{
      incidentId: incident.id, cycle: incident.alertCycle, stage, userId,
    }], skipDuplicates: true });
    if (claim.count !== 1) continue;
    delivered.push(await tx.notificationInboxItem.create({ data: {
      userId, category: "system", priority: incident.severity === "critical" ? "critical" : "high",
      title: stage === "initial" ? incident.title : `${stage === "severity-upgrade" ? "Critical escalation" : stage.startsWith("escalation") ? "Escalation" : "Reminder"}: ${incident.title}`,
      message: `${stage === "initial" ? "New incident" : stage === "severity-upgrade" ? "Native supervisor reported increased severity" : "Incident remains unacknowledged"}. Review Operations → Incidents.`,
      entityType: "operations_incident", entityId: incident.id,
      resourceKind: "operations_incident", resourceId: incident.id,
      tool: "system", signal: "dependency_failure", requiresAction: true,
      groupKey: `operations-incident:${incident.id}:${incident.alertCycle}`,
      metadata: JSON.stringify({ alertStage: stage, alertCycle: incident.alertCycle }),
    } }));
  }
  if (delivered.length) await tx.operationsIncidentTimeline.create({ data: {
    incidentId: incident.id, kind: "alert", message: `${stage} alert delivered to ${delivered.length} authorized responder(s).`,
    correlationId: incident.automationKey,
  } });
  return delivered;
}

/** At most 50 eligible automated incidents and one stage per incident per tick. */
export async function reconcileIncidentEscalations(input: { prisma: any; now?: Date; onCommitted?: (records: any[]) => void }) {
  const now = input.now || new Date();
  const rows = await input.prisma.operationsIncident.findMany({ where: {
    automationKey: { in: [...SYSTEM_ALERT_KEYS] },
    acknowledgedAt: null,
    status: { in: [...ACTIVE_INCIDENT_STATUSES] },
  }, orderBy: { openedAt: "asc" }, take: 51 });
  const result = { scanned: Math.min(rows.length, 50), backlog: rows.length > 50, delivered: 0 };
  for (const snapshot of rows.slice(0, 50)) {
    const records = await input.prisma.$transaction(async (tx: any) => {
      // Avoid delivering against a stale status/acknowledgement. Concurrent
      // workers are fenced by per-recipient dispatch unique receipts.
      const row = await tx.operationsIncident.findUnique({ where: { id: snapshot.id } });
      if (!row || row.acknowledgedAt || !ACTIVE_INCIDENT_STATUSES.includes(row.status)) return [];
      const policy = await loadAlertPolicy(tx, row.automationKey);
      const stage = alertStageForIncident(row, policy, now);
      if (!stage) return [];
      // A completed stage is never polled into repeated writes or notices.
      const done = await tx.operationsIncidentAlertDispatch.findFirst({ where: {
        incidentId: row.id, cycle: row.alertCycle, stage,
      }, select: { id: true } });
      if (done) return [];
      // The conditional write takes a row lock shared with the acknowledgement
      // mutation. An acknowledgement that wins the race makes this claim fail;
      // an acknowledgement that loses happens after this alert transaction.
      const claim = await tx.operationsIncident.updateMany({ where: {
        id: row.id, alertCycle: row.alertCycle,
        acknowledgedAt: null, status: { in: [...ACTIVE_INCIDENT_STATUSES] },
      }, data: { updatedAt: now } });
      if (claim.count !== 1) return [];
      return deliverIncidentAlert(tx, row, stage, now, policy);
    });
    result.delivered += records.length;
    if (records.length) input.onCommitted?.(records);
  }
  return result;
}
