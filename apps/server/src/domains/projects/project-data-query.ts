import { PROJECT_DATA_FIELDS, type ClusterDataAggregation, type ClusterDataAnalyticsEvidence, type ClusterDataFilterCondition, type ClusterDataProjection, type ClusterDataProjectionResult, type ClusterDataQuery, type ClusterDataScalar } from "@cluster/shared";
import type { SemanticCursorField } from "../../core/semantic-cursor-pagination.js";
import { clusterDataCountProjectionRollups, clusterDataGroupSummaryProjections, clusterDataProjectionGroupSummaries, runPrismaGroupedProjections, runPrismaScalarAnalytics } from "../../core/data-query-analytics.js";
import { compilePrismaDataFilterGroup, createPrismaSemanticAdapters } from "../../core/prisma-semantic-query.js";

export const PROJECT_SEMANTIC_CURSOR_FIELDS: readonly SemanticCursorField[] = [
  { fieldId: "name", prismaField: "name", valueType: "string" },
  { fieldId: "status", prismaField: "status", valueType: "string" },
  { fieldId: "projectType", prismaField: "projectType", valueType: "string" },
  { fieldId: "productionProfile", prismaField: "productionProfile", valueType: "string" },
  { fieldId: "priority", prismaField: "priority", valueType: "string" },
  { fieldId: "startDate", prismaField: "startDate", valueType: "datetime", nullable: true },
  { fieldId: "targetDate", prismaField: "targetDate", valueType: "datetime", nullable: true },
  { fieldId: "archived", prismaField: "archived", valueType: "boolean" },
  { fieldId: "updatedAt", prismaField: "updatedAt", valueType: "datetime" },
];

