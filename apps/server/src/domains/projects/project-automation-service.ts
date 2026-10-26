import crypto from "node:crypto";
import { CLUSTER_DOMAIN_EVENTS, CLUSTER_WORKFLOW_RELATIONSHIPS, CLUSTER_WORK_SOURCE_KINDS, type ClusterWorkSourceKind, type ClusterWorkflowRelationship } from "@cluster/shared";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import type { ClusterAdminConfigurableToolId } from "@cluster/shared";
import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";
import { BackgroundJobDeferredError, BackgroundJobRetryError } from "../jobs/job-types.js";
import { automationActionToolOwners, automationJobRequiredToolOwners } from "../jobs/job-tool-ownership.js";
import { serializeProjectControlRecord, type ProjectControlKind } from "./project-control-service.js";

type AutomationDependencies = {
  prisma: any;
  events: any;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  logger?: { warn?: (error: unknown, message: string) => void };
  jobQueue: BackgroundJobQueue;
  /** Fresh Studio policy gate for Ticket-specific events, never general Project work. */
  isTicketsEnabled?: () => Promise<boolean>;
  isActionToolEnabled?: (owner: ClusterAdminConfigurableToolId) => Promise<boolean>;
};

type AutomationContext = {
  trigger: string;
  eventId?: string | null;
  actorUserId?: string | null;
  projectId: string;
  sourceType: string;
  sourceId: string;
  source: Record<string, any>;
  depth?: number;
};

type ExecuteOptions = { dryRun?: boolean; context?: AutomationContext; idempotencyKey?: string; retryOf?: string | null; actionsOverride?: any[]; skipConditions?: boolean; deferredOf?: string | null };

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item).slice(0, 64_000);
}

function runId(ruleId: string, key: string) {
  return `project-automation-run-${crypto.createHash("sha256").update(`${ruleId}:${key}`).digest("hex").slice(0, 36)}`;
}

function closedStatus(value: unknown) {
  return ["done", "completed", "resolved", "approved", "accepted", "closed", "published", "released", "passed", "go", "archived"].includes(String(value || "").toLowerCase());
}

function valueAt(source: Record<string, any>, path: string) {
  return path.split(".").filter(Boolean).reduce((value: any, key) => value == null ? undefined : value[key], source);
}

function conditionMatches(condition: any, context: AutomationContext) {
  const actual = valueAt({ ...context, source: context.source }, String(condition?.field || "source.status"));
  const expected = condition?.value;
  switch (String(condition?.operator || "equals")) {
    case "not_equals": return String(actual ?? "") !== String(expected ?? "");
    case "in": return Array.isArray(expected) && expected.map(String).includes(String(actual ?? ""));
    case "not_in": return Array.isArray(expected) && !expected.map(String).includes(String(actual ?? ""));
    case "contains": return Array.isArray(actual) ? actual.map(String).includes(String(expected)) : String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "gt": return Number(actual) > Number(expected);
    case "gte": return Number(actual) >= Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
    default: return String(actual ?? "") === String(expected ?? "");
  }
}

function evaluateConditionTree(input: any, context: AutomationContext, depth = 0): any {
  if (depth > 4) return { matched: false, operator: "depth_limit", results: [] };
  if (!input || typeof input !== "object") return { matched: true, operator: "all", results: [] };
  if (input.field) {
    const matched = conditionMatches(input, context);
    return { matched, field: String(input.field || "source.status"), operator: String(input.operator || "equals"), expected: input.value ?? null };
  }
  const operator = ["any", "none"].includes(String(input.operator)) ? String(input.operator) : "all";
  const children = [...(Array.isArray(input.conditions) ? input.conditions : []), ...(Array.isArray(input.groups) ? input.groups : [])].slice(0, 24);
  const results = children.map((child) => evaluateConditionTree(child, context, depth + 1));
  const matched = !results.length ? true : operator === "any" ? results.some((item) => item.matched) : operator === "none" ? results.every((item) => !item.matched) : results.every((item) => item.matched);
  return { matched, operator, results };
}

function ruleConditionTree(payload: Record<string, any>) {
  if (payload.conditionTree && typeof payload.conditionTree === "object") return payload.conditionTree;
  return { operator: String(payload.conditionMode || "all") === "any" ? "any" : "all", conditions: Array.isArray(payload.conditions) ? payload.conditions.slice(0, 20) : [] };
}

function actionPreview(action: any, rule: any) {
  const type = String(action?.type || "log_activity");
  return {
    type,
    title: String(action?.title || rule.title),
    targetStatus: action?.status || null,
    priority: action?.priority || null,
    relationship: action?.relationship || null,
    // Preview the exact configured route; do not imply a Ticket will land in a guessed Board.
    ticketDestination: type === "create_ticket" ? { boardId: action?.targetBoardId || null, listId: action?.targetListId || null, configured: Boolean(action?.targetBoardId && action?.targetListId) } : null,
    delayMinutes: type === "delay" ? Math.max(1, Math.min(10080, Number(action?.delayMinutes || 1))) : null,
    branchActions: type === "branch" ? { matched: Array.isArray(action?.thenActions) ? action.thenActions.length : 0, unmatched: Array.isArray(action?.elseActions) ? action.elseActions.length : 0 } : null,
  };
}

function normalizedKind(value: unknown): ClusterWorkSourceKind | null {
  const raw = String(value || "").trim();
  if ((CLUSTER_WORK_SOURCE_KINDS as readonly string[]).includes(raw)) return raw as ClusterWorkSourceKind;
  if (["phase", "milestone", "deliverable", "goal", "risk", "issue", "assumption", "decision", "dependency", "change_request", "responsibility", "onboarding", "status_report", "baseline", "saved_view", "automation", "budget", "closeout"].includes(raw)) return "control";
  return null;
}

