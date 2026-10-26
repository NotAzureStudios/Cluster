import { z } from "zod";
import {
  CLUSTER_DATA_VIEW_DENSITIES,
  CLUSTER_DATA_VIEW_PRESENTATIONS,
  CLUSTER_RESOURCE_KINDS,
  normalizeClusterDataSorts,
  type ClusterDataViewLayout,
  type ClusterDataViewVisibility,
  type ClusterResourceKind,
  type ClusterSavedDataView,
} from "@cluster/shared";
import { apiError } from "../../core/api-response.js";

const scopeSchema = z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/i);
const visibilitySchema = z.enum(["personal", "studio", "project"]);
const presentationSchema = z.enum(CLUSTER_DATA_VIEW_PRESENTATIONS);
const densitySchema = z.enum(CLUSTER_DATA_VIEW_DENSITIES);
const resourceKindSchema = z.string().trim().refine((value) => (CLUSTER_RESOURCE_KINDS as readonly string[]).includes(value), "Unknown Cluster resource kind.");
const layoutSchema = z.object({
  visibleFieldIds: z.array(z.string().trim().min(1).max(160)).max(200),
  fieldOrder: z.array(z.string().trim().min(1).max(160)).max(200),
  pinnedFieldIds: z.array(z.string().trim().min(1).max(160)).max(40),
  fieldWidths: z.record(z.string(), z.number().int().min(48).max(1200)),
  collapsedGroupKeys: z.array(z.string().trim().min(1).max(600)).max(200).optional(),
});
const filterGroupSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().max(120).optional(),
  logic: z.enum(["and", "or"]),
  conditions: z.array(z.object({ fieldId: z.string().min(1).max(160), operator: z.string().min(1).max(40), value: z.unknown().optional() })).max(100),
  groups: z.array(filterGroupSchema).max(16).optional(),
}));
const querySchema = z.object({
  search: z.string().max(500).optional(),
  filters: filterGroupSchema.nullable().optional(),
  sorts: z.array(z.object({ fieldId: z.string().min(1).max(160), direction: z.enum(["asc", "desc"]) })).max(8).optional(),
  groups: z.array(z.object({ fieldId: z.string().min(1).max(160), direction: z.enum(["asc", "desc"]).optional(), collapsed: z.boolean().optional() })).max(8).optional(),
  aggregations: z.array(z.object({ id: z.string().min(1).max(160), kind: z.string().min(1).max(40), fieldId: z.string().max(160).nullable().optional(), label: z.string().max(160).nullable().optional(), display: z.object({ format: z.enum(["number", "integer", "percent", "bytes", "duration_ms", "currency"]).optional(), precision: z.number().int().min(0).max(6).optional(), unit: z.string().max(32).nullable().optional(), currency: z.string().length(3).nullable().optional() }).optional() })).max(20).optional(),
  projections: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    kind: z.enum(["grouped", "matrix"]),
    dimensions: z.array(z.string().trim().min(1).max(160)).min(1).max(2),
    measures: z.array(z.object({ id: z.string().min(1).max(160), kind: z.string().min(1).max(40), fieldId: z.string().max(160).nullable().optional(), label: z.string().max(160).nullable().optional() })).min(1).max(8),
    limit: z.number().int().min(1).max(200).optional(),
    drilldown: z.object({ mode: z.literal("filter"), fieldIds: z.array(z.string().trim().min(1).max(160)).max(2).optional(), presentation: presentationSchema.optional() }).nullable().optional(),
  })).max(4).optional(),
  derivedFields: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    type: z.enum(["number", "text"]),
    operation: z.enum(["add", "subtract", "multiply", "divide", "concat", "coalesce"]),
    left: z.discriminatedUnion("kind", [z.object({ kind: z.literal("field"), fieldId: z.string().trim().min(1).max(160) }), z.object({ kind: z.literal("number"), value: z.number().finite() }), z.object({ kind: z.literal("text"), value: z.string().max(240) })]),
    right: z.discriminatedUnion("kind", [z.object({ kind: z.literal("field"), fieldId: z.string().trim().min(1).max(160) }), z.object({ kind: z.literal("number"), value: z.number().finite() }), z.object({ kind: z.literal("text"), value: z.string().max(240) })]),
    display: z.object({ format: z.enum(["number", "integer", "percent", "bytes", "duration_ms", "currency"]).optional(), precision: z.number().int().min(0).max(6).optional(), unit: z.string().max(32).nullable().optional(), currency: z.string().length(3).nullable().optional() }).optional(),
  })).max(12).optional(),
  facets: z.array(z.string().min(1).max(160)).max(20).optional(),
  timeRange: z.object({ fieldId: z.string().min(1).max(160), from: z.string().max(80).nullable().optional(), to: z.string().max(80).nullable().optional() }).nullable().optional(),
  page: z.object({ cursor: z.string().max(500).nullable().optional(), limit: z.number().int().min(1).max(500).optional() }).optional(),
}).passthrough();