function stringValues(condition: ClusterDataFilterCondition) {
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  return values.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function projectSourceWhere(category: string): Record<string, unknown> {
  const value = String(category || "").toLowerCase();
  if (value === "external") return { source: { equals: "external", mode: "insensitive" } };
  if (value === "git") return {
    AND: [
      { NOT: { source: { equals: "external", mode: "insensitive" } } },
      { sourceBindings: { some: { archived: false } } },
    ],
  };
  if (value === "manual") return {
    AND: [
      { NOT: { source: { equals: "external", mode: "insensitive" } } },
      { sourceBindings: { none: { archived: false } } },
    ],
  };
  return { id: { in: [] } };
}

export function projectSourceCategory(project: { source?: unknown; sourceBindings?: Array<{ archived?: boolean | null }> }) {
  if (String(project.source || "").toLowerCase() === "external") return "external";
  if ((project.sourceBindings || []).some((binding) => !binding.archived)) return "git";
  return "manual";
}

export function projectScheduleWhere(state: string, now = new Date()): Record<string, unknown> {
  const value = String(state || "").toLowerCase();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (value === "unscheduled") return { targetDate: null };
  if (value === "overdue") return { targetDate: { lt: now }, status: { notIn: ["completed", "cancelled"] } };
  if (value === "due_soon") return {
    AND: [
      { targetDate: { not: null, lte: soon } },
      { OR: [{ targetDate: { gte: now } }, { status: { in: ["completed", "cancelled"] } }] },
    ],
  };
  if (value === "scheduled") return { targetDate: { gt: soon } };
  return { id: { in: [] } };
}

function computedCondition(condition: ClusterDataFilterCondition, kind: "source" | "schedule") {
  const values = stringValues(condition);
  if (["is_empty", "is_not_empty"].includes(condition.operator)) return null;
  const clauses = values.map((value) => kind === "source" ? projectSourceWhere(value) : projectScheduleWhere(value));
  if (!clauses.length) return { id: { in: [] } };
  if (condition.operator === "equals" || condition.operator === "in") return clauses.length === 1 ? clauses[0] : { OR: clauses };
  if (condition.operator === "not_equals" || condition.operator === "not_in") return { NOT: clauses.length === 1 ? clauses[0] : { OR: clauses } };
  return null;
}

const adapters = createPrismaSemanticAdapters(PROJECT_DATA_FIELDS, {
  source: { prismaField: undefined, condition: (condition) => computedCondition(condition, "source") },
  schedule: { prismaField: undefined, condition: (condition) => computedCondition(condition, "schedule") },
});

async function projectSearchWhere(prisma: any, search: string): Promise<Record<string, unknown>> {
  const needle = search.trim();
  const matchingUsers = await prisma.user.findMany({
    where: {
      archived: false,
      OR: [
        { username: { contains: needle, mode: "insensitive" } },
        { displayName: { contains: needle, mode: "insensitive" } },
        { preferredName: { contains: needle, mode: "insensitive" } },
        { employment: { is: { jobRole: { is: { name: { contains: needle, mode: "insensitive" } } } } } },
        { employment: { is: { department: { is: { name: { contains: needle, mode: "insensitive" } } } } } },
        { studioTeamMemberships: { some: { archived: false, team: { name: { contains: needle, mode: "insensitive" } } } } },
      ],
    },
    select: { id: true },
    take: 100,
  });
  const memberTerms = matchingUsers.map((user: any) => ({
    memberships: { some: { userId: String(user.id), status: "active" } },
  }));
  return { OR: [
    { name: { contains: needle, mode: "insensitive" } },
    { externalName: { contains: needle, mode: "insensitive" } },
    { codename: { contains: needle, mode: "insensitive" } },
    { aliases: { contains: needle, mode: "insensitive" } },
    { description: { contains: needle, mode: "insensitive" } },
    { objective: { contains: needle, mode: "insensitive" } },
    { clientName: { contains: needle, mode: "insensitive" } },
    { tags: { contains: needle, mode: "insensitive" } },
    { status: { contains: needle, mode: "insensitive" } },
    { projectType: { contains: needle, mode: "insensitive" } },
    { productionProfile: { contains: needle, mode: "insensitive" } },
    { priority: { contains: needle, mode: "insensitive" } },
    { sourceBindings: { some: { archived: false, OR: [
      { defaultBranch: { contains: needle, mode: "insensitive" } },
      { repository: { name: { contains: needle, mode: "insensitive" } } },
      { repository: { remoteUrl: { contains: needle, mode: "insensitive" } } },
      { repository: { defaultBranch: { contains: needle, mode: "insensitive" } } },
    ] } } },
    { integrationBindings: { some: { archived: false, OR: [
      { displayName: { contains: needle, mode: "insensitive" } },
      { externalId: { contains: needle, mode: "insensitive" } },
      { connection: { displayName: { contains: needle, mode: "insensitive" } } },
      { connection: { providerId: { contains: needle, mode: "insensitive" } } },
    ] } } },
    { boards: { some: { archived: false, name: { contains: needle, mode: "insensitive" } } } },
    { whiteboards: { some: { name: { contains: needle, mode: "insensitive" } } } },
    ...memberTerms,
  ] };
}

export async function buildProjectDataQueryWhere(input: {
  prisma: any;
  query: ClusterDataQuery;
  authorizedProjectIds?: readonly string[] | null;
  includeArchived: boolean;
}) {
  const terms: Record<string, unknown>[] = [];
  if (input.authorizedProjectIds) terms.push({ id: { in: [...input.authorizedProjectIds] } });
  if (!input.includeArchived) terms.push({ archived: false });
  const filters = compilePrismaDataFilterGroup(input.query.filters, adapters);
  if (filters) terms.push(filters);
  const search = input.query.search?.trim();
  if (search) terms.push(await projectSearchWhere(input.prisma, search));
  return terms.length ? { AND: terms } : {};
}


function projectionMeasureValues(projection: ClusterDataProjection, count: number) {
  return Object.fromEntries(projection.measures.map((measure) => [measure.id, measure.kind === "count" && !measure.fieldId ? count : null]));
}

async function projectDimensionValues(prisma: any, where: Record<string, unknown>, fieldId: string): Promise<ClusterDataScalar[]> {
  if (fieldId === "source") return ["git", "manual", "external"];
  if (fieldId === "schedule") return ["due_soon", "overdue", "unscheduled", "scheduled"];
  const prismaField = ({ status: "status", projectType: "projectType", productionProfile: "productionProfile", priority: "priority" } as Record<string, string>)[fieldId];
  if (!prismaField) return [];
  const rows = await prisma.project.groupBy({ by: [prismaField], where, _count: { _all: true } });
  return rows.map((row: any) => row[prismaField] ?? null);
}

function projectDimensionWhere(fieldId: string, value: ClusterDataScalar): Record<string, unknown> {
  if (fieldId === "source") return projectSourceWhere(String(value ?? ""));
  if (fieldId === "schedule") return projectScheduleWhere(String(value ?? ""));
  const prismaField = ({ status: "status", projectType: "projectType", productionProfile: "productionProfile", priority: "priority" } as Record<string, string>)[fieldId];
  return prismaField ? { [prismaField]: value } : { id: { in: [] } };
}

async function runProjectComputedProjections(prisma: any, where: Record<string, unknown>, projections: readonly ClusterDataProjection[]): Promise<ClusterDataProjectionResult[]> {
  const results: ClusterDataProjectionResult[] = [];
  for (const projection of projections) {
    const dimensions = projection.dimensions.slice(0, projection.kind === "matrix" ? 2 : 1);
    const valueSets = await Promise.all(dimensions.map((fieldId) => projectDimensionValues(prisma, where, fieldId)));
    const combinations: ClusterDataScalar[][] = dimensions.length === 1
      ? valueSets[0].map((value) => [value])
      : valueSets[0].flatMap((left) => valueSets[1].map((right) => [left, right]));
    const rows = [];
    for (const keys of combinations.slice(0, 240)) {
      const count = await prisma.project.count({ where: { AND: [where, ...keys.map((value, index) => projectDimensionWhere(dimensions[index], value))] } });
      if (!count) continue;
      rows.push({ keys, count, values: projectionMeasureValues(projection, count) });
    }
    rows.sort((a, b) => b.count - a.count || JSON.stringify(a.keys).localeCompare(JSON.stringify(b.keys)));
    const limit = Math.max(1, Math.min(200, Math.round(Number(projection.limit) || 50)));
    results.push({ id: projection.id, kind: projection.kind, dimensions, measures: projection.measures, ...(projection.drilldown ? { drilldown: projection.drilldown } : {}), rows: rows.slice(0, limit), ...clusterDataCountProjectionRollups(projection, rows), scope: "authorized_query", complete: true, truncated: rows.length > limit });
  }
  return results;
}

async function runProjectProjections(prisma: any, where: Record<string, unknown>, requestedProjections: readonly ClusterDataProjection[]) {
  const computedIds = new Set(requestedProjections.filter((projection) => projection.dimensions.some((fieldId) => fieldId === "source" || fieldId === "schedule")).map((projection) => projection.id));
  const ordinaryProjections = await runPrismaGroupedProjections({
    model: prisma.project,
    where,
    projections: requestedProjections.filter((projection) => !computedIds.has(projection.id)),
    dimensionFields: new Map([["status", "status"], ["projectType", "projectType"], ["productionProfile", "productionProfile"], ["priority", "priority"]]),
  });
  const computedProjections = await runProjectComputedProjections(prisma, where, requestedProjections.filter((projection) => computedIds.has(projection.id)));
  const byId = new Map([...ordinaryProjections, ...computedProjections].map((projection) => [projection.id, projection] as const));
  return requestedProjections.flatMap((projection) => byId.has(projection.id) ? [byId.get(projection.id)!] : []);
}

export async function projectDataQueryAnalytics(prisma: any, where: Record<string, unknown>, query: ClusterDataQuery): Promise<ClusterDataAnalyticsEvidence> {
  const ordinaryFacets = (query.facets || []).filter((fieldId) => !["source", "schedule"].includes(fieldId));
  const base = await runPrismaScalarAnalytics({
    model: prisma.project,
    where,
    facets: ordinaryFacets,
    aggregations: query.aggregations || [],
    facetFields: new Map([["status", "status"], ["projectType", "projectType"], ["productionProfile", "productionProfile"], ["priority", "priority"]]),
  });
  const facets = [...base.facets];
  if ((query.facets || []).includes("source")) {
    const entries = await Promise.all(["git", "manual", "external"].map(async (value) => ({ value, count: await prisma.project.count({ where: { AND: [where, projectSourceWhere(value)] } }) })));
    facets.push({ fieldId: "source", buckets: entries.filter((entry) => entry.count > 0) });
  }
  if ((query.facets || []).includes("schedule")) {
    const entries = await Promise.all(["due_soon", "overdue", "unscheduled", "scheduled"].map(async (value) => ({ value, count: await prisma.project.count({ where: { AND: [where, projectScheduleWhere(value)] } }) })));
    facets.push({ fieldId: "schedule", buckets: entries.filter((entry) => entry.count > 0) });
  }
  const order = new Map<string, number>((query.facets || []).map((id, index) => [id, index] as const));
  facets.sort((a, b) => (order.get(a.fieldId) ?? 999) - (order.get(b.fieldId) ?? 999));
  const requestedProjections = query.projections || [];
  const projections = await runProjectProjections(prisma, where, requestedProjections);
  const supportedGroupIds = new Set(["status", "projectType", "productionProfile", "priority", "source", "schedule"]);
  const groups = (query.groups || []).slice(0, 2);
  const groupProjections = groups.length && groups.every((group) => supportedGroupIds.has(group.fieldId))
    ? clusterDataGroupSummaryProjections(groups, query.aggregations || [], 2, 100)
    : [];
  const groupedSummaries = groupProjections.length ? clusterDataProjectionGroupSummaries(await runProjectProjections(prisma, where, groupProjections), { count: base.total, values: base.aggregations }) : [];
  return { ...base, facets, projections, groupedSummaries };
}

export const PROJECT_DATA_VIEW_AGGREGATIONS: readonly ClusterDataAggregation[] = [
  { id: "count", kind: "count", label: "Projects" },
];
