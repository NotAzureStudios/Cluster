import { TICKET_DATA_FIELDS, type ClusterDataAggregation, type ClusterDataAnalyticsEvidence, type ClusterDataFilterCondition, type ClusterDataFilterGroup, type ClusterDataProjection, type ClusterDataProjectionResult, type ClusterDataQuery, type ClusterDataScalar } from "@cluster/shared";
import type { SemanticCursorField } from "../../core/semantic-cursor-pagination.js";
import { clusterDataCountProjectionRollups, clusterDataGroupSummaryProjections, clusterDataProjectionGroupSummaries, runPrismaGroupedProjections, runPrismaScalarAnalytics } from "../../core/data-query-analytics.js";
import { compilePrismaDataFilterGroup, createPrismaSemanticAdapters } from "../../core/prisma-semantic-query.js";


export const TICKET_SEMANTIC_CURSOR_FIELDS: readonly SemanticCursorField[] = [
  { fieldId: "title", prismaField: "title", valueType: "string" },
  { fieldId: "priority", prismaField: "priority", valueType: "string" },
  { fieldId: "dueDate", prismaField: "dueDate", valueType: "datetime", nullable: true },
  { fieldId: "createdAt", prismaField: "createdAt", valueType: "datetime" },
  { fieldId: "updatedAt", prismaField: "updatedAt", valueType: "datetime" },
];

// Ticket stage is authoritative. Lists stay user-defined and must not
// accidentally resolve a Ticket merely because a List was named "Done".
export function ticketLikeWhere(): Record<string, unknown> {
  return { workItemKind: "ticket" };
}

export function ticketQueueLaneWhere(lane: string): Record<string, unknown> {
  const closed = { ticketStage: { in: ["resolved", "rejected"] } };
  const open = { OR: [{ ticketStage: null }, { ticketStage: { in: ["new", "accepted", "working", "waiting", "review"] } }] };
  const value = String(lane || "").toLowerCase();
  if (value === "resolved") return { ticketStage: "resolved" };
  if (value === "rejected") return { ticketStage: "rejected" };
  if (value === "closed") return closed;
  if (value === "open") return open;
  if (value === "urgent") return { AND: [open, { priority: { in: ["urgent", "high"] } }] };
  if (value === "waiting") return { ticketStage: "waiting" };
  if (value === "review") return { ticketStage: "review" };
  if (value === "triage") return { OR: [{ ticketStage: "new" }, { ticketStage: null }] };
  return { id: { in: [] } };
}

function queueCondition(condition: ClusterDataFilterCondition) {
  const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).filter((value): value is string => typeof value === "string");
  const clauses = values.map(ticketQueueLaneWhere);
  if (!clauses.length) return { id: { in: [] } };
  if (condition.operator === "equals" || condition.operator === "in") return clauses.length === 1 ? clauses[0] : { OR: clauses };
  if (condition.operator === "not_equals" || condition.operator === "not_in") return { NOT: clauses.length === 1 ? clauses[0] : { OR: clauses } };
  return null;
}

function relationWrap(path: "project" | "board" | "list") {
  return (scalarWhere: Record<string, unknown>) => {
    if (path === "list") return { list: scalarWhere };
    if (path === "board") return { list: { board: scalarWhere } };
    return { list: { board: { project: scalarWhere } } };
  };
}

const adapters = createPrismaSemanticAdapters(TICKET_DATA_FIELDS, {
  projectName: { prismaField: "name", wrapWhere: relationWrap("project") },
  projectId: { prismaField: "id", wrapWhere: relationWrap("project") },
  boardName: { prismaField: "name", wrapWhere: relationWrap("board") },
  listTitle: { prismaField: "title", wrapWhere: relationWrap("list") },
  assignee: { prismaField: "displayName", wrapWhere: (scalarWhere) => ({ assignee: scalarWhere }) },
  assigneeId: { prismaField: "assigneeId" },
  queueLane: { prismaField: undefined, condition: queueCondition },
});

export function buildTicketDataQueryWhere(input: {
  query: ClusterDataQuery;
  authorizedBoardIds: readonly string[];
}) {
  const terms: Record<string, unknown>[] = [
    { archived: false },
    ticketLikeWhere(),
    { list: { boardId: { in: [...input.authorizedBoardIds] } } },
  ];
  const filters = compilePrismaDataFilterGroup(input.query.filters, adapters);
  if (filters) terms.push(filters);
  const search = input.query.search?.trim();
  if (search) terms.push({ OR: [
    { title: { contains: search, mode: "insensitive" } },
    { description: { contains: search, mode: "insensitive" } },
    { labels: { contains: search, mode: "insensitive" } },
    { priority: { contains: search, mode: "insensitive" } },
    { assignee: { OR: [
      { username: { contains: search, mode: "insensitive" } },
      { displayName: { contains: search, mode: "insensitive" } },
      { preferredName: { contains: search, mode: "insensitive" } },
    ] } },
    { list: { title: { contains: search, mode: "insensitive" } } },
    { list: { board: { name: { contains: search, mode: "insensitive" } } } },
    { list: { board: { project: { name: { contains: search, mode: "insensitive" } } } } },
  ] });
  return { AND: terms };
}

