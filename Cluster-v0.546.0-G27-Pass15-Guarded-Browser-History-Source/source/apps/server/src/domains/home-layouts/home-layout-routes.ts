import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError } from "../../core/api-response.js";

const HOME_LAYOUT_STATE_KEY = "dashboard.home-layout-sharing-v2";
const HOME_LAYOUT_SCOPE = "studio";
const HOME_LAYOUT_SCOPE_ID = "studio";
const MAX_TEMPLATES = 12;
const MAX_SHARED = 32;
const MAX_SHARED_PER_USER = 4;
const MAX_SERIALIZED_BYTES = 256 * 1024;

const configSchema = z.object({
  listLimit: z.number().int().min(1).max(12).optional(),
  showActions: z.boolean().optional(),
  clockFormat: z.enum(["time", "date", "datetime"]).optional(),
  noteTitle: z.string().max(48).optional(),
  context: z.enum(["studio", "current-project", "project", "me", "my-role", "user", "role"]).optional(),
  contextId: z.string().trim().max(120).optional(),
  timeRange: z.enum(["all", "today", "7d", "30d", "90d"]).optional(),
  filterText: z.string().max(120).optional(),
  detailLevel: z.enum(["compact", "standard", "detailed"]).optional(),
  savedViewId: z.string().trim().max(160).optional(),
}).optional();

const layoutItemSchema = z.object({
  id: z.string().trim().min(1).max(96).regex(/^[a-z0-9][a-z0-9._:-]*$/i),
  enabled: z.boolean(),
  order: z.number().int().min(0).max(500),
  size: z.enum(["micro", "compact", "standard", "wide", "large", "feature"]),
  column: z.number().int().min(1).max(20),
  source: z.enum(["builtin", "custom"]),
  config: configSchema,
});

const layoutSchema = z.object({ schema: z.literal(2), items: z.array(layoutItemSchema).max(64) });
const templateInputSchema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(40), description: z.string().trim().max(180).optional().default(""), layout: layoutSchema });
const sharedInputSchema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(40), layout: layoutSchema });

type Layout = z.infer<typeof layoutSchema>;
type StudioHomeTemplate = { id: string; name: string; description: string; createdAt: string; updatedAt: string; createdByUserId: string; layout: Layout };
type SharedHomeProfile = { id: string; name: string; ownerUserId: string; ownerLabel: string; createdAt: string; updatedAt: string; layout: Layout };
type HomeLayoutSharingState = { schema: 2; templates: StudioHomeTemplate[]; sharedProfiles: SharedHomeProfile[] };