const viewWriteSchema = z.object({
  scope: scopeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  resourceKind: resourceKindSchema.nullable().optional(),
  visibility: visibilitySchema,
  projectId: z.string().trim().min(1).max(100).nullable().optional(),
  presentation: presentationSchema.default("table"),
  density: densitySchema.default("comfortable"),
  query: querySchema.default({}),
  layout: layoutSchema,
  isDefault: z.boolean().optional().default(false),
});

function serialize(record: any): ClusterSavedDataView {
  return {
    id: String(record.id),
    scope: String(record.scope),
    name: String(record.name),
    description: record.description == null ? null : String(record.description),
    resourceKind: record.resourceKind ? String(record.resourceKind) as ClusterResourceKind : null,
    visibility: String(record.visibility) as ClusterDataViewVisibility,
    ownerId: record.ownerId == null ? null : String(record.ownerId),
    projectId: record.projectId == null ? null : String(record.projectId),
    presentation: record.presentation,
    density: record.density,
    query: { ...(record.query || {}), sorts: normalizeClusterDataSorts(record.query?.sorts) },
    layout: record.layout as ClusterDataViewLayout,
    schemaVersion: Number(record.schemaVersion || 1),
    revision: Number(record.revision || 1),
    isDefault: Boolean(record.isDefault),
    archived: Boolean(record.archived),
    createdAt: record.createdAt?.toISOString?.() || String(record.createdAt || ""),
    updatedAt: record.updatedAt?.toISOString?.() || String(record.updatedAt || ""),
  };
}

