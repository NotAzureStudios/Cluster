export const PROJECT_CONTROL_KINDS = [
  "phase", "milestone", "deliverable", "goal", "risk", "issue", "assumption", "decision", "dependency", "change_request", "responsibility", "onboarding", "status_report", "baseline", "saved_view", "automation", "budget", "closeout",
] as const;

export type ProjectControlKind = (typeof PROJECT_CONTROL_KINDS)[number];

export type ProjectControlLinkCandidate = {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  status: string;
  progress?: number | null;
  dueDate?: string | null;
  updatedAt?: string | null;
  openPath?: string | null;
  destinationLists?: Array<{ id: string; title: string }>;
};

export type ProjectControlRecord = {
  id: string;
  projectId: string;
  kind: ProjectControlKind;
  title: string;
  description?: string | null;
  status: string;
  priority: "low" | "medium" | "high" | "urgent" | string;
  ownerId?: string | null;
  parentId?: string | null;
  category?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  progress: number;
  probability?: number | null;
  impact?: number | null;
  confidence?: number | null;
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
  sortOrder: number;
  payload: Record<string, any>;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  linkedEntity?: ProjectControlLinkCandidate | null;
  linkState?: "unlinked" | "linked" | "synced" | "missing" | string;
};

export type ProjectRelationship = {
  id: string;
  projectId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationship: "relates_to" | "blocks" | "blocked_by" | "depends_on" | "delivers" | "validates" | "implements" | "supersedes" | "informs" | "approves" | string;
  description?: string | null;
  critical: boolean;
  createdById?: string | null;
  createdAt: string;
};

export type ProjectControlHealth = {
  overall: number;
  schedule: number;
  scope: number;
  quality: number;
  staffing: number;
  delivery: number;
};

export type ProjectControlSummary = {
  counts: Record<string, number> & {
    total: number;
    open: number;
    overdue: number;
    dueSoon: number;
    blocked: number;
    unowned: number;
    highRisks: number;
    pendingDecisions: number;
    pendingChanges: number;
    relationships: number;
    criticalDependencies: number;
    phases: number;
    milestones: number;
    deliverables: number;
    completedDeliverables: number;
    goals: number;
    onboarding: number;
  };
  progress: { deliverables: number; onboarding: number; goals: number };
  health: ProjectControlHealth;
  attention: Array<{ id: string; tone: string; reason: string; recordId: string; kind: ProjectControlKind; title: string; dueDate?: string | null }>;
};

export type ProjectControlCenterPayload = {
  projectId: string;
  generatedAt: string;
  records: ProjectControlRecord[];
  linkCandidates?: ProjectControlLinkCandidate[];
  relationships: ProjectRelationship[];
  summary: ProjectControlSummary;
};

export type ProjectControlDraft = {
  kind: ProjectControlKind;
  title: string;
  description: string;
  status: string;
  priority: "low" | "medium" | "high" | "urgent";
  ownerId: string;
  parentId: string;
  category: string;
  startDate: string;
  dueDate: string;
  progress: number;
  probability: number;
  impact: number;
  confidence: number;
  linkedEntityType: string;
  linkedEntityId: string;
  payload: Record<string, any>;
};

export const PROJECT_CONTROL_KIND_META: Record<ProjectControlKind, { label: string; plural: string; group: "roadmap" | "raid" | "outcomes" | "team" | "system"; tone: string; defaultStatus: string }> = {
  phase: { label: "Phase", plural: "Phases", group: "roadmap", tone: "accent", defaultStatus: "planned" },
  milestone: { label: "Milestone", plural: "Milestones", group: "roadmap", tone: "accent", defaultStatus: "planned" },
  deliverable: { label: "Deliverable", plural: "Deliverables", group: "roadmap", tone: "good", defaultStatus: "planned" },
  goal: { label: "Goal", plural: "Goals", group: "outcomes", tone: "good", defaultStatus: "active" },
  risk: { label: "Risk", plural: "Risks", group: "raid", tone: "danger", defaultStatus: "open" },
  issue: { label: "Issue", plural: "Issues", group: "raid", tone: "warning", defaultStatus: "open" },
  assumption: { label: "Assumption", plural: "Assumptions", group: "raid", tone: "neutral", defaultStatus: "open" },
  decision: { label: "Decision", plural: "Decisions", group: "raid", tone: "accent", defaultStatus: "open" },
  dependency: { label: "Dependency", plural: "Dependencies", group: "raid", tone: "warning", defaultStatus: "open" },
  change_request: { label: "Change request", plural: "Change requests", group: "raid", tone: "warning", defaultStatus: "pending" },
  responsibility: { label: "Responsibility", plural: "Responsibilities", group: "team", tone: "accent", defaultStatus: "active" },
  onboarding: { label: "Onboarding item", plural: "Onboarding", group: "team", tone: "neutral", defaultStatus: "open" },
  status_report: { label: "Status report", plural: "Status reports", group: "outcomes", tone: "accent", defaultStatus: "draft" },
  baseline: { label: "Baseline", plural: "Baselines", group: "outcomes", tone: "neutral", defaultStatus: "approved" },
  saved_view: { label: "Saved view", plural: "Saved views", group: "system", tone: "neutral", defaultStatus: "active" },
  automation: { label: "Automation", plural: "Automations", group: "system", tone: "accent", defaultStatus: "draft" },
  budget: { label: "Budget", plural: "Budget", group: "outcomes", tone: "good", defaultStatus: "active" },
  closeout: { label: "Closeout item", plural: "Closeout", group: "system", tone: "neutral", defaultStatus: "open" },
};

