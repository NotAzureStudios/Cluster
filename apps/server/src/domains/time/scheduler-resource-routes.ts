import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";
import { z } from "zod";
import { SCHEDULING_CONTRACT } from "@cluster/shared";
import {
  acquireSchedulePlacementLocks,
  findPreferredAvailabilitySignals,
  findSchedulePlacementConflicts,
  normalizeScheduleResourceRequests,
  schedulerProjectResourceRecommendations,
  serializeScheduleResource,
} from "./scheduler-planning.js";

type SchedulerResourceRouteDeps = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasToolPermission: (user: any, role: string | null | undefined, tool: string, minimum?: string) => boolean;
  logActivity: (input: any) => Promise<any>;
  authorization: AuthorizationService;
};

const resourceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(SCHEDULING_CONTRACT.scheduler.resourceTypes),
  description: z.string().trim().max(2000).optional().nullable(),
  location: z.string().trim().max(240).optional().nullable(),
  quantityTotal: z.number().int().min(1).max(SCHEDULING_CONTRACT.scheduler.maximumResourceQuantity).optional().default(1),
  status: z.enum(SCHEDULING_CONTRACT.scheduler.resourceStatuses).optional().default(SCHEDULING_CONTRACT.scheduler.defaultResourceStatus),
  tags: z.array(z.string().trim().min(1).max(80)).max(64).optional().default([]),
  projectTypeIds: z.array(z.string().trim().min(1).max(64)).max(64).optional().default([]),
  color: z.string().trim().max(32).optional().nullable(),
  expectedRevision: z.number().int().min(1).optional(),
  force: z.boolean().optional().default(false),
});