function normalizedRelationship(value: unknown, fallback: ClusterWorkflowRelationship): ClusterWorkflowRelationship {
  const raw = String(value || "");
  return (CLUSTER_WORKFLOW_RELATIONSHIPS as readonly string[]).includes(raw) ? raw as ClusterWorkflowRelationship : fallback;
}

function retryPolicy(payload: Record<string, any>) {
  const source = parseObject(payload.retryPolicy);
  const maxAttempts = Math.max(1, Math.min(5, Number(source.maxAttempts || 3)));
  const backoffMinutes = Math.max(1, Math.min(1440, Number(source.backoffMinutes || 5)));
  const pauseAfterFailures = Math.max(1, Math.min(10, Number(source.pauseAfterFailures || 3)));
  return { maxAttempts, backoffMinutes, pauseAfterFailures };
}

function automationGovernanceState(rule: any, payload: Record<string, any>) {
  const governance = parseObject(payload.governance);
  if (String(governance.state || "").toLowerCase() === "draft" || String(rule?.status || "").toLowerCase() === "draft") return "draft";
  return "published";
}

function recurrenceIntervalMs(payload: Record<string, any>) {
  const recurrence = parseObject(payload.recurrence);
  const every = Math.max(1, Math.min(90, Number(recurrence.every || 1)));
  const unit = String(recurrence.unit || "day");
  const unitMs = unit === "hour" ? 3_600_000 : unit === "week" ? 604_800_000 : 86_400_000;
  return every * unitMs;
}

async function loadActivityContext(prisma: any, activity: any): Promise<AutomationContext | null> {
  const projectId = String(activity.projectId || "");
  if (!projectId || String(activity.entityType || "").includes("automation")) return null;
  const entityType = String(activity.entityType || "");
  const sourceId = String(activity.entityId || "");
  if (["build", "qa_plan", "qa_session", "release"].includes(entityType)) {
    const row = entityType === "build" ? await prisma.deliveryBuild.findFirst({ where: { id: sourceId, projectId, archived: false } })
      : entityType === "qa_plan" ? await prisma.deliveryQaPlan.findFirst({ where: { id: sourceId, projectId, archived: false } })
        : entityType === "qa_session" ? await prisma.deliveryQaSession.findFirst({ where: { id: sourceId, projectId, archived: false } })
          : await prisma.deliveryRelease.findFirst({ where: { id: sourceId, projectId, archived: false } });
    if (!row) return null;
    const source: Record<string, any> = { ...row, kind: entityType };
    const trigger = entityType === "build" && (source.promotedAt || source.channel === "release" || source.approval === "approved") ? "build_promoted"
      : entityType === "qa_session" && (source.decision === "no-go" || ["failed", "blocked"].includes(String(source.status))) ? "qa_no_go"
        : "workflow_changed";
    return { trigger, eventId: activity.id, actorUserId: activity.userId, projectId, sourceType: entityType, sourceId, source };
  }
  if (entityType.startsWith("project_")) {
    const kind = entityType.slice("project_".length);
    const record = await prisma.projectControlRecord.findFirst({ where: { id: sourceId, projectId, archived: false } });
    if (!record) return null;
    const source = { ...record, payload: parseObject(record.payload) };
    const trigger = kind === "risk" && activity.type === "created" ? "risk_created"
      : kind === "milestone" && closedStatus(record.status) ? "milestone_completed"
        : closedStatus(record.status) ? "record_completed"
          : "record_changed";
    return { trigger, eventId: activity.id, actorUserId: activity.userId, projectId, sourceType: kind, sourceId, source };
  }
  if (entityType === "ticket" || entityType === "card") {
    const card = await prisma.card.findUnique({ where: { id: sourceId }, include: { list: { include: { board: true } } } });
    if (!card || card.list.board.projectId !== projectId) return null;
    const ticket = card.workItemKind === "ticket";
    // A rejected Ticket is terminal for triage, not successful completed work.
    const completed = ticket ? card.ticketStage === "resolved" : Boolean(card.list.isDone);
    const source = { ...card, listTitle: card.list.title, boardId: card.list.boardId, completed };
    return { trigger: completed ? "ticket_completed" : "ticket_changed", eventId: activity.id, actorUserId: activity.userId, projectId, sourceType: ticket ? "ticket" : "card", sourceId, source };
  }
  return { trigger: `${entityType}_${activity.type}`, eventId: activity.id, actorUserId: activity.userId, projectId, sourceType: entityType, sourceId, source: activity };
}