export function emptyProjectControlDraft(kind: ProjectControlKind = "deliverable"): ProjectControlDraft {
  return {
    kind,
    title: "",
    description: "",
    status: PROJECT_CONTROL_KIND_META[kind].defaultStatus,
    priority: kind === "risk" || kind === "issue" ? "high" : "medium",
    ownerId: "",
    parentId: "",
    category: "",
    startDate: "",
    dueDate: "",
    progress: 0,
    probability: 3,
    impact: 3,
    confidence: 70,
    linkedEntityType: "",
    linkedEntityId: "",
    payload: kind === "automation" ? { trigger: "record_overdue", enabled: true, conditions: [], actions: [{ type: "create_risk", title: "Automation follow-up" }], retryPolicy: { maxAttempts: 3, backoffMinutes: 5, pauseAfterFailures: 3 }, recurrence: { every: 1, unit: "day" }, notifyOnFailure: true, governance: { state: "draft", version: 0 } } : kind === "budget" ? { costCategory: "General", planned: 0, actual: 0, forecast: 0, currency: "USD" } : kind === "saved_view" ? { kinds: [], statuses: [], priorities: [], dueWindow: "any", missingOwner: false } : {},
  };
}

export function controlDraftFromRecord(record: ProjectControlRecord): ProjectControlDraft {
  return {
    kind: record.kind,
    title: record.title,
    description: record.description || "",
    status: record.status || PROJECT_CONTROL_KIND_META[record.kind].defaultStatus,
    priority: (record.priority === "low" || record.priority === "high" || record.priority === "urgent" ? record.priority : "medium"),
    ownerId: record.ownerId || "",
    parentId: record.parentId || "",
    category: record.category || "",
    startDate: record.startDate?.slice(0, 10) || "",
    dueDate: record.dueDate?.slice(0, 10) || "",
    progress: record.progress || 0,
    probability: record.probability || 3,
    impact: record.impact || 3,
    confidence: record.confidence ?? 70,
    linkedEntityType: record.linkedEntityType || "",
    linkedEntityId: record.linkedEntityId || "",
    payload: record.payload || {},
  };
}

export function recordIsClosed(record: ProjectControlRecord) {
  return ["done", "completed", "resolved", "approved", "accepted", "closed", "published", "cancelled"].includes(String(record.status || "").toLowerCase());
}

export function recordIsOverdue(record: ProjectControlRecord) {
  return !recordIsClosed(record) && Boolean(record.dueDate && new Date(record.dueDate).getTime() < Date.now());
}

export function controlDateLabel(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

export function recordMatchesSavedView(record: ProjectControlRecord, view?: ProjectControlRecord | null) {
  if (!view || view.kind !== "saved_view") return true;
  const filters = view.payload || {};
  const kinds = Array.isArray(filters.kinds) ? filters.kinds.map(String) : [];
  const statuses = Array.isArray(filters.statuses) ? filters.statuses.map(String) : [];
  const priorities = Array.isArray(filters.priorities) ? filters.priorities.map(String) : [];
  if (kinds.length && !kinds.includes(record.kind)) return false;
  if (statuses.length && !statuses.includes(record.status)) return false;
  if (priorities.length && !priorities.includes(record.priority)) return false;
  if (filters.missingOwner && record.ownerId) return false;
  const due = record.dueDate ? new Date(record.dueDate).getTime() : null;
  const days = filters.dueWindow === "7d" ? 7 : filters.dueWindow === "30d" ? 30 : 0;
  if (days && (!due || due < Date.now() || due > Date.now() + days * 86400000)) return false;
  return true;
}