async function resourceReservationPressure(db: any, resourceId: string) {
  const now = new Date();
  const rows = await db.scheduleBlock.findMany({
    where: { status: { not: "cancelled" }, endsAt: { gt: now }, resourceReservations: { some: { resourceId } } },
    include: { resourceReservations: { where: { resourceId } } },
    orderBy: { startsAt: "asc" },
    take: SCHEDULING_CONTRACT.scheduler.maximumBlocksPerRange,
  });
  const events: Array<{ at: number; delta: number }> = [];
  for (const block of rows) {
    const reservation = block.resourceReservations?.[0];
    if (!reservation) continue;
    const quantity = Math.max(1, Number(reservation.quantity || 1));
    events.push({ at: Math.max(now.getTime(), new Date(block.startsAt).getTime()), delta: quantity });
    events.push({ at: new Date(block.endsAt).getTime(), delta: -quantity });
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let running = 0;
  let peakReserved = 0;
  for (const event of events) { running += event.delta; peakReserved = Math.max(peakReserved, running); }
  return { futureReservations: rows.length, peakReserved, nextStartsAt: rows[0]?.startsAt || null };
}

export function registerSchedulerResourceRoutes({ app, prisma, getCurrentUser, decorateUserForClient, hasToolPermission, logActivity, authorization }: SchedulerResourceRouteDeps) {
  async function requireManager(request: FastifyRequest, reply: FastifyReply) {
    const actor = await getCurrentUser(request);
    if (!actor) {
      reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
      return null;
    }
    const decorated = await decorateUserForClient(actor);
    if (!decorated?.isAdmin && !hasToolPermission(actor, decorated?.workspaceRole, "scheduler", "manage")) {
      reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "Scheduler manage permission required." });
      return null;
    }
    return actor;
  }

  app.get("/api/schedule/resources", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) throw new Error("Login required.");
    const query = z.object({
      type: z.enum(SCHEDULING_CONTRACT.scheduler.resourceTypes).optional(),
      status: z.enum(SCHEDULING_CONTRACT.scheduler.resourceStatuses).optional(),
      projectId: z.string().optional(),
      includeRetired: z.coerce.boolean().optional(),
      q: z.string().trim().max(120).optional(),
    }).parse(request.query || {});
    if (query.projectId) {
      const project = await prisma.project.findUnique({ where: { id: query.projectId } });
      if (!project) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
      if (!(await authorization.requireTarget(request, reply, "schedule", `resources:${project.id}`, project, "view"))) return;
      return schedulerProjectResourceRecommendations(prisma, query.projectId);
    }
    const where: any = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    else if (!query.includeRetired) where.status = { not: "retired" };
    if (query.q) where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      { location: { contains: query.q, mode: "insensitive" } },
      { tags: { contains: query.q, mode: "insensitive" } },
    ];
    const rows = await prisma.scheduleResource.findMany({ where, orderBy: [{ status: "asc" }, { type: "asc" }, { name: "asc" }], take: SCHEDULING_CONTRACT.scheduler.maximumResources });
    return rows.map(serializeScheduleResource);
  });

  app.post("/api/schedule/resources", async (request, reply) => {
    const actor = await requireManager(request, reply);
    if (!actor) return;
    const body = resourceInputSchema.parse(request.body);
    const resource = await prisma.scheduleResource.create({
      data: {
        name: body.name,
        type: body.type,
        description: body.description || null,
        location: body.location || null,
        quantityTotal: body.quantityTotal,
        status: body.status,
        tags: JSON.stringify(Array.from(new Set(body.tags))),
        projectTypeIds: JSON.stringify(Array.from(new Set(body.projectTypeIds))),
        color: body.color || null,
      },
    });
    await logActivity({ userId: actor.id, type: "created", entityType: "schedule_resource", entityId: resource.id, title: "Scheduler resource created", message: resource.name, metadata: { resourceType: resource.type, quantityTotal: resource.quantityTotal } });
    return serializeScheduleResource(resource);
  });

  app.put("/api/schedule/resources/:resourceId", async (request, reply) => {
    const actor = await requireManager(request, reply);
    if (!actor) return;
    const { resourceId } = z.object({ resourceId: z.string() }).parse(request.params);
    const body = resourceInputSchema.parse(request.body);
    if (body.quantityTotal < 1) return reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "Resource capacity must be at least one." });
    const result: any = await prisma.$transaction(async (tx: any) => {
      await acquireSchedulePlacementLocks(tx, { resources: [{ resourceId, quantity: body.quantityTotal }] });
      const existing = await tx.scheduleResource.findUnique({ where: { id: resourceId } });
      if (!existing) return { error: { status: 404, code: "RESOURCE_NOT_FOUND", message: "Scheduler resource not found." } };
      if (body.expectedRevision && Number(existing.revision || 1) !== body.expectedRevision) return { error: { status: 409, code: "REVISION_CONFLICT", message: "This resource changed since you opened it.", currentRevision: Number(existing.revision || 1) } };
      const pressure = await resourceReservationPressure(tx, resourceId);
      const lifecycleTightened = existing.status === "active" && body.status !== "active";
      const capacityTightened = Number(body.quantityTotal) < Number(existing.quantityTotal || 1) && pressure.peakReserved > Number(body.quantityTotal);
      if (!body.force && lifecycleTightened && pressure.futureReservations > 0) return { error: { status: 409, code: "RESOURCE_IN_USE", message: `${existing.name} still has ${pressure.futureReservations} future reservation${pressure.futureReservations === 1 ? "" : "s"}. Move or cancel those windows before changing its lifecycle, or explicitly force the change.`, pressure } };
      if (!body.force && capacityTightened) return { error: { status: 409, code: "RESOURCE_CAPACITY_IN_USE", message: `${existing.name} reaches ${pressure.peakReserved} concurrent reservations, above the requested capacity of ${body.quantityTotal}.`, pressure } };
      const resource = await tx.scheduleResource.update({
        where: { id: resourceId },
        data: {
          name: body.name,
          type: body.type,
          description: body.description || null,
          location: body.location || null,
          quantityTotal: body.quantityTotal,
          status: body.status,
          tags: JSON.stringify(Array.from(new Set(body.tags))),
          projectTypeIds: JSON.stringify(Array.from(new Set(body.projectTypeIds))),
          color: body.color || null,
          revision: { increment: 1 },
        },
      });
      return { resource, existing, pressure };
    });
    if (result?.error) return reply.code(result.error.status || 409).send({ ok: false, code: result.error.code, error: result.error.message, currentRevision: result.error.currentRevision, pressure: result.error.pressure });
    await logActivity({ userId: actor.id, type: "updated", entityType: "schedule_resource", entityId: result.resource.id, title: "Scheduler resource updated", message: result.resource.name, metadata: { previousStatus: result.existing.status, status: result.resource.status, quantityTotal: result.resource.quantityTotal, forcedWithReservations: Boolean(body.force && result.pressure.futureReservations) } });
    return serializeScheduleResource(result.resource);
  });

  app.get("/api/schedule/resources/:resourceId", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) throw new Error("Login required.");
    const { resourceId } = z.object({ resourceId: z.string() }).parse(request.params);
    const resource = await prisma.scheduleResource.findUnique({ where: { id: resourceId } });
    if (!resource) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Scheduler resource not found." });
    const pressure = await resourceReservationPressure(prisma, resourceId);
    return { ...serializeScheduleResource(resource), planningImpact: pressure };
  });

  app.post("/api/schedule/availability", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) throw new Error("Login required.");
    const decorated = await decorateUserForClient(actor);
    const canManage = Boolean(decorated?.isAdmin || hasToolPermission(actor, decorated?.workspaceRole, "scheduler", "manage"));
    const body = z.object({
      startsAt: z.string(),
      endsAt: z.string(),
      userIds: z.array(z.string()).max(SCHEDULING_CONTRACT.scheduler.maximumParticipantsPerBlock + 1).optional().default([]),
      resources: z.array(z.object({ resourceId: z.string(), quantity: z.number().int().min(1).max(SCHEDULING_CONTRACT.scheduler.maximumResourceQuantity).optional() })).max(SCHEDULING_CONTRACT.scheduler.maximumResourcesPerBlock).optional().default([]),
      excludeBlockId: z.string().optional().nullable(),
    }).parse(request.body || {});
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (!(startsAt < endsAt)) return reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "Schedule end must be after start." });
    const requestedUsers: string[] = Array.from(new Set<string>(body.userIds.map((value: unknown) => String(value || "")).filter((value: string) => Boolean(value))));
    const userIds = canManage ? requestedUsers : requestedUsers.filter((id) => id === actor.id);
    if (!canManage && requestedUsers.some((id) => id !== actor.id)) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "Scheduler manage permission required to check another person's availability." });
    const [conflicts, availabilitySignals] = await Promise.all([
      findSchedulePlacementConflicts(prisma, { startsAt, endsAt, userIds, resources: normalizeScheduleResourceRequests(body.resources), excludeBlockId: body.excludeBlockId || null }),
      findPreferredAvailabilitySignals(prisma, { startsAt, endsAt, userIds }),
    ]);
    return { ok: true, available: conflicts.length === 0, conflicts, availabilitySignals };
  });
}