async function relationFacet(prisma: any, where: Record<string, unknown>, fieldId: "projectName" | "listTitle") {
  const grouped = await prisma.card.groupBy({ by: ["listId"], where, _count: { _all: true } });
  const listIds = grouped.map((row: any) => row.listId).filter(Boolean);
  if (!listIds.length) return { fieldId, buckets: [] };
  const lists = await prisma.boardList.findMany({ where: { id: { in: listIds } }, select: { id: true, title: true, board: { select: { project: { select: { name: true } } } } } });
  const byList = new Map(lists.map((list: any) => [list.id, list]));
  const counts = new Map<string, number>();
  for (const row of grouped) {
    const list = byList.get(row.listId) as any;
    const value = fieldId === "listTitle" ? list?.title : list?.board?.project?.name;
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + Number(row?._count?._all || 0));
  }
  return { fieldId, buckets: [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 50) };
}

function withoutFilterField(group: ClusterDataFilterGroup | null | undefined, fieldId: string): ClusterDataFilterGroup | null {
  if (!group) return null;
  const conditions = (group.conditions || []).filter((condition) => condition.fieldId !== fieldId);
  const groups = (group.groups || []).map((child) => withoutFilterField(child, fieldId)).filter((child): child is ClusterDataFilterGroup => Boolean(child));
  if (!conditions.length && !groups.length) return null;
  return { ...group, conditions, ...(groups.length ? { groups } : { groups: undefined }) };
}


function ticketProjectionMeasureValues(projection: ClusterDataProjection, count: number) {
  return Object.fromEntries(projection.measures.map((measure) => [measure.id, measure.kind === "count" && !measure.fieldId ? count : null]));
}

async function ticketListMetadata(prisma: any, listIds: readonly string[]) {
  const rows = listIds.length ? await prisma.boardList.findMany({ where: { id: { in: [...listIds] } }, select: { id: true, title: true, board: { select: { name: true, project: { select: { name: true } } } } } }) : [];
  return new Map(rows.map((row: any) => [String(row.id), row] as const));
}

function ticketRelationKey(fieldId: string, list: any, groupedRow: any): ClusterDataScalar {
  if (fieldId === "projectName") return list?.board?.project?.name ?? null;
  if (fieldId === "boardName") return list?.board?.name ?? null;
  if (fieldId === "listTitle") return list?.title ?? null;
  if (fieldId === "priority") return groupedRow?.priority ?? null;
  return null;
}

async function ticketRelationProjectionRows(prisma: any, where: Record<string, unknown>, projection: ClusterDataProjection, lane?: string) {
  const dimensions = projection.dimensions;
  const needsPriority = dimensions.includes("priority");
  const scopedWhere = lane ? { AND: [where, ticketQueueLaneWhere(lane)] } : where;
  const grouped = await prisma.card.groupBy({ by: needsPriority ? ["listId", "priority"] : ["listId"], where: scopedWhere, _count: { _all: true } });
  const listIds = [...new Set<string>(grouped.map((row: any) => String(row.listId || "")).filter((value: string) => Boolean(value)))];
  const metadata = await ticketListMetadata(prisma, listIds);
  const buckets = new Map<string, { keys: ClusterDataScalar[]; count: number }>();
  for (const row of grouped) {
    const list = metadata.get(String(row.listId));
    const keys = dimensions.map((fieldId) => fieldId === "queueLane" ? lane ?? null : ticketRelationKey(fieldId, list, row));
    if (keys.some((value) => value == null)) continue;
    const key = JSON.stringify(keys);
    const existing = buckets.get(key);
    const count = Number(row?._count?._all || 0);
    if (existing) existing.count += count;
    else buckets.set(key, { keys, count });
  }
  return [...buckets.values()];
}