export function registerDataViewRoutes({ app, prisma, getCurrentUser, authorization }: { app: any; prisma: any; getCurrentUser: (request: any) => Promise<any | null>; authorization: any }) {
  async function currentContext(request: any, reply: any, projectId?: string | null, access: "view" | "edit" = "view") {
    const user = await getCurrentUser(request);
    if (!user) { apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required."); return null; }
    if (projectId) {
      const project = await prisma.project.findFirst({ where: { id: projectId, archived: false } });
      if (!project) { apiError(request, reply, 404, "PROJECT_NOT_FOUND", "Project not found."); return null; }
      if (!(await authorization.requireTarget(request, reply, "project", project.id, project, access))) return null;
      return { user, workspaceId: project.workspaceId, project };
    }
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id }, orderBy: { id: "asc" }, select: { workspaceId: true } });
    if (!membership) { apiError(request, reply, 403, "WORKSPACE_REQUIRED", "Workspace membership required."); return null; }
    return { user, workspaceId: membership.workspaceId, project: null };
  }

  async function canMutateShared(request: any, reply: any, visibility: ClusterDataViewVisibility, projectId?: string | null) {
    if (visibility === "personal") return true;
    if (visibility === "studio") return Boolean(await authorization.requireAdmin(request, reply));
    return Boolean(projectId && await currentContext(request, reply, projectId, "edit"));
  }

  async function clearDefault(tx: any, input: { workspaceId: string; ownerId: string; scope: string; visibility: ClusterDataViewVisibility; projectId?: string | null; excludeId?: string }) {
    if (!input.excludeId && input.visibility === "personal") {
      await tx.savedDataView.updateMany({ where: { workspaceId: input.workspaceId, ownerId: input.ownerId, scope: input.scope, visibility: "personal", archived: false, isDefault: true }, data: { isDefault: false, revision: { increment: 1 } } });
      return;
    }
    const where: any = { workspaceId: input.workspaceId, scope: input.scope, visibility: input.visibility, archived: false, isDefault: true };
    if (input.visibility === "personal") where.ownerId = input.ownerId;
    if (input.visibility === "project") where.projectId = input.projectId || "";
    if (input.excludeId) where.id = { not: input.excludeId };
    await tx.savedDataView.updateMany({ where, data: { isDefault: false, revision: { increment: 1 } } });
  }

  app.get("/api/data-views", async (request: any, reply: any) => {
    const query = z.object({ scope: scopeSchema, resourceKind: resourceKindSchema.optional(), projectId: z.string().trim().min(1).max(100).optional() }).parse(request.query || {});
    const context = await currentContext(request, reply, query.projectId || null, "view");
    if (!context) return;
    const visibility: any[] = [
      { visibility: "personal", ownerId: context.user.id, projectId: query.projectId || null },
      { visibility: "studio", projectId: null },
    ];
    if (query.projectId) visibility.push({ visibility: "project", projectId: query.projectId });
    const rows = await prisma.savedDataView.findMany({
      where: { workspaceId: context.workspaceId, scope: query.scope, archived: false, ...(query.resourceKind ? { resourceKind: query.resourceKind } : {}), OR: visibility },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      take: 100,
    });
    return { ok: true, views: rows.map(serialize) };
  });

  app.post("/api/data-views", async (request: any, reply: any) => {
    const body = viewWriteSchema.parse(request.body || {});
    if (body.visibility === "project" && !body.projectId) return apiError(request, reply, 400, "PROJECT_REQUIRED", "Project views require a project.");
    if (body.visibility === "studio" && body.projectId) return apiError(request, reply, 400, "PROJECT_SCOPE_INVALID", "Studio views cannot be bound to one project.");
    const context = await currentContext(request, reply, body.projectId || null, body.visibility === "project" ? "edit" : "view");
    if (!context || !(await canMutateShared(request, reply, body.visibility, body.projectId))) return;
    const created = await prisma.$transaction(async (tx: any) => {
      if (body.isDefault) await clearDefault(tx, { workspaceId: context.workspaceId, ownerId: context.user.id, scope: body.scope, visibility: body.visibility, projectId: body.projectId });
      return tx.savedDataView.create({ data: {
        workspaceId: context.workspaceId, ownerId: context.user.id, projectId: body.projectId || null, scope: body.scope, resourceKind: body.resourceKind || null,
        name: body.name, description: body.description || null, visibility: body.visibility, presentation: body.presentation, density: body.density,
        query: body.query, layout: body.layout, isDefault: body.isDefault,
      } });
    });
    reply.code(201);
    return { ok: true, view: serialize(created) };
  });

  app.patch("/api/data-views/:id", async (request: any, reply: any) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).parse(request.params);
    const body = viewWriteSchema.partial().extend({ expectedRevision: z.number().int().min(1) }).parse(request.body || {});
    const existing = await prisma.savedDataView.findFirst({ where: { id: params.id, archived: false } });
    if (!existing) return apiError(request, reply, 404, "DATA_VIEW_NOT_FOUND", "Saved Data View not found.");
    const nextVisibility = (body.visibility || existing.visibility) as ClusterDataViewVisibility;
    const nextProjectId = body.projectId === undefined ? existing.projectId : body.projectId;
    const context = await currentContext(request, reply, nextProjectId || null, nextVisibility === "project" ? "edit" : "view");
    if (!context || context.workspaceId !== existing.workspaceId) return;
    if (existing.visibility === "personal" && existing.ownerId !== context.user.id) return apiError(request, reply, 403, "DATA_VIEW_OWNER_REQUIRED", "Only the owner can edit this personal view.");
    if (!(await canMutateShared(request, reply, nextVisibility, nextProjectId))) return;
    if (body.expectedRevision !== existing.revision) return apiError(request, reply, 409, "REVISION_CONFLICT", "Saved Data View changed on another device.");
    const updated = await prisma.$transaction(async (tx: any) => {
      if (body.isDefault) await clearDefault(tx, { workspaceId: existing.workspaceId, ownerId: context.user.id, scope: body.scope || existing.scope, visibility: nextVisibility, projectId: nextProjectId, excludeId: existing.id });
      const result = await tx.savedDataView.updateMany({ where: { id: existing.id, revision: existing.revision }, data: {
        ...(body.scope !== undefined ? { scope: body.scope } : {}), ...(body.name !== undefined ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.resourceKind !== undefined ? { resourceKind: body.resourceKind } : {}), ...(body.visibility !== undefined ? { visibility: body.visibility } : {}), ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.presentation !== undefined ? { presentation: body.presentation } : {}), ...(body.density !== undefined ? { density: body.density } : {}), ...(body.query !== undefined ? { query: body.query } : {}),
        ...(body.layout !== undefined ? { layout: body.layout } : {}), ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}), revision: { increment: 1 },
      } });
      if (!result.count) return null;
      return tx.savedDataView.findUnique({ where: { id: existing.id } });
    });
    if (!updated) return apiError(request, reply, 409, "REVISION_CONFLICT", "Saved Data View changed on another device.");
    return { ok: true, view: serialize(updated) };
  });

  app.delete("/api/data-views/:id", async (request: any, reply: any) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().min(1) }).parse(request.body || {});
    const existing = await prisma.savedDataView.findFirst({ where: { id: params.id, archived: false } });
    if (!existing) return apiError(request, reply, 404, "DATA_VIEW_NOT_FOUND", "Saved Data View not found.");
    const context = await currentContext(request, reply, existing.projectId || null, existing.visibility === "project" ? "edit" : "view");
    if (!context || context.workspaceId !== existing.workspaceId) return;
    if (existing.visibility === "personal" && existing.ownerId !== context.user.id) return apiError(request, reply, 403, "DATA_VIEW_OWNER_REQUIRED", "Only the owner can delete this personal view.");
    if (!(await canMutateShared(request, reply, existing.visibility as ClusterDataViewVisibility, existing.projectId))) return;
    const result = await prisma.savedDataView.updateMany({ where: { id: existing.id, revision: body.expectedRevision, archived: false }, data: { archived: true, isDefault: false, revision: { increment: 1 } } });
    if (!result.count) return apiError(request, reply, 409, "REVISION_CONFLICT", "Saved Data View changed on another device.");
    return { ok: true };
  });
}
