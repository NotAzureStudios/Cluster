import { CLUSTER_PROJECT_STATUSES, PACKET_COMPLIANCE_DATA_FIELDS, PEOPLE_DATA_FIELDS, POLICY_COMPLIANCE_DATA_FIELDS, PROJECT_DATA_FIELDS, TICKET_DATA_FIELDS, normalizeClusterProjectTypeId, resolveClusterProductionProfile, mergeClusterDataFilterGroups, type ClusterDataAggregation, type ClusterDataQuery, type ClusterMetricDefinition, type ClusterMetricReadModel } from "@cluster/shared";
import type { ClusterDataLayout } from "../core/data-layout.js";
import { ClusterDataExportRegistry } from "../core/data-export.js";
import { ClusterDataMetricRegistry } from "../core/data-metrics.js";
import { normalizeClusterDataQuery } from "../core/data-query.js";
import { ClusterDataImportRegistry } from "../core/data-import.js";
import { resolveSemanticCursor, semanticCursorOrderBy } from "../core/semantic-cursor-pagination.js";
import { buildProjectDataQueryWhere, PROJECT_SEMANTIC_CURSOR_FIELDS, projectDataQueryAnalytics, projectSourceCategory } from "../domains/projects/project-data-query.js";
import { filterPeopleDataRows, peopleDataQueryAnalytics, sortPeopleDataRows } from "../domains/users/people-data-query.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE, workforceAuthorityProjection } from "../domains/workforce/workforce-user-authority.js";
import { buildTicketDataQueryWhere, TICKET_SEMANTIC_CURSOR_FIELDS, ticketDataQueryAnalytics } from "../domains/tickets/ticket-data-query.js";
import { registerClientStateRoutes } from "../domains/client-state/client-state-routes.js";
import { registerDataExportJobHandler } from "../domains/data-exports/data-export-job.js";
import { registerDataExportRoutes } from "../domains/data-exports/data-export-routes.js";
import { registerDataImportJobHandler } from "../domains/data-imports/data-import-job.js";
import { registerDataImportRoutes } from "../domains/data-imports/data-import-routes.js";
import { registerDataMetricRoutes } from "../domains/data-metrics/data-metric-routes.js";
import { registerDataViewRoutes } from "../domains/data-views/data-view-routes.js";
import { BACKGROUND_JOB_DATA_FIELDS } from "../domains/jobs/job-types.js";
import type { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";
import { serializeBackgroundJob } from "../domains/jobs/job-queue-service.js";
import type { DurableJobWorker } from "../domains/jobs/job-worker.js";
import { applyStudioKnowledgeComplianceQuery, studioKnowledgeComplianceRows } from "../domains/studio-systems/studio-knowledge-compliance.js";
import { AUTHORIZATION_RULE_SELECT } from "../domains/access/authorization.js";

function simpleBackgroundJobFilters(query: any) {
  const filter: { status?: string; queue?: string; type?: string } = {};
  const root = query?.filters;
  if (!root) return filter;
  if (root.logic !== "and" || root.groups?.length) throw Object.assign(new Error("Background Job export currently supports AND filters only."), { code: "DATA_EXPORT_FILTER_UNSUPPORTED", statusCode: 400 });
  for (const condition of root.conditions || []) {
    if (condition.operator !== "equals" || !["status", "queue", "type"].includes(condition.fieldId) || typeof condition.value !== "string") {
      throw Object.assign(new Error(`Background Job export does not support ${condition.fieldId}:${condition.operator}.`), { code: "DATA_EXPORT_FILTER_UNSUPPORTED", statusCode: 400 });
    }
    if (condition.fieldId === "status") filter.status = condition.value;
    else if (condition.fieldId === "queue") filter.queue = condition.value;
    else if (condition.fieldId === "type") filter.type = condition.value;
  }
  return filter;
}

function iso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function registerServerDataPlatformRoutes(input: {
  app: any;
  prisma: any;
  dataLayout: ClusterDataLayout;
  getCurrentUser: (request: any) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  authorization: any;
  jobQueue: BackgroundJobQueue;
  jobWorker: DurableJobWorker;
  requireAdminUserForRequest: (request: any, reply: any) => Promise<any | null>;
  logSecurityEvent?: (input: any) => Promise<unknown>;
  logActivity?: (input: any) => Promise<unknown>;
}) {
  registerDataViewRoutes(input);
  registerClientStateRoutes(input);

  async function authorizeToolRequest(request: any, reply: any, tool: string, level: "view" | "edit" | "manage" = "view") {
    const permitted = await input.authorization.requireTool(request, reply, tool, level);
    if (!permitted) return null;
    const user = await input.getCurrentUser(request);
    return user ? { id: user.id } : null;
  }

  async function actorForTool(actorId: string, tool: string, level: "view" | "edit" | "manage" = "view") {
    const user = await input.prisma.user.findUnique({ where: { id: actorId } });
    if (!user || user.archived) return null;
    const decorated = await input.decorateUserForClient(user);
    const role = decorated?.workspaceRole;
    if (!decorated?.isAdmin && !input.authorization.hasToolPermission(user, role, tool, level)) return null;
    return { user, decorated, role };
  }

  async function authorizedProjectScope(actorId: string, level: "view" | "edit" | "manage" = "view") {
    const identity = await actorForTool(actorId, "projects", level);
    if (!identity) return null;
    if (identity.decorated?.isAdmin) return { identity, projectIds: null as string[] | null };
    const [rules, projects] = await Promise.all([
      input.prisma.accessRule.findMany({ where: { status: "active", targetKind: "project" }, select: AUTHORIZATION_RULE_SELECT }),
      input.prisma.project.findMany({ where: { archived: false }, select: { id: true, source: true, archived: true, memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true } } } }),
    ]);
    const projectIds = projects
      .filter((project: any) => input.authorization.hasTargetAccess(identity.user, identity.role, "project", project.id, project, rules, level))
      .map((project: any) => project.id);
    return { identity, projectIds };
  }

  async function authorizedTicketBoardScope(actorId: string, level: "view" | "edit" | "manage" = "view") {
    const identity = await actorForTool(actorId, "tickets", level);
    if (!identity) return null;
    const rules = identity.decorated?.isAdmin ? [] : await input.prisma.accessRule.findMany({ where: { status: "active", targetKind: { in: ["project", "board"] } }, select: AUTHORIZATION_RULE_SELECT });
    const boards = await input.prisma.board.findMany({
      where: { archived: false },
      select: { id: true, project: { select: { id: true, source: true, memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true } } } } },
    });
    const boardIds = boards
      .filter((board: any) => board.project?.source === "system-tickets" || identity.decorated?.isAdmin || input.authorization.hasTargetAccess(identity.user, identity.role, "board", board.id, board.project, rules, level))
      .map((board: any) => board.id);
    return { identity, boardIds };
  }


  const metrics = new ClusterDataMetricRegistry();
  function metricReadModel(definition: ClusterMetricDefinition, value: number | null, count: number, query: ClusterDataQuery, previousValue?: number | null): ClusterMetricReadModel {
    const delta = previousValue == null || value == null ? null : value - previousValue;
    const deltaPercent = previousValue == null || previousValue === 0 || delta == null ? null : (delta / Math.abs(previousValue)) * 100;
    return {
      metricId: definition.id, value, count,
      ...(previousValue !== undefined ? { previousValue, delta, deltaPercent } : {}),
      generatedAt: new Date().toISOString(), scope: "authorized_query", complete: true,
      drilldownQuery: { ...query, page: undefined },
    };
  }

  async function projectMetricValue(actorId: string, query: ClusterDataQuery, aggregation: ClusterDataAggregation) {
    const scope = await authorizedProjectScope(actorId, "view");
    if (!scope) throw Object.assign(new Error("Project metric access denied."), { code: "METRIC_ACCESS_DENIED", statusCode: 403 });
    const normalized = normalizeClusterDataQuery({ ...query, facets: [], projections: [], groups: [], aggregations: [aggregation], page: { limit: 1 } }, { fields: PROJECT_DATA_FIELDS, defaultLimit: 1, maxLimit: 1 });
    const where = await buildProjectDataQueryWhere({ prisma: input.prisma, query: normalized, authorizedProjectIds: scope.projectIds, includeArchived: false });
    const analytics = await projectDataQueryAnalytics(input.prisma, where, normalized);
    return { value: aggregation.kind === "count" && !aggregation.fieldId ? analytics.total : analytics.aggregations[aggregation.id] ?? null, count: analytics.total, query: normalized };
  }

  function peopleDataRow(user: any) {
    const workforce = workforceAuthorityProjection(user);
    return {
      id: user.id,
      displayName: user.preferredName || user.displayName || user.username,
      username: user.username,
      ...workforce,
      updatedAt: iso(user.updatedAt),
    };
  }

  async function canonicalPeopleRows(where: Record<string, any> = {}) {
    const users = await input.prisma.user.findMany({
      where: { archived: false, ...where },
      include: WORKFORCE_USER_AUTHORITY_INCLUDE,
      orderBy: { updatedAt: "desc" },
    });
    return users.map(peopleDataRow);
  }

  async function peopleMetricValue(actorId: string, query: ClusterDataQuery, aggregation: ClusterDataAggregation) {
    if (!(await actorForTool(actorId, "people", "view"))) throw Object.assign(new Error("People metric access denied."), { code: "METRIC_ACCESS_DENIED", statusCode: 403 });
    const normalized = normalizeClusterDataQuery({ ...query, facets: [], projections: [], groups: [], aggregations: [aggregation], page: { limit: 1 } }, { fields: PEOPLE_DATA_FIELDS, defaultLimit: 1, maxLimit: 1 });
    const rows = filterPeopleDataRows(await canonicalPeopleRows(), normalized);
    const analytics = peopleDataQueryAnalytics(rows, normalized);
    return { value: aggregation.kind === "count" && !aggregation.fieldId ? analytics.total : analytics.aggregations[aggregation.id] ?? null, count: analytics.total, query: normalized };
  }

  async function ticketMetricValue(actorId: string, query: ClusterDataQuery, aggregation: ClusterDataAggregation) {
    const scope = await authorizedTicketBoardScope(actorId, "view");
    if (!scope) throw Object.assign(new Error("Ticket metric access denied."), { code: "METRIC_ACCESS_DENIED", statusCode: 403 });
    const normalized = normalizeClusterDataQuery({ ...query, facets: [], projections: [], groups: [], aggregations: [aggregation], page: { limit: 1 } }, { fields: TICKET_DATA_FIELDS, defaultLimit: 1, maxLimit: 1 });
    const where = buildTicketDataQueryWhere({ query: normalized, authorizedBoardIds: scope.boardIds });
    const analytics = await ticketDataQueryAnalytics(input.prisma, where, normalized, scope.boardIds);
    return { value: aggregation.kind === "count" && !aggregation.fieldId ? analytics.total : analytics.aggregations[aggregation.id] ?? null, count: analytics.total, query: normalized };
  }

  const projectCountMetric: ClusterMetricDefinition = { id: "projects.count", label: "Projects", description: "Accessible active Projects matching the canonical Project Data Query.", resourceKind: "project", kind: "count", direction: "neutral", dimensions: ["status", "projectType", "source", "schedule", "priority"], timeFieldId: "updatedAt", display: { format: "integer" }, drilldown: { presentation: "table" } };
  const peopleCapacityMetric: ClusterMetricDefinition = { id: "people.capacity_total", label: "People capacity", description: "Total configured weekly capacity across the authorized People query.", resourceKind: "user", kind: "sum", fieldId: "capacityHours", direction: "neutral", dimensions: ["department", "teamName", "status"], timeFieldId: "updatedAt", display: { format: "number", unit: "h/week" }, drilldown: { presentation: "table" } };
  const ticketCountMetric: ClusterMetricDefinition = { id: "tickets.count", label: "Tickets", description: "Accessible Tickets matching the canonical Ticket Data Query.", resourceKind: "ticket", kind: "count", direction: "lower_better", dimensions: ["priority", "projectName", "listTitle", "queueLane"], timeFieldId: "updatedAt", display: { format: "integer" }, drilldown: { presentation: "table" } };
  const urgentTicketMetric: ClusterMetricDefinition = { id: "tickets.urgent_count", label: "Urgent tickets", description: "Accessible urgent Tickets matching the canonical Ticket Data Query.", resourceKind: "ticket", kind: "count", direction: "lower_better", dimensions: ["projectName", "listTitle", "queueLane"], timeFieldId: "updatedAt", display: { format: "integer" }, defaultThresholds: [{ id: "urgent-present", label: "Urgent work present", operator: "gt", value: 0, severity: "warning" }], drilldown: { presentation: "table", query: { filters: { logic: "and", conditions: [{ fieldId: "priority", operator: "equals", value: "urgent" }] } } } };
  const urgentTicketQuery = (query: ClusterDataQuery): ClusterDataQuery => ({ ...query, filters: mergeClusterDataFilterGroups(query.filters, urgentTicketMetric.drilldown?.query?.filters) });

  metrics.register({
    definition: projectCountMetric,
    authorizeActor: async (actorId) => Boolean(await actorForTool(actorId, "projects", "view")),
    read: async ({ actorId, query, compare }) => {
      const current = await projectMetricValue(actorId, query, { id: "metric", kind: "count", label: "Projects" });
      const previous = compare ? await projectMetricValue(actorId, { ...query, timeRange: { fieldId: "updatedAt", from: compare.from, to: compare.to } }, { id: "metric", kind: "count", label: "Projects" }) : null;
      return metricReadModel(projectCountMetric, current.value, current.count, current.query, previous?.value);
    },
  });
  metrics.register({
    definition: peopleCapacityMetric,
    authorizeActor: async (actorId) => Boolean(await actorForTool(actorId, "people", "view")),
    read: async ({ actorId, query, compare }) => {
      const aggregation = { id: "metric", kind: "sum", fieldId: "capacityHours", label: "Total capacity" } as const;
      const current = await peopleMetricValue(actorId, query, aggregation);
      const previous = compare ? await peopleMetricValue(actorId, { ...query, timeRange: { fieldId: "updatedAt", from: compare.from, to: compare.to } }, aggregation) : null;
      return metricReadModel(peopleCapacityMetric, current.value, current.count, current.query, previous?.value);
    },
  });
  metrics.register({
    definition: ticketCountMetric,
    authorizeActor: async (actorId) => Boolean(await actorForTool(actorId, "tickets", "view")),
    read: async ({ actorId, query, compare }) => {
      const current = await ticketMetricValue(actorId, query, { id: "metric", kind: "count", label: "Tickets" });
      const previous = compare ? await ticketMetricValue(actorId, { ...query, timeRange: { fieldId: "updatedAt", from: compare.from, to: compare.to } }, { id: "metric", kind: "count", label: "Tickets" }) : null;
      return metricReadModel(ticketCountMetric, current.value, current.count, current.query, previous?.value);
    },
  });
  metrics.register({
    definition: urgentTicketMetric,
    authorizeActor: async (actorId) => Boolean(await actorForTool(actorId, "tickets", "view")),
    read: async ({ actorId, query, compare }) => {
      const currentQuery = urgentTicketQuery(query);
      const current = await ticketMetricValue(actorId, currentQuery, { id: "metric", kind: "count", label: "Urgent tickets" });
      const previous = compare ? await ticketMetricValue(actorId, { ...currentQuery, timeRange: { fieldId: "updatedAt", from: compare.from, to: compare.to } }, { id: "metric", kind: "count", label: "Urgent tickets" }) : null;
      return metricReadModel(urgentTicketMetric, current.value, current.count, current.query, previous?.value);
    },
  });
  registerDataMetricRoutes({ app: input.app, metrics, getCurrentUser: input.getCurrentUser });

  const exports = new ClusterDataExportRegistry();
  exports.register({
    resourceKind: "background_job",
    label: "Background jobs",
    fields: BACKGROUND_JOB_DATA_FIELDS,
    authorize: ({ request, reply }) => input.requireAdminUserForRequest(request, reply),
    authorizeActor: async (actorId) => {
      const user = await input.prisma.user.findUnique({ where: { id: actorId } });
      if (!user || user.archived) return null;
      const decorated = await input.decorateUserForClient(user);
      return decorated?.isAdmin ? { id: user.id } : null;
    },
    loadRows: async ({ query, selectedIds, limit }) => {
      if (selectedIds.length) {
        const jobs = await input.jobQueue.listByIds(selectedIds);
        return { rows: jobs.map((job) => serializeBackgroundJob(job)), truncated: jobs.length < selectedIds.length };
      }
      const filters = simpleBackgroundJobFilters(query);
      const result = await input.jobQueue.listForExport({ ...filters, search: query.search, sorts: query.sorts, limit });
      return { rows: result.rows.map((job) => serializeBackgroundJob(job)), truncated: result.truncated };
    },
  });

  exports.register({
    resourceKind: "project",
    label: "Projects",
    fields: PROJECT_DATA_FIELDS,
    authorize: async ({ request, reply }) => authorizeToolRequest(request, reply, "projects"),
    authorizeActor: async (actorId) => (await actorForTool(actorId, "projects")) ? { id: actorId } : null,
    loadRows: async ({ context, query, selectedIds, limit }) => {
      const scope = await authorizedProjectScope(context.actor.id);
      if (!scope) return { rows: [], truncated: false };
      const dataWhere = await buildProjectDataQueryWhere({ prisma: input.prisma, query, authorizedProjectIds: scope.projectIds, includeArchived: Boolean(scope.identity.decorated?.isAdmin) });
      const where = selectedIds.length ? { AND: [dataWhere, { id: { in: [...selectedIds] } }] } : dataWhere;
      const continuation = resolveSemanticCursor(query.sorts, PROJECT_SEMANTIC_CURSOR_FIELDS, { fieldId: "updatedAt", direction: "desc" });
      const projects = await input.prisma.project.findMany({
        where,
        orderBy: semanticCursorOrderBy(continuation.cursor),
        take: limit + 1,
        include: {
          sourceBindings: { where: { archived: false }, select: { archived: true } },
        },
      });
      return {
        rows: projects.slice(0, limit).map((project: any) => ({
          id: project.id, name: project.name, status: project.status, projectType: project.projectType, productionProfile: project.productionProfile, source: projectSourceCategory(project), priority: project.priority, startDate: iso(project.startDate), targetDate: iso(project.targetDate), archived: project.archived, updatedAt: iso(project.updatedAt),
        })),
        truncated: projects.length > limit,
      };
    },
  });

  exports.register({
    resourceKind: "user",
    label: "People",
    fields: PEOPLE_DATA_FIELDS,
    authorize: async ({ request, reply }) => authorizeToolRequest(request, reply, "people"),
    authorizeActor: async (actorId) => (await actorForTool(actorId, "people")) ? { id: actorId } : null,
    loadRows: async ({ query, selectedIds, limit }) => {
      const baseRows = await canonicalPeopleRows(selectedIds.length ? { id: { in: [...selectedIds] } } : {});
      const rows = sortPeopleDataRows(filterPeopleDataRows(baseRows, query), query);
      return { rows: rows.slice(0, limit), truncated: rows.length > limit };
    },
  });

  exports.register({
    resourceKind: "ticket",
    label: "Tickets",
    fields: TICKET_DATA_FIELDS,
    authorize: async ({ request, reply }) => authorizeToolRequest(request, reply, "tickets"),
    authorizeActor: async (actorId) => (await actorForTool(actorId, "tickets")) ? { id: actorId } : null,
    loadRows: async ({ context, query, selectedIds, limit }) => {
      const scope = await authorizedTicketBoardScope(context.actor.id);
      if (!scope) return { rows: [], truncated: false };
      const dataWhere = buildTicketDataQueryWhere({ query, authorizedBoardIds: scope.boardIds });
      const where = selectedIds.length ? { AND: [dataWhere, { id: { in: [...selectedIds] } }] } : dataWhere;
      const continuation = resolveSemanticCursor(query.sorts, TICKET_SEMANTIC_CURSOR_FIELDS, { fieldId: "updatedAt", direction: "desc" });
      const cards = await input.prisma.card.findMany({
        where,
        include: { assignee: { select: { id: true, username: true, displayName: true, preferredName: true } }, list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } },
        orderBy: semanticCursorOrderBy(continuation.cursor),
        take: limit + 1,
      });
      return {
        rows: cards.slice(0, limit).map((card: any) => ({
          id: card.id,
          title: card.title,
          projectName: card.list.board.project.name,
          boardName: card.list.board.name,
          listTitle: card.list.title,
          priority: card.priority,
          assignee: card.assignee ? (card.assignee.preferredName || card.assignee.displayName || card.assignee.username) : null,
          dueDate: iso(card.dueDate),
          labels: (() => { try { const parsed = JSON.parse(card.labels || "[]"); return Array.isArray(parsed) ? parsed.join(", ") : ""; } catch { return ""; } })(),
          createdAt: iso(card.createdAt),
          updatedAt: iso(card.updatedAt),
        })),
        truncated: cards.length > limit,
      };
    },
  });

  function adminExportActor(actorId: string) {
    return input.prisma.user.findUnique({ where: { id: actorId } }).then(async (user: any) => {
      if (!user || user.archived) return null;
      const decorated = await input.decorateUserForClient(user);
      return decorated?.isAdmin ? { id: actorId } : null;
    });
  }

  exports.register({
    resourceKind: "packet",
    label: "Packet compliance",
    fields: PACKET_COMPLIANCE_DATA_FIELDS,
    authorize: ({ request, reply }) => input.requireAdminUserForRequest(request, reply),
    authorizeActor: adminExportActor,
    loadRows: async ({ query, selectedIds, limit }) => {
      let rows = await studioKnowledgeComplianceRows(input.prisma, "packet");
      if (selectedIds.length) { const selected = new Set(selectedIds); rows = rows.filter((row: any) => selected.has(row.id) || selected.has(row.resourceId)); }
      return applyStudioKnowledgeComplianceQuery(rows, query, limit);
    },
  });

  exports.register({
    resourceKind: "policy",
    label: "Policy compliance",
    fields: POLICY_COMPLIANCE_DATA_FIELDS,
    authorize: ({ request, reply }) => input.requireAdminUserForRequest(request, reply),
    authorizeActor: adminExportActor,
    loadRows: async ({ query, selectedIds, limit }) => {
      let rows = await studioKnowledgeComplianceRows(input.prisma, "policy");
      if (selectedIds.length) { const selected = new Set(selectedIds); rows = rows.filter((row: any) => selected.has(row.id) || selected.has(row.resourceId)); }
      return applyStudioKnowledgeComplianceQuery(rows, query, limit);
    },
  });

  function importString(value: unknown) {
    return value == null ? "" : String(value).trim();
  }

  function importDate(value: unknown) {
    if (value == null || value === "") return null;
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw Object.assign(new Error("Import date is invalid."), { code: "DATA_IMPORT_DATE_INVALID" });
    return date;
  }

  function importLabels(value: unknown) {
    if (value == null || value === "") return [] as string[];
    if (Array.isArray(value)) return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 80);
    const text = String(value).trim();
    if (!text) return [] as string[];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))].slice(0, 80);
    } catch {}
    return [...new Set(text.split(/[;,]/g).map((item) => item.trim()).filter(Boolean))].slice(0, 80);
  }

  async function actorWorkspaceId(actorId: string) {
    const membership = await input.prisma.workspaceMember.findFirst({
      where: { userId: actorId },
      orderBy: [{ role: "asc" }, { workspaceId: "asc" }],
      select: { workspaceId: true },
    });
    if (!membership?.workspaceId) throw Object.assign(new Error("The importing user is not an active workspace member."), { code: "DATA_IMPORT_WORKSPACE_REQUIRED" });
    return membership.workspaceId as string;
  }

  const imports = new ClusterDataImportRegistry();
  imports.register({
    resourceKind: "project",
    label: "Projects",
    fields: PROJECT_DATA_FIELDS,
    importableFieldIds: ["id", "name", "externalName", "codename", "status", "projectType", "productionProfile", "priority", "startDate", "targetDate"],
    requiredFieldIds: ["name"],
    aliases: { name: ["project", "project name", "internal name"], externalName: ["external name", "public name", "partner name"], codename: ["codename", "code name"], projectType: ["type", "project type"], productionProfile: ["production profile", "production stack", "technology"], startDate: ["start", "start date"], targetDate: ["target", "target date", "due date"] },
    conflictPolicies: ["reject", "skip", "update"],
    identity: { fieldIds: ["id", "name"], description: "Match explicit Project ID first, then case-insensitive Project name within the importing user’s workspace.", deterministicFallback: true },
    authorize: async ({ request, reply }) => authorizeToolRequest(request, reply, "projects", "edit"),
    authorizeActor: async (actorId) => (await actorForTool(actorId, "projects", "edit")) ? { id: actorId } : null,
    applyRow: async ({ actor, values, conflictPolicy, deterministicId }) => {
      const identity = await actorForTool(actor.id, "projects", "edit");
      if (!identity) throw Object.assign(new Error("Project edit authorization is no longer valid."), { code: "DATA_IMPORT_ACCESS_REVOKED" });
      const workspaceId = await actorWorkspaceId(actor.id);
      const explicitId = importString(values.id) || null;
      const name = importString(values.name);
      if (!name) throw Object.assign(new Error("Project name is required."), { code: "DATA_IMPORT_PROJECT_NAME_REQUIRED" });
      const externalName = importString(values.externalName) || null;
      const codename = importString(values.codename) || null;
      const status = importString(values.status) || "active";
      if (!(CLUSTER_PROJECT_STATUSES as readonly string[]).includes(status)) throw Object.assign(new Error(`Unsupported project status: ${status}.`), { code: "DATA_IMPORT_PROJECT_STATUS" });
      const priority = importString(values.priority) || "medium";
      if (!["low", "medium", "high", "urgent"].includes(priority)) throw Object.assign(new Error(`Unsupported project priority: ${priority}.`), { code: "DATA_IMPORT_PROJECT_PRIORITY" });
      const requestedProjectType = importString(values.projectType) || "general";
      const projectType = normalizeClusterProjectTypeId(requestedProjectType);
      const productionProfile = resolveClusterProductionProfile(importString(values.productionProfile) || "generic", projectType).id;
      const startDate = importDate(values.startDate);
      const targetDate = importDate(values.targetDate);
      if (startDate && targetDate && targetDate.getTime() < startDate.getTime()) throw Object.assign(new Error("Project target date must be on or after the start date."), { code: "DATA_IMPORT_PROJECT_DATES" });

      let existing = explicitId ? await input.prisma.project.findUnique({ where: { id: explicitId } }) : null;
      if (!existing) existing = await input.prisma.project.findFirst({ where: { workspaceId, archived: false, name: { equals: name, mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
      if (existing) {
        if (existing.workspaceId !== workspaceId) throw Object.assign(new Error("The matching Project belongs to another workspace."), { code: "DATA_IMPORT_TARGET_ACCESS" });
        if (!identity.decorated?.isAdmin) {
          const rules = await input.prisma.accessRule.findMany({ where: { status: "active", targetKind: "project", targetId: existing.id }, select: AUTHORIZATION_RULE_SELECT });
          if (!input.authorization.hasTargetAccess(identity.user, identity.role, "project", existing.id, existing, rules, "edit")) throw Object.assign(new Error("You no longer have edit access to the matching Project."), { code: "DATA_IMPORT_TARGET_ACCESS" });
        }
        const same = existing.name === name
          && (existing.externalName || null) === externalName
          && (existing.codename || null) === codename
          && existing.status === status
          && existing.projectType === projectType
          && existing.productionProfile === productionProfile
          && existing.priority === priority
          && iso(existing.startDate)?.slice(0, 10) === iso(startDate)?.slice(0, 10)
          && iso(existing.targetDate)?.slice(0, 10) === iso(targetDate)?.slice(0, 10);
        if (same) return { action: "already_applied" as const, resourceId: existing.id, identity: explicitId ? `id:${existing.id}` : `name:${name}`, message: "Project already matches the imported row." };
        if (conflictPolicy === "reject") throw Object.assign(new Error(`Project conflict for ${explicitId || name}.`), { code: "DATA_IMPORT_CONFLICT" });
        if (conflictPolicy === "skip") return { action: "skipped" as const, resourceId: existing.id, identity: explicitId ? `id:${existing.id}` : `name:${name}`, message: "Existing Project left unchanged by skip policy." };
        const updated = await input.prisma.project.update({
          where: { id: existing.id },
          data: { name, externalName, codename, status, projectType, productionProfile, priority, startDate, targetDate, revision: { increment: 1 } },
        });
        await input.logActivity?.({ userId: actor.id, projectId: updated.id, type: "updated", entityType: "project", entityId: updated.id, title: "Project updated by data import", message: updated.name, metadata: { source: "data-import" } });
        return { action: "updated" as const, resourceId: updated.id, identity: explicitId ? `id:${updated.id}` : `name:${name}` };
      }

      const projectId = explicitId || deterministicId;
      const created = await input.prisma.project.create({
        data: {
          id: projectId,
          workspaceId,
          name,
          externalName,
          codename,
          status,
          projectType,
          productionProfile,
          priority,
          startDate,
          targetDate,
          source: "manual",
          tags: "[]",
          productionTracks: JSON.stringify(["studio"]),
          memberships: { create: { userId: actor.id, roleKey: "lead", roleLabel: "Project Lead", isLead: true, accessLevel: "manage", allocationPercent: 100, status: "active" } },
        },
      });
      await input.logActivity?.({ userId: actor.id, projectId: created.id, type: "created", entityType: "project", entityId: created.id, title: "Project created by data import", message: created.name, metadata: { source: "data-import" } });
      return { action: "created" as const, resourceId: created.id, identity: explicitId ? `id:${created.id}` : `import:${created.id}` };
    },
  });
  imports.register({
    resourceKind: "ticket",
    label: "Tickets",
    fields: TICKET_DATA_FIELDS,
    importableFieldIds: ["id", "title", "projectId", "priority", "dueDate", "labels"],
    requiredFieldIds: ["title"],
    aliases: { title: ["ticket", "ticket title", "summary"], projectId: ["project id", "project"], dueDate: ["due", "due date"], labels: ["label", "tags"] },
    conflictPolicies: ["reject", "skip", "update"],
    identity: { fieldIds: ["id"], description: "Match an explicit Ticket ID when present; otherwise use the immutable source fingerprint and row number as the rerun-safe import identity.", deterministicFallback: true },
    authorize: async ({ request, reply }) => authorizeToolRequest(request, reply, "tickets", "edit"),
    authorizeActor: async (actorId) => (await actorForTool(actorId, "tickets", "edit")) ? { id: actorId } : null,
    applyRow: async ({ actor, values, conflictPolicy, deterministicId }) => {
      const scope = await authorizedTicketBoardScope(actor.id, "edit");
      if (!scope) throw Object.assign(new Error("Ticket edit authorization is no longer valid."), { code: "DATA_IMPORT_ACCESS_REVOKED" });
      const explicitId = importString(values.id) || null;
      const title = importString(values.title);
      if (!title) throw Object.assign(new Error("Ticket title is required."), { code: "DATA_IMPORT_TICKET_TITLE_REQUIRED" });
      const priority = importString(values.priority) || "medium";
      if (!["low", "medium", "high", "urgent"].includes(priority)) throw Object.assign(new Error(`Unsupported ticket priority: ${priority}.`), { code: "DATA_IMPORT_TICKET_PRIORITY" });
      const dueDate = importDate(values.dueDate);
      const labels = [...new Set(["ticket", ...importLabels(values.labels)])];
      const projectId = importString(values.projectId) || null;

      let existing = explicitId ? await input.prisma.card.findUnique({ where: { id: explicitId }, include: { list: { include: { board: true } } } }) : null;
      if (!existing) existing = await input.prisma.card.findUnique({ where: { id: deterministicId }, include: { list: { include: { board: true } } } });
      if (existing && !scope.boardIds.includes(existing.list.boardId)) throw Object.assign(new Error("You no longer have edit access to the matching Ticket."), { code: "DATA_IMPORT_TARGET_ACCESS" });

      const resolveDestination = async () => {
        if (projectId) {
          const board = await input.prisma.board.findFirst({ where: { projectId, archived: false, id: { in: scope.boardIds } }, orderBy: { createdAt: "asc" }, include: { lists: { orderBy: { position: "asc" }, take: 1 } } });
          if (!board?.lists?.[0]) throw Object.assign(new Error(`No editable Ticket destination exists for Project ${projectId}.`), { code: "DATA_IMPORT_TICKET_DESTINATION" });
          return { projectId, boardId: board.id, listId: board.lists[0].id };
        }
        const board = await input.prisma.board.findFirst({ where: { archived: false, id: { in: scope.boardIds }, project: { source: "system-tickets", archived: false } }, orderBy: { createdAt: "asc" }, include: { lists: { orderBy: { position: "asc" }, take: 1 }, project: { select: { id: true } } } });
        if (!board?.lists?.[0]) throw Object.assign(new Error("A Project ID is required because no editable studio Ticket queue is available."), { code: "DATA_IMPORT_TICKET_DESTINATION" });
        return { projectId: board.project.id, boardId: board.id, listId: board.lists[0].id };
      };

      if (existing) {
        const destination = projectId ? await resolveDestination() : { projectId: null, boardId: existing.list.boardId, listId: existing.listId };
        const existingLabels = importLabels(existing.labels);
        const same = existing.title === title
          && existing.priority === priority
          && iso(existing.dueDate) === iso(dueDate)
          && JSON.stringify([...existingLabels].sort()) === JSON.stringify([...labels].sort())
          && (!projectId || existing.list.board.projectId === projectId);
        if (same) return { action: "already_applied" as const, resourceId: existing.id, identity: explicitId ? `id:${existing.id}` : `import:${existing.id}`, message: "Ticket already matches the imported row." };
        if (conflictPolicy === "reject") throw Object.assign(new Error(`Ticket conflict for ${explicitId || title}.`), { code: "DATA_IMPORT_CONFLICT" });
        if (conflictPolicy === "skip") return { action: "skipped" as const, resourceId: existing.id, identity: explicitId ? `id:${existing.id}` : `import:${existing.id}`, message: "Existing Ticket left unchanged by skip policy." };
        const updated = await input.prisma.card.update({
          where: { id: existing.id },
          data: { title, priority, dueDate, labels: JSON.stringify(labels), workItemKind: "ticket", ...(projectId ? { listId: destination.listId } : {}), revision: { increment: 1 } },
          include: { list: { include: { board: true } } },
        });
        await input.logActivity?.({ userId: actor.id, projectId: updated.list.board.projectId, boardId: updated.list.boardId, cardId: updated.id, type: "updated", entityType: "ticket", entityId: updated.id, title: "Ticket updated by data import", message: updated.title, metadata: { source: "data-import" } });
        return { action: "updated" as const, resourceId: updated.id, identity: explicitId ? `id:${updated.id}` : `import:${updated.id}` };
      }

      const destination = await resolveDestination();
      const last = await input.prisma.card.findFirst({ where: { listId: destination.listId, archived: false }, orderBy: { position: "desc" }, select: { position: true } });
      const created = await input.prisma.card.create({
        data: {
          id: explicitId || deterministicId,
          listId: destination.listId,
          title,
          workItemKind: "ticket",
          priority,
          dueDate,
          labels: JSON.stringify(labels),
          position: last ? last.position + 1 : 0,
          activity: { create: { type: "created", message: "Ticket created by data import" } },
        },
        include: { list: { include: { board: true } } },
      });
      await input.logActivity?.({ userId: actor.id, projectId: destination.projectId, boardId: destination.boardId, cardId: created.id, type: "created", entityType: "ticket", entityId: created.id, title: "Ticket created by data import", message: created.title, metadata: { source: "data-import" } });
      return { action: "created" as const, resourceId: created.id, identity: explicitId ? `id:${created.id}` : `import:${created.id}` };
    },
  });

  registerDataExportJobHandler({ worker: input.jobWorker, registry: exports, prisma: input.prisma, dataLayout: input.dataLayout, logSecurityEvent: input.logSecurityEvent, logActivity: input.logActivity });
  registerDataExportRoutes({ app: input.app, registry: exports, queue: input.jobQueue, getCurrentUser: input.getCurrentUser, decorateUserForClient: input.decorateUserForClient, logSecurityEvent: input.logSecurityEvent });
  registerDataImportJobHandler({ worker: input.jobWorker, registry: imports, prisma: input.prisma, dataLayout: input.dataLayout, logSecurityEvent: input.logSecurityEvent, logActivity: input.logActivity });
  registerDataImportRoutes({ app: input.app, registry: imports, queue: input.jobQueue, prisma: input.prisma, dataLayout: input.dataLayout, getCurrentUser: input.getCurrentUser, decorateUserForClient: input.decorateUserForClient, logSecurityEvent: input.logSecurityEvent });
}
