import { createHash } from "node:crypto";
import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";
import type { BackgroundJobRecord } from "../jobs/job-types.js";
import { BackgroundJobDeferredError } from "../jobs/job-types.js";
import { automationJobRequiredToolOwners } from "../jobs/job-tool-ownership.js";
import type { ClusterAdminConfigurableToolId } from "@cluster/shared";
import { createDecisionService } from "../decisions/decision-service.js";

const RULE_SCOPE = "studio";
const RULE_SCOPE_ID = "studio";
const RULE_KEY = "automation.rules";
const RUN_KIND = "studioAutomationRun";
const EVENT_KIND = "studioAutomationEvent";

export type StudioAutomationAction = { id: string; type: string; value: string };
export type StudioAutomationCondition = { id: string; field: string; operator: string; value: string };
export type StudioAutomationRule = {
  id: string;
  name: string;
  trigger: string;
  conditions: StudioAutomationCondition[];
  actions: StudioAutomationAction[];
  priority: number;
  projectId: string;
  delayMinutes: number;
  maxRetries: number;
  stopProcessing: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt?: string;
};
export type AutomationEvent = {
  id?: string;
  trigger: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  projectId?: string | null;
  context?: Record<string, unknown>;
  createdAt?: string;
};

type Dependencies = {
  prisma: any;
  logActivity: (input: Record<string, unknown>) => Promise<unknown>;
  logger?: { warn?: (...args: any[]) => void };
  jobQueue: BackgroundJobQueue;
  /** Authoritative Studio policy for queued tool-origin actions. */
  isActionToolEnabled?: (owner: ClusterAdminConfigurableToolId) => Promise<boolean>;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function nowIso() { return new Date().toISOString(); }
function stableId(prefix: string, value: string) { return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`; }
function list(value: unknown) { return Array.isArray(value) ? value.map(String) : parseJson<string[]>(value, []); }
function unique(values: string[]) { return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))); }
function addDays(days: number) { return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function actionAssignment(value: string) {
  const [fieldId, ...rest] = String(value || "").split("::");
  return { fieldId: fieldId.trim(), value: rest.join("::").trim() };
}

export function defaultStudioAutomationRules(): StudioAutomationRule[] {
  const createdAt = nowIso();
  return [
    { id: "auto-urgent-inbox", name: "Escalate urgent tickets", trigger: "ticket_urgent", conditions: [], actions: [{ id: "auto-urgent-inbox-action", type: "notify_inbox", value: "attention" }], priority: 90, projectId: "", delayMinutes: 0, maxRetries: 3, stopProcessing: false, enabled: true, createdAt },
    { id: "auto-security-label", name: "Label security tickets", trigger: "ticket_created", conditions: [{ id: "auto-security-condition", field: "type", operator: "equals", value: "Security" }], actions: [{ id: "auto-security-label-action", type: "add_label", value: "security-review" }, { id: "auto-security-approval-action", type: "request_approval", value: "Security review" }], priority: 80, projectId: "", delayMinutes: 0, maxRetries: 3, stopProcessing: false, enabled: true, createdAt },
    { id: "auto-art-department", name: "Route art requests", trigger: "ticket_created", conditions: [{ id: "auto-art-condition", field: "type", operator: "equals", value: "Art Request" }], actions: [{ id: "auto-art-action", type: "assign_department", value: "Art" }], priority: 60, projectId: "", delayMinutes: 0, maxRetries: 2, stopProcessing: false, enabled: true, createdAt },
  ];
}

function contextValue(context: Record<string, unknown>, field: string) {
  if (field.startsWith("custom.")) {
    const values = context.customValues && typeof context.customValues === "object" ? context.customValues as Record<string, unknown> : {};
    return values[field.slice("custom.".length)];
  }
  return context[field];
}
function conditionMatches(condition: StudioAutomationCondition, context: Record<string, unknown>) {
  const actual = contextValue(context, condition.field);
  const actualText = Array.isArray(actual) ? actual.join(",") : String(actual ?? "").trim();
  const expected = String(condition.value || "").trim();
  if (condition.operator === "is_empty") return !actualText;
  if (condition.operator === "is_not_empty") return Boolean(actualText);
  if (condition.operator === "not_equals") return actualText.toLowerCase() !== expected.toLowerCase();
  if (condition.operator === "contains") return actualText.toLowerCase().includes(expected.toLowerCase());
  if (condition.operator === "in") return expected.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean).includes(actualText.toLowerCase());
  return actualText.toLowerCase() === expected.toLowerCase();
}
function ruleMatches(rule: StudioAutomationRule, event: AutomationEvent, context: Record<string, unknown>) {
  if (!rule.enabled || rule.trigger !== event.trigger) return false;
  if (rule.projectId && rule.projectId !== event.projectId) return false;
  return rule.conditions.every((condition) => conditionMatches(condition, context));
}
function serializeRecord(record: any) {
  return { id: record.id, ...parseJson<Record<string, unknown>>(record.payload, {}), status: record.status, revision: Number(record.revision || 1), createdAt: record.createdAt, updatedAt: record.updatedAt };
}

export function createStudioAutomationService({ prisma, logActivity, logger, jobQueue, isActionToolEnabled }: Dependencies) {
  const decisions = createDecisionService(prisma);
  async function rulesRecord() {
    return prisma.clientStateRecord.findUnique({ where: { scope_scopeId_key: { scope: RULE_SCOPE, scopeId: RULE_SCOPE_ID, key: RULE_KEY } } });
  }
  async function readRules() {
    const record = await rulesRecord();
    const rules = record ? parseJson<StudioAutomationRule[]>(record.payload, []) : [];
    return { rules: record ? rules : defaultStudioAutomationRules(), revision: record ? Number(record.revision || 1) : 0, updatedAt: record?.updatedAt || null };
  }
  async function saveRules(input: StudioAutomationRule[], expectedRevision: number) {
    // A stale Settings editor must never silently overwrite a newer rule set.
    // Revision 0 represents the original empty/default state, not a wildcard.
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Automation rule writes require the original read revision.");
    const payload = JSON.stringify(input);
    const existing = await rulesRecord();
    if (!existing) {
      if (expectedRevision !== 0) return { conflict: true, current: await readRules() };
      try {
        const record = await prisma.clientStateRecord.create({ data: { scope: RULE_SCOPE, scopeId: RULE_SCOPE_ID, key: RULE_KEY, payload, revision: 1 } });
        return { conflict: false, rules: parseJson(record.payload, []), revision: record.revision, updatedAt: record.updatedAt };
      } catch (error) {
        // Two administrators can both write the initial rule set. The unique
        // record constraint decides the winner, the loser gets a 409.
        if ((error as { code?: string })?.code === "P2002") return { conflict: true, current: await readRules() };
        throw error;
      }
    }
    if (expectedRevision !== Number(existing.revision || 1)) return { conflict: true, current: await readRules() };
    const result = await prisma.clientStateRecord.updateMany({ where: { id: existing.id, revision: expectedRevision }, data: { payload, revision: { increment: 1 } } });
    if (result.count !== 1) return { conflict: true, current: await readRules() };
    const record = await rulesRecord();
    return { conflict: false, rules: parseJson(record.payload, []), revision: record.revision, updatedAt: record.updatedAt };
  }

  async function appendRun(input: Record<string, unknown>) {
    const createdAt = nowIso();
    const payload = { ...input, createdAt };
    return prisma.clusterPersistenceRecord.create({ data: {
      id: stableId("automation_run", `${createdAt}:${input.ruleId || "rule"}:${input.entityType || "entity"}:${input.entityId || input.entityLabel || "unknown"}:${Math.random()}`),
      kind: RUN_KIND, title: String(input.ruleName || "Automation"), projectId: input.projectId ? String(input.projectId) : null,
      entityType: String(input.entityType || "automation"), entityId: input.entityId ? String(input.entityId) : null,
      status: String(input.status || "executed"), sourceKey: input.ruleId ? String(input.ruleId) : null,
      payload: JSON.stringify(payload), syncedAt: new Date(), revision: 1,
    } });
  }

  async function createInboxActivity(rule: StudioAutomationRule, event: AutomationEvent, message: string, actorId?: string | null) {
    const context = event.context || {};
    const targetIds = unique([String(context.assigneeId || ""), String(context.userId || ""), String(context.targetUserId || ""), String(actorId || "")]);
    await logActivity({
      userId: actorId || null, projectId: event.projectId || null, cardId: event.entityType === "ticket" ? event.entityId : null,
      type: "automation", entityType: event.entityType, entityId: event.entityId, title: rule.name, message,
      metadata: { userIds: targetIds, ruleId: rule.id, trigger: event.trigger, automation: true },
    });
  }

  async function upsertCustomField(event: AutomationEvent, action: StudioAutomationAction, actorId?: string | null) {
    const assignment = actionAssignment(action.value);
    if (!assignment.fieldId) throw new Error("Custom field action is missing a field ID.");
    const identity = `${event.entityType}:${event.entityId}:${assignment.fieldId}`;
    const id = stableId("customFieldValue", identity);
    const payload = { id: identity, entity: event.entityType, entityId: event.entityId, fieldId: assignment.fieldId, projectId: event.projectId || null, value: assignment.value, updatedAt: nowIso(), updatedBy: actorId || undefined };
    const existing = await prisma.clusterPersistenceRecord.findUnique({ where: { id } });
    const data = { kind: "customFieldValue", title: `${event.entityType} ${event.entityId}: ${assignment.fieldId}`, projectId: event.projectId || null, entityType: event.entityType, entityId: event.entityId, status: assignment.fieldId, sourceKey: "studio-automation", payload: JSON.stringify(payload), archived: false, deletedAt: null, syncedAt: new Date() };
    if (existing) await prisma.clusterPersistenceRecord.update({ where: { id }, data: { ...data, revision: { increment: 1 } } });
    else await prisma.clusterPersistenceRecord.create({ data: { id, ...data, revision: 1 } });
  }

  async function executeAction(rule: StudioAutomationRule, action: StudioAutomationAction, event: AutomationEvent, actorId?: string | null) {
    // The durable worker preflight is not an irrevocable grant. A tool can be
    // disabled while rules/records are being loaded; recheck at the mutation
    // boundary and defer without consuming an attempt or recording a failure.
    const owners = automationJobRequiredToolOwners("automation.studio-action", { event });
    for (const owner of owners) {
      let enabled = false;
      try { enabled = Boolean(isActionToolEnabled && await isActionToolEnabled(owner)); }
      catch (error) { logger?.warn?.(error, `Studio automation ${owner} action gate failed`); }
      if (!enabled) throw new BackgroundJobDeferredError(`${owner} is unavailable; preserve Studio automation action.`);
    }
    const context = event.context || {};
    if (action.type === "notify_inbox") {
      await createInboxActivity(rule, event, action.value || `${rule.name} requires attention`, actorId);
      return "Inbox activity created";
    }
    if (action.type === "request_approval") {
      const message = action.value || `Approval requested by ${rule.name}`;
      const approvalId = stableId("automation_approval", `${rule.id}:${event.entityType}:${event.entityId}:${message}`);
      await decisions.request({
        id: approvalId,
        upsert: true,
        type: "automation",
        title: message,
        projectId: event.projectId || null,
        resource: { kind: event.entityType as any, id: event.entityId, ...(event.projectId ? { projectId: event.projectId } : {}) },
        requestedById: actorId || null,
        reason: message,
        sourceKey: rule.id,
        payload: { ruleId: rule.id, trigger: event.trigger, projectId: event.projectId || null },
      });
      await createInboxActivity(rule, event, message, actorId);
      return "Approval request created";
    }
    if (action.type === "set_custom_field") {
      await upsertCustomField(event, action, actorId);
      return "Custom field updated";
    }
    if (event.entityType !== "ticket") return `${action.type.replace(/_/g, " ")} skipped for ${event.entityType}`;
    const card = await prisma.card.findUnique({ where: { id: event.entityId }, include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } });
    if (!card) throw new Error("Ticket not found.");
    if (action.type === "add_comment") {
      await prisma.cardComment.create({ data: { cardId: card.id, userId: actorId || null, body: action.value || `Automation: ${rule.name}` } });
      return "Comment added";
    }
    const data: Record<string, unknown> = {};
    const labels = list(card.labels);
    if (action.type === "add_label" && action.value.trim()) data.labels = JSON.stringify(unique([...labels, action.value.trim()]));
    else if (action.type === "remove_label" && action.value.trim()) data.labels = JSON.stringify(labels.filter((label) => label.toLowerCase() !== action.value.trim().toLowerCase()));
    else if (action.type === "set_priority" && ["low", "medium", "high", "urgent"].includes(action.value)) data.priority = action.value;
    else if (action.type === "assign_user") data.assigneeId = action.value || null;
    else if (action.type === "assign_department") {
      const user = await prisma.user.findFirst({
        where: { archived: false, employment: { is: { active: true, department: { is: { name: { equals: action.value.trim(), mode: "insensitive" } } } } } },
        orderBy: [{ displayName: "asc" }, { username: "asc" }],
      });
      if (!user) throw new Error(`No active user found in ${action.value}.`);
      data.assigneeId = user.id;
    } else if (action.type === "set_due_offset") {
      const days = Number(action.value);
      if (!Number.isFinite(days)) throw new Error("Invalid due-date offset.");
      data.dueDate = new Date(`${addDays(days)}T12:00:00.000Z`);
    } else throw new Error(`Unsupported ticket action: ${action.type}`);
    await prisma.card.update({ where: { id: card.id }, data: { ...data, revision: { increment: 1 } } });
    return `${action.type.replace(/_/g, " ")} applied`;
  }

  function serializeAutomationJob(job: BackgroundJobRecord) {
    const payload = parseJson<any>(job.payload, {});
    const status = job.status === "QUEUED" ? "pending" : job.status === "RUNNING" ? "running" : job.status === "SUCCEEDED" ? "succeeded" : job.status === "CANCELLED" ? "cancelled" : "failed";
    return {
      id: job.id, ruleId: payload.ruleId || "", ruleName: payload.ruleName || "Automation", trigger: payload.trigger || "ticket_created",
      entityType: payload.entityType || "ticket", entityId: payload.entityId || "", projectId: payload.projectId || null, entityLabel: payload.entityLabel || "Automation",
      action: payload.action || { id: "action", type: "notify_inbox", value: "" }, status, attempts: Number(job.attempts || 0), maxRetries: Math.max(0, Number(job.maxAttempts || 1) - 1),
      scheduledFor: job.runAfter?.toISOString?.() || job.runAfter, createdAt: job.createdAt?.toISOString?.() || job.createdAt, updatedAt: job.updatedAt?.toISOString?.() || job.updatedAt,
      lastError: job.lastError || undefined, cardPayload: payload.cardPayload || {},
    };
  }

  async function enqueue(rule: StudioAutomationRule, action: StudioAutomationAction, event: AutomationEvent, actorId?: string | null) {
    const fingerprint = `${rule.id}:${event.id || event.entityId}:${event.entityType}:${event.entityId}:${action.id}:${action.type}:${action.value}`;
    const scheduledFor = new Date(Date.now() + Math.max(0, rule.delayMinutes) * 60_000);
    const payload = {
      ruleId: rule.id, ruleName: rule.name, trigger: rule.trigger, entityType: event.entityType, entityId: event.entityId, projectId: event.projectId || null,
      entityLabel: event.entityLabel, action, event: { ...event, context: event.context || {} }, actorId: actorId || null, createdAt: nowIso(), maxRetries: rule.maxRetries,
    };
    const job = await jobQueue.enqueue({
      type: "automation.studio-action", payload, runAfter: scheduledFor, dedupeKey: `studio-automation:${fingerprint}`, maxAttempts: Math.max(1, rule.maxRetries + 1), createdById: actorId || null, priority: rule.priority - 50,
      authorization: actorId ? {
        actorUserId: actorId,
        action: "contribute",
        resource: event.projectId ? { kind: "project", projectId: event.projectId } : { kind: "tool", tool: "automation" },
        minimum: "contribute",
        tool: "automation",
      } : null,
    });
    await appendRun({ ruleId: rule.id, ruleName: rule.name, trigger: rule.trigger, entityType: event.entityType, entityId: event.entityId, entityLabel: event.entityLabel, projectId: event.projectId || null, status: "queued", result: `${action.type.replace(/_/g, " ")} queued${rule.delayMinutes ? ` for ${rule.delayMinutes}m` : ""}`, jobId: job.id });
    return serializeAutomationJob(job);
  }

  async function processEvent(eventInput: AutomationEvent, actorId?: string | null) {
    // Some callers bypass the Calendar/Ticket event bridge (delivery routes and
    // future first-party extensions). Enforce the same authoritative tool
    // policy before creating any receipt or enqueueing actions. Ignored events
    // are not replayed when the Studio re-enables the source tool.
    for (const owner of automationJobRequiredToolOwners("automation.studio-action", { event: eventInput })) {
      let enabled = false;
      try { enabled = Boolean(isActionToolEnabled && await isActionToolEnabled(owner)); }
      catch (error) { logger?.warn?.(error, `Studio automation ${owner} source gate failed`); }
      if (!enabled) return [];
    }
    const event: AutomationEvent = { ...eventInput, id: eventInput.id || stableId("automation_event", `${eventInput.trigger}:${eventInput.entityType}:${eventInput.entityId}:${eventInput.createdAt || nowIso()}`), createdAt: eventInput.createdAt || nowIso(), context: eventInput.context || {} };
    const receiptId = stableId("automation_event_receipt", String(event.id));
    try {
      await prisma.clusterPersistenceRecord.create({ data: { id: receiptId, kind: EVENT_KIND, title: event.entityLabel, projectId: event.projectId || null, entityType: event.entityType, entityId: event.entityId, userId: actorId || null, status: "processing", sourceKey: String(event.id), payload: JSON.stringify({ event, outcomes: [] }), syncedAt: new Date(), revision: 1 } });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") return [];
      throw error;
    }
    const { rules } = await readRules();
    const context = { ...(event.context || {}), entityType: event.entityType, entityId: event.entityId, projectId: event.projectId || "", title: event.entityLabel };
    const outcomes: Record<string, unknown>[] = [];
    for (const rule of [...rules].sort((a, b) => b.priority - a.priority)) {
      if (!ruleMatches(rule, event, context)) continue;
      for (const action of rule.actions) {
        try {
          const job = await enqueue(rule, action, event, actorId);
          outcomes.push({ ruleId: rule.id, actionId: action.id, status: "queued", jobId: job.id });
        } catch (error) {
          const result = error instanceof Error ? error.message : "Automation action failed.";
          await appendRun({ ruleId: rule.id, ruleName: rule.name, trigger: rule.trigger, entityType: event.entityType, entityId: event.entityId, entityLabel: event.entityLabel, projectId: event.projectId || null, status: "failed", result });
          outcomes.push({ ruleId: rule.id, actionId: action.id, status: "failed", result });
        }
      }
      if (rule.stopProcessing) break;
    }
    await prisma.clusterPersistenceRecord.update({ where: { id: receiptId }, data: { status: "completed", payload: JSON.stringify({ event, outcomes }), syncedAt: new Date(), revision: { increment: 1 } } });
    return outcomes;
  }

  async function previewTicket(input: any) {
    const { rules } = await readRules();
    const event: AutomationEvent = { trigger: String(input.trigger || (input.severity === "urgent" || input.severity === "high" ? "ticket_urgent" : "ticket_created")), entityType: "ticket", entityId: "preview", entityLabel: String(input.title || input.type || "Ticket"), projectId: input.projectId || null, context: {} };
    let priority = String(input.severity || input.priority || "medium");
    let assigneeId = String(input.assigneeId || "");
    let labels = unique(String(input.labels || "").split(","));
    let dueDate = String(input.dueDate || "");
    const customFieldValues = { ...(input.customValues && typeof input.customValues === "object" ? input.customValues : {}) } as Record<string, string | boolean>;
    const activationActions: Array<{ ruleId: string; actionId: string }> = [];
    const inboxSignals: string[] = [];
    const matched: string[] = [];
    for (const rule of [...rules].sort((a, b) => b.priority - a.priority)) {
      const context = { type: input.type || "", priority, severity: priority, department: input.department || "", projectId: input.projectId || "", title: input.title || "", customValues: customFieldValues };
      const triggers = new Set(["ticket_created", ...(priority === "urgent" || priority === "high" ? ["ticket_urgent"] : [])]);
      if (!rule.enabled || !triggers.has(rule.trigger) || (rule.projectId && rule.projectId !== input.projectId) || !rule.conditions.every((condition) => conditionMatches(condition, context))) continue;
      matched.push(rule.name);
      for (const action of rule.actions) {
        if (rule.delayMinutes > 0 || ["add_comment", "request_approval", "notify_inbox"].includes(action.type)) {
          activationActions.push({ ruleId: rule.id, actionId: action.id });
          if (action.type === "notify_inbox") inboxSignals.push(rule.name);
          continue;
        }
        if (action.type === "set_priority" && ["low", "medium", "high", "urgent"].includes(action.value)) priority = action.value;
        else if (action.type === "add_label" && action.value.trim()) labels = unique([...labels, action.value.trim()]);
        else if (action.type === "remove_label" && action.value.trim()) labels = labels.filter((label) => label.toLowerCase() !== action.value.trim().toLowerCase());
        else if (action.type === "assign_user" && action.value.trim()) assigneeId = action.value.trim();
        else if (action.type === "assign_department" && !assigneeId) {
          const user = await prisma.user.findFirst({
            where: { archived: false, employment: { is: { active: true, department: { is: { name: { equals: action.value.trim(), mode: "insensitive" } } } } } },
            orderBy: [{ displayName: "asc" }, { username: "asc" }],
          });
          if (user) assigneeId = user.id;
        } else if (action.type === "set_due_offset") {
          const days = Number(action.value); if (Number.isFinite(days)) dueDate = addDays(days);
        } else if (action.type === "set_custom_field") {
          const assignment = actionAssignment(action.value); if (assignment.fieldId) customFieldValues[assignment.fieldId] = assignment.value;
        }
      }
      if (rule.stopProcessing) break;
    }
    return { priority, assigneeId, labels, dueDate, customFieldValues, matched, inboxSignals, deferredActions: activationActions };
  }

  async function activateTicket(cardId: string, context: Record<string, unknown>, actionRefs: Array<{ ruleId: string; actionId: string }>, actorId?: string | null) {
    // Direct service entrypoints must honor Studio tool authority too.
    if (isActionToolEnabled && !(await isActionToolEnabled("tickets"))) {
      throw new BackgroundJobDeferredError("Tickets is unavailable; activation was not enqueued.");
    }
    const card = await prisma.card.findUnique({ where: { id: cardId }, include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } });
    if (!card) throw new Error("Ticket not found.");
    const { rules } = await readRules();
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    const event: AutomationEvent = { id: `ticket-created:${card.id}`, trigger: "ticket_created", entityType: "ticket", entityId: card.id, entityLabel: card.title, projectId: card.list.board.project.id, context: { ...context, title: card.title, priority: card.priority, labels: list(card.labels), assigneeId: card.assigneeId, dueDate: card.dueDate?.toISOString?.() || null } };
    const outcomes = [];
    for (const reference of actionRefs) {
      const rule = byId.get(reference.ruleId); const action = rule?.actions.find((item) => item.id === reference.actionId);
      if (!rule || !action || !rule.enabled) continue;
      outcomes.push(await enqueue(rule, action, event, actorId));
    }
    return outcomes;
  }

  async function executeDurableJob(payload: any, attempt = 1) {
    const { rules } = await readRules();
    const rule = rules.find((candidate) => candidate.id === String(payload.ruleId || ""));
    if (!rule) throw new Error("Studio automation rule no longer exists.");
    if (!rule.enabled) throw new Error("Studio automation rule is disabled.");
    const action = rule.actions.find((candidate) => candidate.id === String(payload.action?.id || ""));
    if (!action) throw new Error("Studio automation action no longer exists on the current rule.");
    const currentEvent = { ...payload.event, projectId: payload.event?.projectId || payload.projectId || null };
    const context = { ...(currentEvent.context || {}), entityType: currentEvent.entityType, entityId: currentEvent.entityId, projectId: currentEvent.projectId || "", title: currentEvent.entityLabel };
    if (!ruleMatches(rule, currentEvent, context)) throw new Error("Studio automation rule no longer matches this queued event.");
    // A queued action can outlive the originating tool's disable event. Keep
    // the durable job (no attempt consumed), and never log a policy pause as
    // an automation failure. This also protects direct service callers.
    for (const owner of automationJobRequiredToolOwners("automation.studio-action", { ...payload, event: currentEvent })) {
      let enabled = false;
      try { enabled = Boolean(isActionToolEnabled && await isActionToolEnabled(owner)); }
      catch (error) { logger?.warn?.(error, `Studio automation ${owner} availability lookup failed`); }
      if (!enabled) throw new BackgroundJobDeferredError(`${owner} is unavailable; preserve Studio automation job.`);
    }
    try {
      const result = await executeAction(rule, action, currentEvent, payload.actorId || null);
      await appendRun({ ruleId: payload.ruleId, ruleName: payload.ruleName, trigger: payload.trigger, entityType: payload.entityType, entityId: payload.entityId, entityLabel: payload.entityLabel, projectId: payload.projectId || null, status: "executed", result, attempt });
      return { result, ruleId: rule.id, actionId: action.id, attempt };
    } catch (error) {
      // A disable race after the worker's first check is a policy pause,
      // never an action failure or a consumed retry attempt.
      if (error instanceof BackgroundJobDeferredError) throw error;
      const message = error instanceof Error ? error.message : "Automation action failed.";
      await appendRun({ ruleId: payload.ruleId, ruleName: payload.ruleName, trigger: payload.trigger, entityType: payload.entityType, entityId: payload.entityId, entityLabel: payload.entityLabel, projectId: payload.projectId || null, status: "failed", result: message, attempt });
      throw error;
    }
  }


  async function listRuns(limit = 100) {
    const rows = await prisma.clusterPersistenceRecord.findMany({
      where: { kind: RUN_KIND, archived: false },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(500, Math.round(Number(limit) || 100))),
    });
    return rows.map(serializeRecord);
  }

  async function listJobs(limit = 100) {
    const rows = await jobQueue.list({ type: "automation.studio-action", limit: Math.max(1, Math.min(500, Math.round(Number(limit) || 100))) });
    return rows.map(serializeAutomationJob);
  }

  async function processDue(force = false, jobId?: string | null) {
    if (jobId) {
      const job = await jobQueue.runNow(String(jobId));
      return job ? [serializeAutomationJob(job)] : [];
    }
    const jobs = await jobQueue.list({ type: "automation.studio-action", status: "QUEUED", limit: 250 });
    if (force) {
      const updated = [];
      for (const job of jobs) {
        const ready = await jobQueue.runNow(job.id);
        if (ready) updated.push(serializeAutomationJob(ready));
      }
      return updated;
    }
    const now = Date.now();
    return jobs.filter((job) => new Date(job.runAfter).getTime() <= now).map(serializeAutomationJob);
  }

  async function cancelJob(jobId: string) {
    const job = await jobQueue.cancel(jobId);
    return job ? serializeAutomationJob(job) : null;
  }

  async function clearCompleted() {
    return jobQueue.clearTerminalByType("automation.studio-action");
  }

  return { readRules, saveRules, previewTicket, activateTicket, processEvent, processDue, listRuns, listJobs, cancelJob, clearCompleted, executeDurableJob };
}
