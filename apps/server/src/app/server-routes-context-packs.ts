import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { expectedServerConfigFields } from "../core/server-config-preconditions.js";
import { encryptContextPackStorageValue } from "../core/setting-crypto.js";
import { validateContextPackImport, ContextPackValidationError } from "../core/context-pack-policy.js";
import type { ServerRouteRegistrationDeps } from "./server-composition-types.js";

export function registerContextPackRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const {
    authorization, buildContextPackPayload, getCurrentUser, logActivity, parseContextPayload, pickContextPackSettings, prisma, readSettings, saveSettings, settingsForClient, serializeContextPack
  } = deps;

  app.get("/api/context-packs", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const packs = await prisma.contextPack.findMany({
      include: { createdBy: true },
      orderBy: { updatedAt: "desc" },
    });
    return packs.map((pack: any) => serializeContextPack(pack));
  });
  
  
  async function createFromSettings(request: any, reply: any, includeSecrets: boolean) {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const user = await getCurrentUser(request);
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        includeSecrets: z.boolean().optional(),
        reason: z.string().optional(),
      })
      .parse(request.body);
    if (!includeSecrets && body.includeSecrets) return reply.code(400).send({ ok: false, code: "CONTEXT_PACK_SECRET_ROUTE_REQUIRED", error: "Use the protected secret-creation route with passkey verification." });
    if (includeSecrets && (typeof body.reason !== "string" || body.reason.trim().length < 12 || body.reason.length > 500)) return reply.code(400).send({ ok: false, code: "CONTEXT_PACK_REASON_REQUIRED", error: "A reason of 12–500 characters is required to copy secrets into a Context Pack." });
    const payload = buildContextPackPayload(await readSettings(), includeSecrets);
    const pack = await prisma.contextPack.create({
      data: {
        name: body.name,
        description: body.description || null,
        payload: encryptContextPackStorageValue(JSON.stringify(payload, null, 2)),
        createdById: user?.id || null,
      },
      include: { createdBy: true },
    });
    await logActivity({
      userId: user?.id,
      type: "created",
      entityType: "context_pack",
      entityId: pack.id,
      title: "Context pack created",
      message: pack.name,
      metadata: { includesSecrets: payload.includesSecrets, reason: includeSecrets ? (body.reason ?? "").trim() : null },
    });
    reply.header("Cache-Control", "no-store");
    return serializeContextPack(pack, true);
  }

  app.post("/api/context-packs/from-settings", (request, reply) => createFromSettings(request, reply, false));
  // This endpoint is protected by the global single-use context_secret_export passkey policy.
  app.post("/api/context-packs/from-settings-with-secrets", (request, reply) => createFromSettings(request, reply, true));
  
  
  app.post("/api/context-packs/import", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const user = await getCurrentUser(request);
    const body = z
      .object({
        name: z.string().optional(),
        description: z.string().optional().nullable(),
        pack: z.unknown(),
      })
      .parse(request.body);
    let payload;
    try { payload = validateContextPackImport(body.pack); }
    catch (error) {
      if (error instanceof ContextPackValidationError) return reply.code(400).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
    const pack = await prisma.contextPack.create({
      data: {
        name: body.name || "Imported context pack",
        description: body.description ?? "Imported integration context.",
        payload: encryptContextPackStorageValue(JSON.stringify(payload, null, 2)),
        createdById: user?.id || null,
      },
      include: { createdBy: true },
    });
    await logActivity({
      userId: user?.id,
      type: "imported",
      entityType: "context_pack",
      entityId: pack.id,
      title: "Context pack imported",
      message: pack.name,
    });
    reply.header("Cache-Control", "no-store");
    return serializeContextPack(pack, true);
  });

  app.get("/api/context-packs/:packId/export", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const params = z.object({ packId: z.string() }).parse(request.params);
    const pack = await prisma.contextPack.findUniqueOrThrow({
      where: { id: params.packId },
      include: { createdBy: true },
    });
    return serializeContextPack(pack, true);
  });
  
  
  // Revealing stored secrets is a separate, auditable operation with a single-use
  // phishing-resistant reauthentication grant. The ordinary GET export is redacted.
  app.post("/api/context-packs/:packId/secret-export", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
    const reason = typeof (request.body as any)?.reason === "string" ? (request.body as any).reason.trim() : "";
    if (reason.length < 12 || reason.length > 500) return reply.code(400).send({ ok: false, code: "CONTEXT_PACK_REASON_REQUIRED", error: "Provide a reason of 12–500 characters for exporting secrets." });
    const params = z.object({ packId: z.string() }).parse(request.params);
    const pack = await prisma.contextPack.findUniqueOrThrow({ where: { id: params.packId }, include: { createdBy: true } });
    const user = await getCurrentUser(request);
    await logActivity({
      userId: user?.id, type: "exported", entityType: "context_pack", entityId: pack.id,
      title: "Sensitive context pack exported", message: pack.name,
      metadata: { sensitiveExport: true, reason },
    });
    return serializeContextPack(pack, true, true);
  });

  app.post("/api/context-packs/:packId/apply", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const user = await getCurrentUser(request);
    const params = z.object({ packId: z.string() }).parse(request.params);
    const pack = await prisma.contextPack.findUniqueOrThrow({
      where: { id: params.packId },
    });
    const payload = parseContextPayload(pack.payload);
    const existing = await readSettings(true);
    const changes = pickContextPackSettings(payload);
    if (!Object.keys(changes).length) return reply.code(400).send({ ok: false, code: "CONTEXT_PACK_EMPTY", error: "This context pack has no applicable settings." });
    try {
      await saveSettings({}, {
        changedFields: changes,
        expectedSettings: expectedServerConfigFields(settingsForClient(existing), changes),
      });
    } catch (error: any) {
      if (error?.code === "SERVER_CONFIG_CONFLICT") return reply.code(409).send({ ok: false, code: error.code, error: error.message, conflictingKeys: error.conflictingKeys });
      throw error;
    }
    await logActivity({
      userId: user?.id,
      type: "applied",
      entityType: "context_pack",
      entityId: pack.id,
      title: "Context pack applied",
      message: pack.name,
    });
    return { ok: true };
  });
  
  
  app.delete("/api/context-packs/:packId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const user = await getCurrentUser(request);
    const params = z.object({ packId: z.string() }).parse(request.params);
    const pack = await prisma.contextPack.delete({
      where: { id: params.packId },
    });
    await logActivity({
      userId: user?.id,
      type: "deleted",
      entityType: "context_pack",
      entityId: pack.id,
      title: "Context pack deleted",
      message: pack.name,
    });
    return { ok: true };
  });

}
