import { z } from "zod";
import { apiError } from "../../core/api-response.js";

const stateScopeSchema = z.enum(["user", "studio"]);
const stateKeySchema = z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/i);
const MAX_STATE_BYTES = 256 * 1024;

function parsePayload(value: unknown) {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function serializedPayload(value: unknown) {
  const payload = JSON.stringify(value ?? null);
  if (Buffer.byteLength(payload, "utf8") > MAX_STATE_BYTES) {
    const error = new Error("Client state payload exceeds 256 KiB.") as Error & { statusCode?: number; code?: string };
    error.statusCode = 413;
    error.code = "CLIENT_STATE_TOO_LARGE";
    throw error;
  }
  return payload;
}

function serialize(record: any) {
  return {
    id: record.id,
    scope: record.scope,
    key: record.key,
    payload: parsePayload(record.payload),
    revision: Number(record.revision || 1),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

type Dependencies = {
  app: any;
  prisma: any;
  getCurrentUser: (request: any) => Promise<any | null>;
  authorization: any;
};

export function registerClientStateRoutes({ app, prisma, getCurrentUser, authorization }: Dependencies) {
  function studioStateToolRule(key: string, access: "view" | "edit") {
    if (key === "operations.attachments") return access === "view" ? { tool: "library", level: "view" } : null;
    if (key === "time.shift-rules") return { tool: "scheduler", level: access === "edit" ? "manage" : "view" };
    if (key.startsWith("time.")) return { tool: "scheduler", level: access };
    if (key.startsWith("team.")) return { tool: "people", level: access };
    if (key.startsWith("templates.") || key.startsWith("automation.")) return { tool: "settings", level: access };
    return null;
  }

  async function requireStudioStateAccess(request: any, reply: any, key: string, access: "view" | "edit") {
    if (key === "operations.attachments" && access === "edit") return authorization.requireAdmin(request, reply);
    const toolRule = studioStateToolRule(key, access);
    if (toolRule) return authorization.requireTool(request, reply, toolRule.tool, toolRule.level);
    return authorization.requireAdmin(request, reply);
  }

  async function canManageTool(request: any, tool: string) {
    const identity = await authorization.identityForRequest(request);
    return Boolean(identity?.decorated?.isAdmin || (identity?.user && authorization.hasToolPermission(identity.user, identity.role, tool, "manage")));
  }

  function userOwnedStudioStateKey(key: string) {
    return key === "time.correction-requests" || key === "time.break-ledger";
  }

  function filterOwnedRows(payload: unknown, userId: string) {
    if (!Array.isArray(payload)) return [];
    return payload.filter((item: any) => String(item?.userId || "") === userId);
  }

  async function filterAttachmentRowsForRequest(request: any, payload: unknown) {
    if (!Array.isArray(payload)) return [];
    const identity = await authorization.identityForRequest(request);
    if (!identity?.user) return [];
    if (identity.decorated?.isAdmin) return payload;
    const projectIds = [...new Set(payload.map((item: any) => String(item?.projectId || "").trim()).filter(Boolean))];
    const projects = projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds }, archived: false } }) : [];
    const projectMap = new Map(projects.map((project: any) => [String(project.id), project]));
    const rules = projectIds.length ? ((await prisma.accessRule?.findMany?.({ where: { status: "active", OR: projectIds.map((projectId: string) => ({ targetKind: "project", targetId: projectId })) } }).catch(() => [])) || []) : [];
    return payload.filter((item: any) => {
      const projectId = String(item?.projectId || "").trim();
      if (!projectId) return true;
      const project = projectMap.get(projectId);
      return Boolean(project && authorization.hasProjectResourceAccess(identity.user, identity.role, project, rules, "view"));
    });
  }

  async function visiblePayloadForRequest(request: any, key: string, payload: unknown) {
    if (userOwnedStudioStateKey(key) && !(await canManageTool(request, "scheduler"))) {
      const identity = await authorization.identityForRequest(request);
      return filterOwnedRows(payload, String(identity?.user?.id || ""));
    }
    if (key === "operations.attachments") return filterAttachmentRowsForRequest(request, payload);
    return payload;
  }

  async function mergePayloadForWrite(request: any, key: string, existingPayload: unknown, incomingPayload: unknown) {
    if (!userOwnedStudioStateKey(key) || await canManageTool(request, "scheduler")) return incomingPayload;
    const identity = await authorization.identityForRequest(request);
    const userId = String(identity?.user?.id || "");
    const existing = Array.isArray(existingPayload) ? existingPayload : [];
    const incoming = filterOwnedRows(incomingPayload, userId);
    const preserved = existing.filter((item: any) => String(item?.userId || "") !== userId);
    return [...incoming, ...preserved].slice(0, 1000);
  }

  async function serializeForRequest(request: any, record: any) {
    const result = serialize(record);
    return { ...result, payload: await visiblePayloadForRequest(request, record.key, result.payload) };
  }

  async function resolveScope(request: any, reply: any, scopeInput: unknown, access: "view" | "edit" = "view", key = "") {
    const scope = stateScopeSchema.parse(scopeInput);
    const user = await getCurrentUser(request);
    if (!user) {
      apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
      return null;
    }
    if (scope === "studio") {
      const authorized = key
        ? await requireStudioStateAccess(request, reply, key, access)
        : await authorization.requireAdmin(request, reply);
      if (!authorized) return null;
      return { scope, scopeId: "studio", user: authorized };
    }
    return { scope, scopeId: user.id, user };
  }

  app.get("/api/client-state/:scope", async (request: any, reply: any) => {
    const params = z.object({ scope: stateScopeSchema }).parse(request.params);
    const resolved = await resolveScope(request, reply, params.scope);
    if (!resolved) return;
    const query = z.object({
      keys: z.string().max(8000).optional(),
      prefix: z.string().trim().min(1).max(200).optional(),
    }).refine((value) => !(value.keys && value.prefix), { message: "Use either keys or prefix, not both." }).parse(request.query || {});
    const keys = query.keys ? Array.from(new Set(query.keys.split(",").map((value) => value.trim()).filter(Boolean))).slice(0, 200).map((key) => stateKeySchema.parse(key)) : [];
    const prefix = query.prefix ? stateKeySchema.parse(query.prefix) : null;
    const records = await prisma.clientStateRecord.findMany({
      where: {
        scope: resolved.scope,
        scopeId: resolved.scopeId,
        ...(keys.length ? { key: { in: keys } } : prefix ? { key: { startsWith: prefix } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: keys.length ? Math.min(keys.length, 200) : 200,
    });
    return { ok: true, scope: resolved.scope, records: records.map(serialize) };
  });

  app.get("/api/client-state/:scope/:key", async (request: any, reply: any) => {
    const params = z.object({ scope: stateScopeSchema, key: stateKeySchema }).parse(request.params);
    const resolved = await resolveScope(request, reply, params.scope, "view", params.key);
    if (!resolved) return;
    const record = await prisma.clientStateRecord.findUnique({ where: { scope_scopeId_key: { scope: resolved.scope, scopeId: resolved.scopeId, key: params.key } } });
    if (!record) return { ok: true, scope: resolved.scope, key: params.key, record: null };
    return { ok: true, scope: resolved.scope, key: params.key, record: await serializeForRequest(request, record) };
  });

  app.put("/api/client-state/:scope/:key", async (request: any, reply: any) => {
    const params = z.object({ scope: stateScopeSchema, key: stateKeySchema }).parse(request.params);
    const body = z.object({ payload: z.unknown(), expectedRevision: z.number().int().min(0).optional() }).parse(request.body || {});
    const resolved = await resolveScope(request, reply, params.scope, "edit", params.key);
    if (!resolved) return;
    const identity = { scope: resolved.scope, scopeId: resolved.scopeId, key: params.key };
    const existing = await prisma.clientStateRecord.findUnique({ where: { scope_scopeId_key: identity } });
    const existingPayload = existing ? parsePayload(existing.payload) : null;
    const mergedPayload = resolved.scope === "studio" ? await mergePayloadForWrite(request, params.key, existingPayload, body.payload) : body.payload;
    const payload = serializedPayload(mergedPayload);
    if (!existing) {
      if (body.expectedRevision && body.expectedRevision > 0) return apiError(request, reply, 409, "REVISION_CONFLICT", "Client state changed on another device.");
      try {
        const created = await prisma.clientStateRecord.create({ data: { ...identity, payload, revision: 1 } });
        reply.code(201);
        return { ok: true, record: await serializeForRequest(request, created) };
      } catch (error) {
        const raced = await prisma.clientStateRecord.findUnique({ where: { scope_scopeId_key: identity } });
        if (raced) return apiError(request, reply, 409, "REVISION_CONFLICT", "Client state changed on another device.");
        throw error;
      }
    }
    if (body.expectedRevision != null && body.expectedRevision !== existing.revision) return apiError(request, reply, 409, "REVISION_CONFLICT", "Client state changed on another device.");
    const expectedRevision = body.expectedRevision ?? existing.revision;
    const update = await prisma.clientStateRecord.updateMany({
      where: { id: existing.id, revision: expectedRevision },
      data: { payload, revision: { increment: 1 } },
    });
    if (!update.count) return apiError(request, reply, 409, "REVISION_CONFLICT", "Client state changed on another device.");
    const updated = await prisma.clientStateRecord.findUniqueOrThrow({ where: { id: existing.id } });
    return { ok: true, record: await serializeForRequest(request, updated) };
  });

app.delete("/api/client-state/:scope/:key", async (request: any, reply: any) => {
    const params = z.object({ scope: stateScopeSchema, key: stateKeySchema }).parse(request.params);
    const resolved = await resolveScope(request, reply, params.scope, "edit", params.key);
    if (!resolved) return;
    if (resolved.scope === "studio" && userOwnedStudioStateKey(params.key) && !(await canManageTool(request, "scheduler"))) {
      if (!(await authorization.requireTool(request, reply, "scheduler", "manage"))) return;
    }
    await prisma.clientStateRecord.deleteMany({ where: { scope: resolved.scope, scopeId: resolved.scopeId, key: params.key } });
    return { ok: true };
  });
}
