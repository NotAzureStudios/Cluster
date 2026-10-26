import { z } from "zod";
import type { FastifyInstance } from "fastify";

const EVENT_CLASSES = ["review", "source", "build", "qa", "ticket", "milestone", "release", "system", "all"] as const;
const routeBody = z.object({
  connectionId: z.string().trim().min(1),
  channelId: z.string().trim().regex(/^\d{8,24}$/),
  displayName: z.string().trim().max(160).optional().nullable(),
  eventClasses: z.array(z.enum(EVENT_CLASSES)).min(1).max(9).default(["all"]),
  minPriority: z.enum(["normal", "medium", "high", "critical"]).default("medium"),
  mentionMode: z.enum(["off", "linked"]).default("linked"),
  routeKind: z.enum(["channel", "thread"]).default("channel"),
});

export function registerDiscordProductionRoutes(input: {
  app: FastifyInstance;
  service: any;
  authorization: any;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  logActivity: (input: any) => Promise<void>;
}) {
  input.app.get("/api/projects/:projectId/discord/channels", async (request: any, reply: any) => {
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    if (!(await input.enforceTargetAccess(request, reply, "project", projectId, "view"))) return;
    return { ok: true, ...(await input.service.availableChannels(projectId)) };
  });

  input.app.get("/api/projects/:projectId/discord/routes", async (request: any, reply: any) => {
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    if (!(await input.enforceTargetAccess(request, reply, "project", projectId, "view"))) return;
    return { ok: true, routes: await input.service.projectRoutes(projectId) };
  });

  input.app.post("/api/projects/:projectId/discord/routes", async (request: any, reply: any) => {
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const actor = await input.enforceTargetAccess(request, reply, "project", projectId, "manage");
    if (!actor) return;
    const route = await input.service.upsertProjectRoute(projectId, null, routeBody.parse(request.body || {}));
    await input.logActivity({ userId: actor.id, projectId, type: "discord_route_created", entityType: "integration", entityId: route.id, title: "Discord delivery route created", message: route.displayName, metadata: { connectionId: route.connectionId, channelId: route.channelId } });
    return reply.code(201).send({ ok: true, route });
  });

  input.app.put("/api/projects/:projectId/discord/routes/:routeId", async (request: any, reply: any) => {
    const { projectId, routeId } = z.object({ projectId: z.string().min(1), routeId: z.string().min(1) }).parse(request.params);
    const actor = await input.enforceTargetAccess(request, reply, "project", projectId, "manage");
    if (!actor) return;
    const route = await input.service.upsertProjectRoute(projectId, routeId, routeBody.parse(request.body || {}));
    await input.logActivity({ userId: actor.id, projectId, type: "discord_route_updated", entityType: "integration", entityId: route.id, title: "Discord delivery route updated", message: route.displayName, metadata: { connectionId: route.connectionId, channelId: route.channelId } });
    return { ok: true, route };
  });

  input.app.delete("/api/projects/:projectId/discord/routes/:routeId", async (request: any, reply: any) => {
    const { projectId, routeId } = z.object({ projectId: z.string().min(1), routeId: z.string().min(1) }).parse(request.params);
    const actor = await input.enforceTargetAccess(request, reply, "project", projectId, "manage");
    if (!actor) return;
    const result = await input.service.archiveProjectRoute(projectId, routeId);
    await input.logActivity({ userId: actor.id, projectId, type: "discord_route_archived", entityType: "integration", entityId: routeId, title: "Discord delivery route removed", metadata: {} });
    return { ok: true, ...result };
  });

  input.app.post("/api/projects/:projectId/discord/reconcile", async (request: any, reply: any) => {
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    if (!(await input.enforceTargetAccess(request, reply, "project", projectId, "manage"))) return;
    return { ok: true, ...(await input.service.reconcileRoutes({ projectId })) };
  });

  input.app.get("/api/admin/discord/status", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "view"))) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, ...(await input.service.deliverySummary()) };
  });

  input.app.post("/api/admin/discord/reconcile", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "manage"))) return;
    return { ok: true, ...(await input.service.reconcileRoutes()) };
  });

  // Recover pending delivery receipts stranded between database persistence
  // and queue publication, without re-sending completed Discord messages.
  input.app.post("/api/admin/discord/deliveries/repair", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "manage"))) return;
    return { ok: true, ...(await input.service.repairPendingDeliveries()) };
  });

  input.app.post("/api/admin/discord/deliveries/:receiptId/retry", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "manage"))) return;
    const { receiptId } = z.object({ receiptId: z.string().min(1) }).parse(request.params);
    return { ok: true, ...(await input.service.retryDelivery(receiptId)) };
  });

  input.app.post("/api/admin/discord/commands/sync", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "manage"))) return;
    return { ok: true, ...(await input.service.syncCommands()) };
  });
}