function emptyState(): HomeLayoutSharingState { return { schema: 2, templates: [], sharedProfiles: [] }; }
function parsePayload(value: unknown): HomeLayoutSharingState {
  let raw: any = value;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return emptyState(); } }
  if (!raw || raw.schema !== 2) return emptyState();
  const templates = Array.isArray(raw.templates) ? raw.templates.flatMap((item: any) => {
    const parsed = templateInputSchema.safeParse(item);
    if (!parsed.success || typeof item.id !== "string" || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" || typeof item.createdByUserId !== "string") return [];
    return [{ ...parsed.data, id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, createdByUserId: item.createdByUserId } as StudioHomeTemplate];
  }).slice(0, MAX_TEMPLATES) : [];
  const sharedProfiles = Array.isArray(raw.sharedProfiles) ? raw.sharedProfiles.flatMap((item: any) => {
    const parsed = sharedInputSchema.safeParse(item);
    if (!parsed.success || typeof item.id !== "string" || typeof item.ownerUserId !== "string" || typeof item.ownerLabel !== "string" || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") return [];
    return [{ ...parsed.data, id: item.id, ownerUserId: item.ownerUserId, ownerLabel: item.ownerLabel, createdAt: item.createdAt, updatedAt: item.updatedAt } as SharedHomeProfile];
  }).slice(0, MAX_SHARED) : [];
  return { schema: 2, templates, sharedProfiles };
}

function serializeState(state: HomeLayoutSharingState) {
  const payload = JSON.stringify(state);
  if (Buffer.byteLength(payload, "utf8") > MAX_SERIALIZED_BYTES) {
    const error = new Error("Shared Home layout state exceeds 256 KiB.") as Error & { statusCode?: number; code?: string };
    error.statusCode = 413;
    error.code = "HOME_LAYOUT_STATE_TOO_LARGE";
    throw error;
  }
  return payload;
}

function ownerLabel(user: any) {
  return String(user?.displayName || user?.preferredName || user?.username || "Studio member").trim().slice(0, 120) || "Studio member";
}

type Dependencies = { app: any; prisma: any; getCurrentUser: (request: any) => Promise<any | null>; authorization: any };

export function registerHomeLayoutRoutes({ app, prisma, getCurrentUser, authorization }: Dependencies) {
  async function readState() {
    const record = await prisma.clientStateRecord.findUnique({ where: { scope_scopeId_key: { scope: HOME_LAYOUT_SCOPE, scopeId: HOME_LAYOUT_SCOPE_ID, key: HOME_LAYOUT_STATE_KEY } } });
    return { record, state: record ? parsePayload(record.payload) : emptyState() };
  }

  async function mutateState(update: (state: HomeLayoutSharingState) => HomeLayoutSharingState) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { record, state } = await readState();
      const next = update(state);
      const payload = serializeState(next);
      if (!record) {
        try {
          return await prisma.clientStateRecord.create({ data: { scope: HOME_LAYOUT_SCOPE, scopeId: HOME_LAYOUT_SCOPE_ID, key: HOME_LAYOUT_STATE_KEY, payload, revision: 1 } });
        } catch { continue; }
      }
      const written = await prisma.clientStateRecord.updateMany({ where: { id: record.id, revision: record.revision }, data: { payload, revision: { increment: 1 } } });
      if (written.count) return prisma.clientStateRecord.findUniqueOrThrow({ where: { id: record.id } });
    }
    const error = new Error("Shared Home layouts changed on another client.") as Error & { statusCode?: number; code?: string };
    error.statusCode = 409;
    error.code = "HOME_LAYOUT_REVISION_CONFLICT";
    throw error;
  }

  app.get("/api/home-layouts", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    const { state } = await readState();
    return { ok: true, state, currentUserId: user.id };
  });

  app.post("/api/home-layouts/templates", async (request: any, reply: any) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const body = templateInputSchema.parse(request.body || {});
    const now = new Date().toISOString();
    let result: StudioHomeTemplate | null = null;
    await mutateState((state) => {
      const existing = body.id ? state.templates.find((item) => item.id === body.id) : undefined;
      if (!existing && state.templates.length >= MAX_TEMPLATES) {
        const error = new Error(`A Studio can publish at most ${MAX_TEMPLATES} Home templates.`) as Error & { statusCode?: number; code?: string };
        error.statusCode = 409; error.code = "HOME_TEMPLATE_LIMIT"; throw error;
      }
      result = { id: existing?.id || randomUUID(), name: body.name, description: body.description, createdAt: existing?.createdAt || now, updatedAt: now, createdByUserId: existing?.createdByUserId || admin.id, layout: body.layout };
      return { ...state, templates: existing ? state.templates.map((item) => item.id === existing.id ? result! : item) : [...state.templates, result!] };
    });
    reply.code(body.id ? 200 : 201);
    return { ok: true, template: result };
  });

  app.delete("/api/home-layouts/templates/:id", async (request: any, reply: any) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await mutateState((state) => ({ ...state, templates: state.templates.filter((item) => item.id !== id) }));
    return { ok: true };
  });

  app.post("/api/home-layouts/shared", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    const body = sharedInputSchema.parse(request.body || {});
    const now = new Date().toISOString();
    let result: SharedHomeProfile | null = null;
    await mutateState((state) => {
      const existing = body.id ? state.sharedProfiles.find((item) => item.id === body.id) : undefined;
      if (existing && existing.ownerUserId !== user.id) {
        const error = new Error("Only the owner can update a shared Home profile.") as Error & { statusCode?: number; code?: string };
        error.statusCode = 403; error.code = "HOME_PROFILE_OWNER_REQUIRED"; throw error;
      }
      if (!existing && state.sharedProfiles.filter((item) => item.ownerUserId === user.id).length >= MAX_SHARED_PER_USER) {
        const error = new Error(`You can share at most ${MAX_SHARED_PER_USER} Home profiles.`) as Error & { statusCode?: number; code?: string };
        error.statusCode = 409; error.code = "HOME_PROFILE_USER_LIMIT"; throw error;
      }
      if (!existing && state.sharedProfiles.length >= MAX_SHARED) {
        const error = new Error(`A Studio can keep at most ${MAX_SHARED} shared Home profiles.`) as Error & { statusCode?: number; code?: string };
        error.statusCode = 409; error.code = "HOME_PROFILE_STUDIO_LIMIT"; throw error;
      }
      result = { id: existing?.id || randomUUID(), name: body.name, ownerUserId: user.id, ownerLabel: ownerLabel(user), createdAt: existing?.createdAt || now, updatedAt: now, layout: body.layout };
      return { ...state, sharedProfiles: existing ? state.sharedProfiles.map((item) => item.id === existing.id ? result! : item) : [...state.sharedProfiles, result!] };
    });
    reply.code(body.id ? 200 : 201);
    return { ok: true, profile: result };
  });

  app.delete("/api/home-layouts/shared/:id", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { state } = await readState();
    const target = state.sharedProfiles.find((item) => item.id === id);
    if (!target) return { ok: true };
    if (target.ownerUserId !== user.id) {
      const admin = await authorization.requireAdmin(request, reply);
      if (!admin) return;
    }
    await mutateState((current) => ({ ...current, sharedProfiles: current.sharedProfiles.filter((item) => item.id !== id) }));
    return { ok: true };
  });
}