export function createProjectAutomationService({ prisma, events, logActivity, logger, jobQueue, isTicketsEnabled, isActionToolEnabled }: AutomationDependencies) {
  async function validateRelationshipTarget(projectId: string, targetKind: ClusterWorkSourceKind, targetId: string) {
    let found: unknown = null;
    if (targetKind === "project") found = targetId === projectId ? { id: targetId } : null;
    else if (targetKind === "board") found = await prisma.board.findFirst({ where: { id: targetId, projectId, archived: false }, select: { id: true } });
    else if (targetKind === "card" || targetKind === "ticket") found = await prisma.card.findFirst({ where: { id: targetId, archived: false, list: { board: { projectId, archived: false } } }, select: { id: true } });
    else if (targetKind === "whiteboard") found = await prisma.whiteboard.findFirst({ where: { id: targetId, projectId }, select: { id: true } });
    else if (targetKind === "timeline") found = await prisma.timelineItem.findFirst({ where: { id: targetId, projectId }, select: { id: true } });
    else if (targetKind === "calendar") found = await prisma.calendarEvent.findFirst({ where: { id: targetId, projectId }, select: { id: true } });
    else if (targetKind === "scheduler") found = await prisma.scheduleBlock.findFirst({ where: { id: targetId, projectId }, select: { id: true } });
    else if (targetKind === "library") found = await prisma.libraryItem.findFirst({ where: { id: targetId, projectId }, select: { id: true } });
    else if (targetKind === "file") found = await prisma.projectFile.findFirst({ where: { id: targetId, projectId }, select: { id: true } });
    else if (targetKind === "review_asset") found = await prisma.reviewAsset.findFirst({ where: { id: targetId, projectId }, select: { id: true } });
    else if (targetKind === "control") found = await prisma.projectControlRecord.findFirst({ where: { id: targetId, projectId, archived: false }, select: { id: true } });
    else if (targetKind === "build") found = await prisma.deliveryBuild.findFirst({ where: { id: targetId, projectId, archived: false }, select: { id: true } });
    else if (targetKind === "qa_plan") found = await prisma.deliveryQaPlan.findFirst({ where: { id: targetId, projectId, archived: false }, select: { id: true } });
    else if (targetKind === "qa_session") found = await prisma.deliveryQaSession.findFirst({ where: { id: targetId, projectId, archived: false }, select: { id: true } });
    else if (targetKind === "release") found = await prisma.deliveryRelease.findFirst({ where: { id: targetId, projectId, archived: false }, select: { id: true } });
    else if (targetKind === "meeting") found = await prisma.clusterPersistenceRecord.findFirst({ where: { projectId, kind: "meeting", entityId: targetId, archived: false }, select: { id: true } });
    if (!found) throw new Error(`Automation link target ${targetKind}:${targetId} does not belong to this project.`);
  }

  async function ensureRelationship(rule: any, context: AutomationContext, targetKind: ClusterWorkSourceKind, targetId: string, relationship: ClusterWorkflowRelationship) {
    const sourceKind = normalizedKind(context.sourceType);
    if (!sourceKind || !targetId || (sourceKind === targetKind && context.sourceId === targetId)) return null;
    return prisma.projectRelationship.upsert({
      where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: rule.projectId, sourceType: sourceKind, sourceId: context.sourceId, targetType: targetKind, targetId, relationship } },
      update: { description: `Created by project automation: ${rule.title}`, createdById: context.actorUserId || null },
      create: { projectId: rule.projectId, sourceType: sourceKind, sourceId: context.sourceId, targetType: targetKind, targetId, relationship, description: `Created by project automation: ${rule.title}`, createdById: context.actorUserId || null },
    });
  }

  async function updateRuleResult(rule: any, payload: Record<string, any>, result: Record<string, any>, failed = false) {
    const policy = retryPolicy(payload);
    payload.runCount = Number(payload.runCount || 0) + 1;
    payload.lastRunAt = new Date().toISOString();
    payload.lastResult = result;
    payload.consecutiveFailures = failed ? Number(payload.consecutiveFailures || 0) + 1 : 0;
    if (payload.consecutiveFailures >= policy.pauseAfterFailures) {
      payload.enabled = false;
      payload.disabledReason = `Paused after ${policy.pauseAfterFailures} consecutive failures.`;
    } else if (!failed && payload.disabledReason) {
      delete payload.disabledReason;
    }
    return prisma.projectControlRecord.update({ where: { id: rule.id }, data: { status: payload.enabled === false ? "paused" : rule.status, payload: safeJson(payload), revision: { increment: 1 } } });
  }

  async function createControlRecord(rule: any, action: any, context: AutomationContext) {
    const kind: ProjectControlKind = action.type === "create_change_request" ? "change_request" : action.type === "create_decision" ? "decision" : "risk";
    const title = String(action.title || `${context.source?.title || rule.title} follow-up`).slice(0, 240);
    const duplicate = await prisma.projectControlRecord.findFirst({ where: { projectId: rule.projectId, kind, title, archived: false, status: { notIn: ["resolved", "closed", "approved", "completed"] } } });
    if (duplicate) return { type: kind, id: duplicate.id, duplicate: true };
    const record = await prisma.projectControlRecord.create({ data: { projectId: rule.projectId, kind, title, description: String(action.description || `Created by automation: ${rule.title}`).slice(0, 8000), status: String(action.status || "open"), priority: String(action.priority || (kind === "risk" ? "high" : "medium")), ownerId: action.ownerId || rule.ownerId || context.actorUserId || null, category: "automation", dueDate: action.dueInDays ? new Date(Date.now() + Number(action.dueInDays) * 86_400_000) : null, progress: 0, linkedEntityType: context.sourceType || null, linkedEntityId: context.sourceId || null, payload: safeJson({ automationRuleId: rule.id, automationRunSource: context }) } });
    await ensureRelationship(rule, context, "control", record.id, normalizedRelationship(action.relationship, "tracks"));
    await logActivity({ userId: context.actorUserId, projectId: rule.projectId, type: "created", entityType: `project_${kind}`, entityId: record.id, title: `${kind.replaceAll("_", " ")} created by automation`, message: record.title, metadata: { automationRuleId: rule.id, automationDepth: Number(context.depth || 0) + 1, notifyInbox: Boolean(action.notify) } });
    return { type: kind, id: record.id, record: serializeProjectControlRecord(record) };
  }

  async function createTicket(rule: any, action: any, context: AutomationContext) {
    // Automation is a Ticket writer, not a Board/template provisioning authority.
    // A missing, moved, completed or archived destination fails visibly in the run
    // record and can be corrected by the owner. It must never mutate Board layout.
    if (typeof action.targetBoardId !== "string" || !action.targetBoardId.trim()
      || typeof action.targetListId !== "string" || !action.targetListId.trim()) {
      throw new Error("TICKET_AUTOMATION_DESTINATION_REQUIRED: Select an existing Project Board and active List in the automation rule.");
    }
    const board = await prisma.board.findFirst({
      where: { id: action.targetBoardId, projectId: rule.projectId, archived: false },
      include: { lists: { orderBy: { position: "asc" } } },
    });
    if (!board) throw new Error("TICKET_AUTOMATION_BOARD_UNAVAILABLE: The configured Project Board no longer exists or is archived.");
    const list = board.lists.find((item: any) => item.id === action.targetListId);
    if (!list || list.archived || list.isDone) throw new Error("TICKET_AUTOMATION_LIST_UNAVAILABLE: Select an active List on the configured Project Board.");
    const recurringInstance = context.trigger === "recurring" ? String(context.source?.instanceKey || context.source?.scheduledAt || "recurring") : "";
    const externalUrl = `cluster://automation/${rule.id}/${context.sourceType}/${context.sourceId}${recurringInstance ? `/${encodeURIComponent(recurringInstance)}` : ""}`;
    const duplicate = await prisma.card.findFirst({ where: { listId: list.id, externalUrl, archived: false } });
    if (duplicate) return { type: "ticket", id: duplicate.id, boardId: board.id, duplicate: true };
    const last = await prisma.card.findFirst({ where: { listId: list.id, archived: false }, orderBy: { position: "desc" } });
    const labels = Array.isArray(action.labels) ? action.labels.map(String).filter(Boolean).slice(0, 40) : ["ticket", "automation", context.sourceType];
    const startDate = action.startInDays === undefined || action.startInDays === null ? null : new Date(Date.now() + Number(action.startInDays) * 86_400_000);
    const dueDate = action.dueInDays === undefined || action.dueInDays === null ? null : new Date(Date.now() + Number(action.dueInDays) * 86_400_000);
    const ticket = await prisma.card.create({ data: {
      listId: list.id,
      workItemKind: "ticket",
      ticketStage: "new",
      title: String(action.title || context.source?.title || rule.title).slice(0, 300),
      description: String(action.description || `Created by automation: ${rule.title}`).slice(0, 100_000),
      priority: String(action.priority || "high"),
      startDate,
      dueDate,
      labels: JSON.stringify(labels),
      category: action.category ? String(action.category).slice(0, 120) : null,
      coverColor: action.coverColor ? String(action.coverColor).slice(0, 32) : null,
      estimatePoints: action.estimatePoints === undefined || action.estimatePoints === null ? null : Math.max(0, Math.min(999, Number(action.estimatePoints) || 0)),
      memberIds: JSON.stringify(Array.isArray(action.memberIds) ? action.memberIds.map(String).filter(Boolean).slice(0, 100) : []),
      watcherIds: JSON.stringify(Array.isArray(action.watcherIds) ? action.watcherIds.map(String).filter(Boolean).slice(0, 100) : []),
      assigneeId: action.ownerId || rule.ownerId || null,
      externalUrl,
      position: last ? last.position + 1 : 0,
    } });
    const relationshipContext = context.trigger === "recurring" && rule.category === "board-recurring-card" && rule.linkedEntityType === "card" && rule.linkedEntityId
      ? { ...context, sourceType: "card", sourceId: String(rule.linkedEntityId) }
      : context;
    await ensureRelationship(rule, relationshipContext, "ticket", ticket.id, normalizedRelationship(action.relationship, "implements"));
    await logActivity({ userId: context.actorUserId, projectId: rule.projectId, boardId: board.id, cardId: ticket.id, type: "created", entityType: "ticket", entityId: ticket.id, title: "Ticket created by project automation", message: ticket.title, metadata: { automationRuleId: rule.id, automationDepth: Number(context.depth || 0) + 1, recurringInstance: recurringInstance || null, notifyInbox: Boolean(action.notify) } });
    return { type: "ticket", id: ticket.id, boardId: board.id };
  }

  async function createTimeline(rule: any, action: any, context: AutomationContext) {
    const externalUrl = `cluster://automation/${rule.id}/${context.sourceType}/${context.sourceId}`;
    const existing = await prisma.timelineItem.findFirst({ where: { projectId: rule.projectId, source: "project-automation", externalUrl } });
    const sourceDate = context.source?.dueDate || context.source?.targetDate || null;
    const data = { title: String(action.title || context.source?.title || rule.title).slice(0, 240), description: String(action.description || `Created by automation: ${rule.title}`).slice(0, 8000), startsAt: action.startsAt ? new Date(action.startsAt) : sourceDate ? new Date(sourceDate) : new Date(), endsAt: action.endsAt ? new Date(action.endsAt) : null, type: String(action.timelineType || "automation"), userId: action.ownerId || rule.ownerId || null };
    const item = existing ? await prisma.timelineItem.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } }) : await prisma.timelineItem.create({ data: { projectId: rule.projectId, source: "project-automation", externalUrl, ...data } });
    await ensureRelationship(rule, context, "timeline", item.id, normalizedRelationship(action.relationship, "scheduled_by"));
    await logActivity({ userId: context.actorUserId, projectId: rule.projectId, type: existing ? "updated" : "created", entityType: "timeline", entityId: item.id, title: "Timeline item synchronized by project automation", message: item.title, metadata: { automationRuleId: rule.id, automationDepth: Number(context.depth || 0) + 1 } });
    return { type: "timeline", id: item.id };
  }

  async function createCalendar(rule: any, action: any, context: AutomationContext) {
    const externalUrl = `cluster://automation/${rule.id}/${context.sourceType}/${context.sourceId}/calendar`;
    const existing = await prisma.calendarEvent.findFirst({ where: { projectId: rule.projectId, source: "project-automation", externalUrl } });
    const startsAt = action.startsAt ? new Date(action.startsAt) : context.source?.dueDate ? new Date(context.source.dueDate) : new Date();
    const endsAt = action.endsAt ? new Date(action.endsAt) : new Date(startsAt.getTime() + Math.max(15, Math.min(480, Number(action.durationMinutes || 60))) * 60_000);
    const data = { title: String(action.title || context.source?.title || rule.title).slice(0, 240), description: String(action.description || `Created by automation: ${rule.title}`).slice(0, 8000), startsAt, endsAt, allDay: Boolean(action.allDay), source: "project-automation", externalUrl, eventType: String(action.eventType || "project-work"), status: "scheduled", ownerId: action.ownerId || rule.ownerId || null, attendeeIds: JSON.stringify(Array.isArray(action.attendeeIds) ? action.attendeeIds.slice(0, 100).map(String) : []), reminderMinutes: Math.max(0, Math.min(10080, Number(action.reminderMinutes ?? 30))) };
    const item = existing ? await prisma.calendarEvent.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } }) : await prisma.calendarEvent.create({ data: { projectId: rule.projectId, ...data } });
    await ensureRelationship(rule, context, "calendar", item.id, normalizedRelationship(action.relationship, "scheduled_by"));
    await logActivity({ userId: context.actorUserId, projectId: rule.projectId, type: existing ? "updated" : "created", entityType: "calendar_event", entityId: item.id, title: "Calendar event synchronized by project automation", message: item.title, metadata: { automationRuleId: rule.id, automationDepth: Number(context.depth || 0) + 1 } });
    return { type: "calendar", id: item.id };
  }

  async function createSchedule(rule: any, action: any, context: AutomationContext) {
    const marker = `cluster-automation:${rule.id}:${context.sourceType}:${context.sourceId}`;
    const existing = await prisma.scheduleBlock.findFirst({ where: { projectId: rule.projectId, description: { contains: marker } } });
    const startsAt = action.startsAt ? new Date(action.startsAt) : context.source?.dueDate ? new Date(context.source.dueDate) : new Date();
    const endsAt = action.endsAt ? new Date(action.endsAt) : new Date(startsAt.getTime() + Math.max(15, Math.min(720, Number(action.durationMinutes || 60))) * 60_000);
    const description = `${String(action.description || `Created by automation: ${rule.title}`).slice(0, 7000)}\n\n[${marker}]`;
    const data = { userId: action.ownerId || rule.ownerId || null, title: String(action.title || context.source?.title || rule.title).slice(0, 240), description, startsAt, endsAt, type: String(action.scheduleType || "project-work") };
    const item = existing ? await prisma.scheduleBlock.update({ where: { id: existing.id }, data }) : await prisma.scheduleBlock.create({ data: { projectId: rule.projectId, ...data } });
    await ensureRelationship(rule, context, "scheduler", item.id, normalizedRelationship(action.relationship, "scheduled_by"));
    await logActivity({ userId: context.actorUserId, projectId: rule.projectId, type: existing ? "updated" : "created", entityType: "schedule_block", entityId: item.id, title: "Scheduler block synchronized by project automation", message: item.title, metadata: { automationRuleId: rule.id, automationDepth: Number(context.depth || 0) + 1 } });
    return { type: "scheduler", id: item.id };
  }

  async function executeAction(rule: any, action: any, context: AutomationContext) {
    const type = String(action.type || "log_activity");
    if (["create_risk", "create_change_request", "create_decision"].includes(type)) return createControlRecord(rule, action, context);
    if (type === "create_ticket") return createTicket(rule, action, context);
    if (type === "create_timeline") return createTimeline(rule, action, context);
    if (type === "create_calendar") return createCalendar(rule, action, context);
    if (type === "create_schedule") return createSchedule(rule, action, context);
    if (type === "link_work") {
      const targetKind = normalizedKind(action.targetKind);
      const targetId = String(action.targetId || "");
      if (!targetKind || !targetId) throw new Error("Link work action requires a supported target kind and target ID.");
      const relationship = normalizedRelationship(action.relationship, "relates_to");
      await validateRelationshipTarget(rule.projectId, targetKind, targetId);
      const linked = await ensureRelationship(rule, context, targetKind, targetId, relationship);
      return { type, targetKind, targetId, relationship, relationshipId: linked?.id || null };
    }
    if (type === "update_source_record" && context.sourceType && context.sourceId) {
      const updated = await prisma.projectControlRecord.updateMany({ where: { id: context.sourceId, projectId: rule.projectId, archived: false }, data: { status: action.status || undefined, priority: action.priority || undefined, ownerId: action.ownerId || undefined, progress: action.progress === undefined ? undefined : Math.max(0, Math.min(100, Number(action.progress))), revision: { increment: 1 } } });
      return { type, updated: updated.count };
    }
    const recipientIds = Array.from(new Set([...(Array.isArray(action.userIds) ? action.userIds.map(String) : []), action.ownerId, rule.ownerId].filter(Boolean).map(String))).slice(0, 100);
    await logActivity({ userId: context.actorUserId, projectId: rule.projectId, type: type === "notify" ? "automation_notification" : "automation_note", entityType: "project_automation", entityId: rule.id, title: String(action.title || rule.title), message: String(action.message || `Automation triggered by ${context.trigger}`), metadata: { automationRuleId: rule.id, sourceType: context.sourceType, sourceId: context.sourceId, ...(type === "notify" ? { notifyInbox: true, userIds: recipientIds, priority: action.priority || "medium" } : {}) } });
    return { type: type === "notify" ? "notify" : "log_activity", logged: true, recipients: recipientIds.length };
  }

  async function enqueueRuleExecution(ruleOrId: any, options: ExecuteOptions, runAfter?: Date | null) {
    const rule = typeof ruleOrId === "string" ? await prisma.projectControlRecord.findFirst({ where: { id: ruleOrId, kind: "automation", archived: false } }) : ruleOrId;
    if (!rule) throw new Error("Project automation rule not found.");
    const payload = parseObject(rule.payload);
    const policy = retryPolicy(payload);
    const context: AutomationContext = options.context || { trigger: "manual", actorUserId: null, projectId: rule.projectId, sourceType: "automation", sourceId: rule.id, source: { id: rule.id, title: rule.title } };
    const idempotencyKey = options.idempotencyKey || context.eventId || `${context.trigger}:${context.sourceType}:${context.sourceId}`;
    const job = await jobQueue.enqueue({
      type: "automation.project-rule",
      payload: {
        ruleId: rule.id,
        options: { ...options, dryRun: false, context, idempotencyKey },
        retryBackoffMs: policy.backoffMinutes * 60_000,
      },
      runAfter: runAfter || new Date(),
      maxAttempts: policy.maxAttempts,
      priority: Math.max(-100, Math.min(100, Number(rule.priority === "urgent" ? 50 : rule.priority === "high" ? 25 : rule.priority === "low" ? -10 : 0))),
      dedupeKey: `project-automation:${rule.id}:${idempotencyKey}`,
      createdById: context.actorUserId || rule.ownerId || null,
      authorization: (context.actorUserId || rule.ownerId) ? {
        actorUserId: context.actorUserId || rule.ownerId,
        action: "contribute",
        resource: { kind: "project", projectId: rule.projectId },
        minimum: "contribute",
        tool: "automation",
      } : null,
    });
    return { operationId: job.id, jobId: job.id, status: job.status, runAfter: job.runAfter, ruleId: rule.id, idempotencyKey };
  }

  async function scheduleDeferredActions(rule: any, context: AutomationContext, actions: any[], parentRunId: string, delayMinutes: number) {
    const boundedDelay = Math.max(1, Math.min(10080, Number(delayMinutes || 1)));
    const runAfter = new Date(Date.now() + boundedDelay * 60_000);
    const signature = crypto.createHash("sha256").update(`${rule.id}:${parentRunId}:${runAfter.toISOString()}:${safeJson(actions)}`).digest("hex").slice(0, 36);
    const queued = await enqueueRuleExecution(rule, {
      context,
      actionsOverride: actions.slice(0, 30),
      skipConditions: true,
      deferredOf: parentRunId,
      idempotencyKey: `deferred:${parentRunId}:${signature}`,
    }, runAfter);
    return { type: "delay", deferredId: queued.operationId, operationId: queued.operationId, dueAt: runAfter.toISOString(), delayMinutes: boundedDelay, remainingActions: actions.length };
  }

  async function executeActionSequence(rule: any, actionsInput: any[], context: AutomationContext, parentRunId: string, depth = 0, budget = { remaining: 40 }): Promise<any[]> {
    if (depth > 4) throw new Error("Automation branch depth exceeded the limit of 4.");
    const actions = actionsInput.slice(0, 30);
    const results: any[] = [];
    for (let index = 0; index < actions.length; index += 1) {
      if (budget.remaining <= 0) throw new Error("Automation action budget exceeded the limit of 40 actions.");
      budget.remaining -= 1;
      const action = actions[index] || {};
      const type = String(action.type || "log_activity");
      if (type === "delay") {
        const remaining = actions.slice(index + 1);
        results.push(remaining.length ? await scheduleDeferredActions(rule, context, remaining, parentRunId, Number(action.delayMinutes || 1)) : { type: "delay", delayMinutes: Math.max(1, Math.min(10080, Number(action.delayMinutes || 1))), remainingActions: 0 });
        break;
      }
      if (type === "branch") {
        const evaluation = evaluateConditionTree(action.conditionTree || { operator: action.conditionMode || "all", conditions: action.conditions || [] }, context);
        const selected = evaluation.matched ? (Array.isArray(action.thenActions) ? action.thenActions : []) : (Array.isArray(action.elseActions) ? action.elseActions : []);
        const branchResults = await executeActionSequence(rule, selected, context, parentRunId, depth + 1, budget);
        results.push({ type: "branch", matched: evaluation.matched, evaluation, results: branchResults });
        continue;
      }
      results.push(await executeAction(rule, action, context));
    }
    return results;
  }

  function collectCreatedRecords(results: any[]): any[] {
    const created: any[] = [];
    for (const result of results) {
      if (result?.record) created.push(result.record);
      if (Array.isArray(result?.results)) created.push(...collectCreatedRecords(result.results));
    }
    return created;
  }

  async function assertActionToolsAvailable(owners: readonly ClusterAdminConfigurableToolId[]) {
    for (const owner of owners) {
      let enabled = false;
      try {
        // Ticket's existing event bridge shares this authoritative callback.
        // Other tool owners use the common runtime gate instead.
        enabled = owner === "tickets" ? Boolean(isTicketsEnabled && await isTicketsEnabled())
          : Boolean(isActionToolEnabled && await isActionToolEnabled(owner));
      } catch (error) {
        logger?.warn?.(error, `${owner} availability verification failed for Project automation`);
      }
      if (!enabled) throw new BackgroundJobDeferredError(`${owner} unavailable; preserve Project automation job.`);
    }
  }

  async function executeRule(ruleOrId: any, options: ExecuteOptions = {}) {
    const rule = typeof ruleOrId === "string" ? await prisma.projectControlRecord.findFirst({ where: { id: ruleOrId, kind: "automation", archived: false } }) : ruleOrId;
    if (!rule) throw new Error("Project automation rule not found.");
    const payload = parseObject(rule.payload);
    const context: AutomationContext = options.context || { trigger: "manual", actorUserId: null, projectId: rule.projectId, sourceType: "automation", sourceId: rule.id, source: { id: rule.id, title: rule.title } };
    const actions = (Array.isArray(options.actionsOverride) ? options.actionsOverride : Array.isArray(payload.actions) ? payload.actions : []).slice(0, 30);
    const preview = actions.map((action: any) => actionPreview(action, rule));
    const conditionEvaluation = options.skipConditions ? { matched: true, operator: "deferred_resume", results: [] } : evaluateConditionTree(ruleConditionTree(payload), context);
    if (options.dryRun) return { ok: true, dryRun: true, matched: conditionEvaluation.matched, conditionEvaluation, actions: preview, created: [], results: [] };
    if (payload.enabled === false || rule.status === "paused") return { ok: true, skipped: true, reason: "disabled", conditionEvaluation, actions: preview, created: [], results: [] };
    if (automationGovernanceState(rule, payload) !== "published") return { ok: true, skipped: true, reason: "draft", conditionEvaluation, actions: preview, created: [], results: [] };
    if (!conditionEvaluation.matched) return { ok: true, skipped: true, reason: "conditions", conditionEvaluation, actions: preview, created: [], results: [] };
    // Resolve policy before recording a run or committing a single action.
    // This also protects direct callers, not just the durable worker. Rules
    // remain Project-owned, but actions may write to separately disabled tools.
    await assertActionToolsAvailable([
      ...new Set([...automationJobRequiredToolOwners("automation.project-rule", { options: { context } }), ...automationActionToolOwners(actions)]),
    ]);
    const key = options.idempotencyKey || context.eventId || `${context.trigger}:${context.sourceType}:${context.sourceId}:${new Date().toISOString()}`;
    const id = runId(rule.id, key);
    const existing = await prisma.clusterPersistenceRecord.findUnique({ where: { id } });
    if (existing && !options.retryOf) return { ok: true, skipped: true, reason: "duplicate", runId: existing.id, actions: preview, created: [], results: [] };
    const retrySource = options.retryOf ? await prisma.clusterPersistenceRecord.findUnique({ where: { id: options.retryOf } }) : null;
    const attempt = options.retryOf ? Number(parseObject(retrySource?.payload).attempt || 1) + 1 : 1;
    const runPayload = { ruleId: rule.id, ruleTitle: rule.title, ownerId: rule.ownerId || null, context, conditionEvaluation, actions: preview, executionActions: options.actionsOverride ? actions : undefined, results: [], retryOf: options.retryOf || null, deferredOf: options.deferredOf || null, attempt, startedAt: new Date().toISOString() };
    await prisma.clusterPersistenceRecord.upsert({ where: { id }, create: { id, kind: "projectAutomationRun", title: rule.title, projectId: rule.projectId, entityType: "projectAutomationRun", entityId: id, ownerId: rule.ownerId, status: "running", visibility: "internal", sourceKey: "project-automation", payload: safeJson(runPayload), revision: 1 }, update: { status: "running", archived: false, validationState: null, validationSummary: null, payload: safeJson(runPayload), revision: { increment: 1 } } });
    const results: any[] = [];
    try {
      results.push(...await executeActionSequence(rule, actions, context, id));
      const finished = { ...runPayload, results, completedAt: new Date().toISOString() };
      await prisma.clusterPersistenceRecord.update({ where: { id }, data: { status: "completed", payload: safeJson(finished), syncedAt: new Date(), revision: { increment: 1 } } });
      await updateRuleResult(rule, payload, { runId: id, trigger: context.trigger, results, actions: preview.length }, false);
      await logActivity({ userId: context.actorUserId, projectId: rule.projectId, type: "automation_run", entityType: "project_automation", entityId: rule.id, title: "Project automation executed", message: `${rule.title} · ${results.length} action${results.length === 1 ? "" : "s"}`, metadata: { automationRuleId: rule.id, runId: id, notifyInbox: Boolean(payload.notifyOnSuccess), userIds: [rule.ownerId].filter(Boolean) } });
      return { ok: true, dryRun: false, runId: id, conditionEvaluation, actions: preview, results, created: collectCreatedRecords(results) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = { ...runPayload, results, error: message, failedAt: new Date().toISOString(), retryManagedBy: "background-job" };
      await prisma.clusterPersistenceRecord.update({ where: { id }, data: { status: "failed", validationState: "invalid", validationSummary: message.slice(0, 1000), payload: safeJson(failed), syncedAt: new Date(), revision: { increment: 1 } } });
      await updateRuleResult(rule, payload, { runId: id, trigger: context.trigger, error: message, completedActions: results.length, retryManagedBy: "background-job" }, true);
      await logActivity({ userId: context.actorUserId, projectId: rule.projectId, type: "automation_failed", entityType: "project_automation", entityId: rule.id, title: "Project automation failed", message, metadata: { automationRuleId: rule.id, runId: id, notifyInbox: Boolean(payload.notifyOnFailure !== false), userIds: [rule.ownerId].filter(Boolean), priority: "high" } }).catch(() => undefined);
      throw error;
    }
  }

  async function evaluateContext(context: AutomationContext) {
    if (Number(context.depth || 0) >= 3) return [];
    const rules = await prisma.projectControlRecord.findMany({ where: { projectId: context.projectId, kind: "automation", archived: false, status: { not: "paused" } } });
    const matching = rules.filter((rule: any) => {
      const payload = parseObject(rule.payload);
      return payload.enabled !== false && automationGovernanceState(rule, payload) === "published" && String(payload.trigger || "manual") === context.trigger;
    });
    const results = [];
    for (const rule of matching) {
      try { results.push(await enqueueRuleExecution(rule, { context, idempotencyKey: context.eventId ? `${context.eventId}:${context.trigger}` : undefined })); }
      catch (error) { logger?.warn?.(error, `project automation ${rule.id} enqueue failed`); }
    }
    return results;
  }

  async function evaluateOverdue(projectId?: string | null) {
    const rules = await prisma.projectControlRecord.findMany({ where: { projectId: projectId || undefined, kind: "automation", archived: false, status: { not: "paused" } } });
    let evaluated = 0;
    for (const rule of rules) {
      const payload = parseObject(rule.payload);
      if (payload.enabled === false || automationGovernanceState(rule, payload) !== "published" || payload.trigger !== "record_overdue") continue;
      const overdue = await prisma.projectControlRecord.findMany({ where: { projectId: rule.projectId, archived: false, dueDate: { lt: new Date() }, status: { notIn: ["done", "completed", "resolved", "approved", "accepted", "closed", "published", "cancelled"] }, kind: { not: "automation" } }, take: 200 });
      for (const record of overdue) {
        const day = new Date().toISOString().slice(0, 10);
        await enqueueRuleExecution(rule, { context: { trigger: "record_overdue", projectId: rule.projectId, sourceType: String(record.kind), sourceId: record.id, source: { ...record, payload: parseObject(record.payload) } }, idempotencyKey: `overdue:${record.id}:${day}` }).catch((error) => logger?.warn?.(error, `overdue automation ${rule.id} enqueue failed`));
        evaluated += 1;
      }
    }
    return { evaluated };
  }

  async function evaluateScheduled(projectId?: string | null) {
    const now = new Date();
    const rules = await prisma.projectControlRecord.findMany({ where: { projectId: projectId || undefined, kind: "automation", archived: false, status: { not: "paused" } } });
    let recurring = 0;
    for (const rule of rules) {
      const payload = parseObject(rule.payload);
      if (payload.enabled === false || automationGovernanceState(rule, payload) !== "published" || payload.trigger !== "recurring") continue;
      const intervalMs = recurrenceIntervalMs(payload);
      const last = payload.lastRunAt ? new Date(payload.lastRunAt).getTime() : 0;
      if (last && now.getTime() - last < intervalMs) continue;
      const bucket = Math.floor(now.getTime() / intervalMs);
      await enqueueRuleExecution(rule, { context: { trigger: "recurring", projectId: rule.projectId, sourceType: "automation", sourceId: rule.id, source: { id: rule.id, title: rule.title, scheduledAt: now.toISOString(), instanceKey: String(bucket) } }, idempotencyKey: `recurring:${bucket}` }).catch((error) => logger?.warn?.(error, `recurring automation ${rule.id} enqueue failed`));
      recurring += 1;
    }

    // Delays and retries are owned by the shared BackgroundJob runtime.
    const overdue = await evaluateOverdue(projectId);
    return { evaluated: overdue.evaluated + recurring, overdue: overdue.evaluated, recurring, retries: 0, deferred: 0 };
  }

  async function executeDurableJob(payload: any, attempt = 1) {
    const ruleId = String(payload?.ruleId || "").trim();
    if (!ruleId) throw new Error("Project automation job is missing a rule ID.");
    const rule = await prisma.projectControlRecord.findFirst({ where: { id: ruleId, kind: "automation", archived: false } });
    if (!rule) throw new Error("Project automation rule not found.");
    const options = parseObject(payload?.options) as ExecuteOptions;
    const idempotencyKey = String(options.idempotencyKey || options.context?.eventId || `${options.context?.trigger || "manual"}:${options.context?.sourceType || "automation"}:${options.context?.sourceId || rule.id}`);
    // executeRule evaluates current stored actions and context before any
    // mutations, including direct/manual execution and nested branches.
    try {
      return await executeRule(rule, {
        ...options,
        idempotencyKey,
        retryOf: attempt > 1 ? runId(rule.id, idempotencyKey) : options.retryOf || null,
      });
    } catch (error) {
      if (error instanceof BackgroundJobDeferredError) throw error;
      const baseDelay = Math.max(1_000, Math.min(24 * 60 * 60_000, Number(payload?.retryBackoffMs || 5 * 60_000)));
      const retryDelayMs = Math.min(24 * 60 * 60_000, baseDelay * Math.max(1, attempt));
      throw new BackgroundJobRetryError(error instanceof Error ? error.message : String(error), retryDelayMs, error);
    }
  }

  async function listRuns(projectId: string, ruleId?: string | null, limit = 100) {
    const rows = await prisma.clusterPersistenceRecord.findMany({ where: { projectId, kind: "projectAutomationRun", archived: false }, orderBy: { updatedAt: "desc" }, take: Math.min(300, Math.max(1, limit)) });
    return rows.map((row: any) => ({ id: row.id, projectId: row.projectId, ruleId: parseObject(row.payload).ruleId, title: row.title, status: row.status, validationSummary: row.validationSummary, payload: parseObject(row.payload), createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision })).filter((row: any) => !ruleId || row.ruleId === ruleId);
  }

  events.subscribe(CLUSTER_DOMAIN_EVENTS.activityRecorded.type, "projects.automation-activity", async (event: any) => {
    const activity = event.payload;
    const metadata = parseObject(activity?.metadata);
    const entityType = String(activity?.entityType || "").toLowerCase();
    if (entityType === "ticket" && isTicketsEnabled && !(await isTicketsEnabled())) return;
    const context = await loadActivityContext(prisma, activity);
    if (!context) return;
    // Card events may represent Tickets. Do not suppress ordinary Board cards.
    if (entityType === "card" && context.source?.workItemKind === "ticket" && isTicketsEnabled && !(await isTicketsEnabled())) return;
    context.depth = Number(metadata.automationDepth || 0);
    await evaluateContext(context);
  });

  return { executeRule, enqueueRuleExecution, executeDurableJob, evaluateContext, evaluateOverdue, evaluateScheduled, listRuns };
}
