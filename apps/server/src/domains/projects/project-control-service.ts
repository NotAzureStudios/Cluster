export const PROJECT_CONTROL_KINDS = [
  "phase",
  "milestone",
  "deliverable",
  "goal",
  "risk",
  "issue",
  "assumption",
  "decision",
  "dependency",
  "change_request",
  "responsibility",
  "onboarding",
  "status_report",
  "baseline",
  "saved_view",
  "automation",
  "budget",
  "closeout",
] as const;

export type ProjectControlKind = (typeof PROJECT_CONTROL_KINDS)[number];

export type ProjectControlRecordShape = {
  id: string;
  projectId: string;
  kind: ProjectControlKind | string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  ownerId?: string | null;
  parentId?: string | null;
  category?: string | null;
  startDate?: Date | string | null;
  dueDate?: Date | string | null;
  completedAt?: Date | string | null;
  progress: number;
  probability?: number | null;
  impact?: number | null;
  confidence?: number | null;
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
  sortOrder: number;
  payload?: string | Record<string, unknown> | null;
  archived: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  revision: number;
};

function parsePayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function dateValue(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function isClosed(record: ProjectControlRecordShape) {
  return record.archived || ["done", "completed", "resolved", "approved", "accepted", "closed", "published", "cancelled"].includes(String(record.status || "").toLowerCase());
}

function riskScore(record: ProjectControlRecordShape) {
  return Math.max(1, Math.min(5, Number(record.probability || 1))) * Math.max(1, Math.min(5, Number(record.impact || 1)));
}

export function serializeProjectControlRecord(record: ProjectControlRecordShape) {
  return { ...record, payload: parsePayload(record.payload) };
}

export function serializeProjectRelationship(record: any) {
  return { ...record, critical: Boolean(record.critical) };
}

export function buildProjectControlSummary(recordsInput: ProjectControlRecordShape[], relationshipsInput: any[], now = new Date()) {
  const records = recordsInput.filter((record) => !record.archived);
  const relationships = relationshipsInput || [];
  const nowTime = now.getTime();
  const open = records.filter((record) => !isClosed(record));
  const overdue = open.filter((record) => {
    const due = dateValue(record.dueDate);
    return due !== null && due < nowTime;
  });
  const dueSoon = open.filter((record) => {
    const due = dateValue(record.dueDate);
    return due !== null && due >= nowTime && due <= nowTime + 7 * 86_400_000;
  });
  const unowned = open.filter((record) => ["milestone", "deliverable", "goal", "risk", "issue", "change_request", "onboarding"].includes(record.kind) && !record.ownerId);
  const highRisks = open.filter((record) => record.kind === "risk" && riskScore(record) >= 12);
  const pendingDecisions = open.filter((record) => record.kind === "decision");
  const pendingChanges = open.filter((record) => record.kind === "change_request");
  const blocked = open.filter((record) => record.status === "blocked" || record.priority === "urgent");
  const goals = records.filter((record) => record.kind === "goal");
  const deliverables = records.filter((record) => record.kind === "deliverable");
  const milestones = records.filter((record) => record.kind === "milestone");
  const onboarding = records.filter((record) => record.kind === "onboarding");
  const completedDeliverables = deliverables.filter(isClosed).length;
  const averageProgress = deliverables.length
    ? Math.round(deliverables.reduce((total, record) => total + (isClosed(record) ? 100 : Math.max(0, Math.min(100, Number(record.progress || 0)))), 0) / deliverables.length)
    : 0;
  const schedule = Math.max(0, 100 - overdue.filter((record) => ["phase", "milestone", "deliverable"].includes(record.kind)).length * 14 - dueSoon.length * 2);
  const scope = Math.max(0, 100 - pendingChanges.length * 10 - unowned.filter((record) => record.kind === "deliverable").length * 8);
  const quality = Math.max(0, 100 - open.filter((record) => record.kind === "issue").length * 5 - blocked.length * 8);
  const staffing = Math.max(0, 100 - unowned.length * 7 - onboarding.filter((record) => !isClosed(record)).length * 3);
  const delivery = deliverables.length ? averageProgress : Math.max(0, 100 - overdue.length * 10 - blocked.length * 8);
  const health = {
    overall: Math.round((schedule + scope + quality + staffing + delivery) / 5),
    schedule,
    scope,
    quality,
    staffing,
    delivery,
  };
  const attention = [
    ...overdue.map((record) => ({ id: `overdue:${record.id}`, tone: "danger", reason: "Overdue", recordId: record.id, kind: record.kind, title: record.title, dueDate: record.dueDate || null })),
    ...highRisks.map((record) => ({ id: `risk:${record.id}`, tone: "danger", reason: `Risk ${riskScore(record)}/25`, recordId: record.id, kind: record.kind, title: record.title, dueDate: record.dueDate || null })),
    ...blocked.map((record) => ({ id: `blocked:${record.id}`, tone: "warning", reason: "Blocked", recordId: record.id, kind: record.kind, title: record.title, dueDate: record.dueDate || null })),
    ...unowned.map((record) => ({ id: `unowned:${record.id}`, tone: "warning", reason: "Needs owner", recordId: record.id, kind: record.kind, title: record.title, dueDate: record.dueDate || null })),
    ...pendingDecisions.map((record) => ({ id: `decision:${record.id}`, tone: "neutral", reason: "Decision needed", recordId: record.id, kind: record.kind, title: record.title, dueDate: record.dueDate || null })),
  ].slice(0, 40);
  return {
    counts: {
      total: records.length,
      open: open.length,
      overdue: overdue.length,
      dueSoon: dueSoon.length,
      blocked: blocked.length,
      unowned: unowned.length,
      highRisks: highRisks.length,
      pendingDecisions: pendingDecisions.length,
      pendingChanges: pendingChanges.length,
      relationships: relationships.length,
      criticalDependencies: relationships.filter((relationship: any) => relationship.critical).length,
      phases: records.filter((record) => record.kind === "phase").length,
      milestones: milestones.length,
      deliverables: deliverables.length,
      completedDeliverables,
      goals: goals.length,
      onboarding: onboarding.length,
    },
    progress: {
      deliverables: averageProgress,
      onboarding: onboarding.length ? Math.round((onboarding.filter(isClosed).length / onboarding.length) * 100) : 0,
      goals: goals.length ? Math.round(goals.reduce((total, record) => total + (isClosed(record) ? 100 : Number(record.progress || 0)), 0) / goals.length) : 0,
    },
    health,
    attention,
  };
}

export function buildStatusReportDraft(project: any, records: ProjectControlRecordShape[], relationships: any[], now = new Date()) {
  const summary = buildProjectControlSummary(records, relationships, now);
  const completed = records.filter((record) => isClosed(record) && dateValue(record.updatedAt) && Number(dateValue(record.updatedAt)) >= now.getTime() - 7 * 86_400_000);
  const active = records.filter((record) => !isClosed(record) && ["phase", "milestone", "deliverable", "goal"].includes(record.kind));
  const risks = records.filter((record) => record.kind === "risk" && !isClosed(record)).sort((a, b) => riskScore(b) - riskScore(a));
  const decisions = records.filter((record) => record.kind === "decision" && !isClosed(record));
  return {
    generatedAt: now.toISOString(),
    projectId: project.id,
    projectName: project.name,
    executiveSummary: summary.health.overall >= 80 ? "Project delivery is healthy." : summary.health.overall >= 60 ? "Project delivery needs focused attention." : "Project delivery is at risk and requires intervention.",
    health: summary.health,
    completed: completed.slice(0, 12).map((record) => ({ id: record.id, kind: record.kind, title: record.title })),
    current: active.slice(0, 12).map((record) => ({ id: record.id, kind: record.kind, title: record.title, progress: record.progress, dueDate: record.dueDate || null })),
    risks: risks.slice(0, 10).map((record) => ({ id: record.id, title: record.title, score: riskScore(record), ownerId: record.ownerId || null })),
    decisionsNeeded: decisions.slice(0, 10).map((record) => ({ id: record.id, title: record.title, dueDate: record.dueDate || null })),
    attention: summary.attention.slice(0, 12),
    metrics: summary.counts,
  };
}