async function runTicketRelationProjections(prisma: any, where: Record<string, unknown>, projections: readonly ClusterDataProjection[]): Promise<ClusterDataProjectionResult[]> {
  const results: ClusterDataProjectionResult[] = [];
  const laneValues = ["open", "triage", "urgent", "waiting", "review", "resolved", "rejected"];
  for (const projection of projections) {
    const usesQueueLane = projection.dimensions.includes("queueLane");
    const rawRows = usesQueueLane
      ? (await Promise.all(laneValues.map((lane) => ticketRelationProjectionRows(prisma, where, projection, lane)))).flat()
      : await ticketRelationProjectionRows(prisma, where, projection);
    const buckets = new Map<string, { keys: ClusterDataScalar[]; count: number }>();
    for (const row of rawRows) {
      const key = JSON.stringify(row.keys);
      const existing = buckets.get(key);
      if (existing) existing.count += row.count;
      else buckets.set(key, { ...row });
    }
    const rows = [...buckets.values()].map((row) => ({ ...row, values: ticketProjectionMeasureValues(projection, row.count) })).sort((a, b) => b.count - a.count || JSON.stringify(a.keys).localeCompare(JSON.stringify(b.keys)));
    const limit = Math.max(1, Math.min(200, Math.round(Number(projection.limit) || 50)));
    results.push({ id: projection.id, kind: projection.kind, dimensions: projection.dimensions, measures: projection.measures, ...(projection.drilldown ? { drilldown: projection.drilldown } : {}), rows: rows.slice(0, limit), ...clusterDataCountProjectionRollups(projection, rows), scope: "authorized_query", complete: true, truncated: rows.length > limit });
  }
  return results;
}

async function runTicketProjections(prisma: any, where: Record<string, unknown>, requestedProjections: readonly ClusterDataProjection[]) {
  const relationFields = new Set(["projectName", "boardName", "listTitle", "queueLane"]);
  const relationIds = new Set(requestedProjections.filter((projection) => projection.dimensions.some((fieldId) => relationFields.has(fieldId))).map((projection) => projection.id));
  const ordinaryProjections = await runPrismaGroupedProjections({
    model: prisma.card,
    where,
    projections: requestedProjections.filter((projection) => !relationIds.has(projection.id)),
    dimensionFields: new Map([["priority", "priority"]]),
  });
  const relationProjections = await runTicketRelationProjections(prisma, where, requestedProjections.filter((projection) => relationIds.has(projection.id)));
  const byId = new Map([...ordinaryProjections, ...relationProjections].map((projection) => [projection.id, projection] as const));
  return requestedProjections.flatMap((projection) => byId.has(projection.id) ? [byId.get(projection.id)!] : []);
}

export async function ticketDataQueryAnalytics(prisma: any, where: Record<string, unknown>, query: ClusterDataQuery, authorizedBoardIds: readonly string[]): Promise<ClusterDataAnalyticsEvidence> {
  const ordinary = (query.facets || []).filter((fieldId) => fieldId === "priority");
  const base = await runPrismaScalarAnalytics({
    model: prisma.card,
    where,
    facets: ordinary,
    aggregations: query.aggregations || [],
    facetFields: new Map([["priority", "priority"]]),
  });
  const facets = [...base.facets];
  for (const fieldId of query.facets || []) {
    if (fieldId === "projectName" || fieldId === "listTitle") facets.push(await relationFacet(prisma, where, fieldId));
    if (fieldId === "queueLane") {
      const queueScopeQuery = { ...query, filters: withoutFilterField(query.filters, "queueLane") };
      const queueScopeWhere = buildTicketDataQueryWhere({ query: queueScopeQuery, authorizedBoardIds });
      const buckets = await Promise.all(["open", "triage", "urgent", "waiting", "review", "resolved", "rejected"].map(async (value) => ({ value, count: await prisma.card.count({ where: { AND: [queueScopeWhere, ticketQueueLaneWhere(value)] } }) })));
      facets.push({ fieldId, buckets: buckets.filter((bucket) => bucket.count > 0) });
      base.aggregations.queue_scope_count = await prisma.card.count({ where: queueScopeWhere });
    }
  }
  const order = new Map<string, number>((query.facets || []).map((id, index) => [id, index] as const));
  facets.sort((a, b) => (order.get(a.fieldId) ?? 999) - (order.get(b.fieldId) ?? 999));
  const requestedProjections = query.projections || [];
  const projections = await runTicketProjections(prisma, where, requestedProjections);
  const supportedGroupIds = new Set(["priority", "projectName", "boardName", "listTitle", "queueLane"]);
  const groups = (query.groups || []).slice(0, 2);
  const groupProjections = groups.length && groups.every((group) => supportedGroupIds.has(group.fieldId))
    ? clusterDataGroupSummaryProjections(groups, query.aggregations || [], 2, 100)
    : [];
  const groupedSummaries = groupProjections.length ? clusterDataProjectionGroupSummaries(await runTicketProjections(prisma, where, groupProjections), { count: base.total, values: base.aggregations }) : [];
  return { ...base, facets, projections, groupedSummaries };
}

export const TICKET_DATA_VIEW_AGGREGATIONS: readonly ClusterDataAggregation[] = [
  { id: "count", kind: "count", label: "Tickets" },
];
