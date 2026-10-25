import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";
import { SYSTEM_ALERT_KEYS, ACTIVE_INCIDENT_STATUSES, defaultAlertPolicy, eligibleAlertAdminIds, validateAlertPolicy } from "../../core/operations-incident-alert-routing.js";
import { commitOperationsAlertPolicyBatch } from "../../core/operations-incident-alert-policies.js";

const alertTypeSchema = z.enum(["admins", "user", "team", "department"]);
const policyMutationSchema = z.object({
  expectedRevision: z.number().int().min(0),
  securityPin: z.string().trim().min(1).max(128),
  enabled: z.boolean(),
  recipientType: alertTypeSchema,
  recipientId: z.string().min(1).max(200).nullable(),
  escalationType: alertTypeSchema,
  escalationId: z.string().min(1).max(200).nullable(),
  acknowledgeMinutes: z.number().int().min(2).max(1440),
  reminderMinutes: z.number().int().min(2).max(1440),
}).strict();
const alertKeySchema = z.enum(SYSTEM_ALERT_KEYS);
const batchPolicyMutationSchema = z.object({
  securityPin: z.string().trim().min(1).max(128),
  policies: z.array(policyMutationSchema.omit({ securityPin: true }).extend({ key: alertKeySchema })).min(1).max(SYSTEM_ALERT_KEYS.length),
}).strict();

const severitySchema = z.enum(["low", "medium", "high", "critical"]);
const statusSchema = z.enum(["open", "investigating", "mitigating", "monitoring", "resolved", "closed"]);
const resourceSchema = z.object({
  kind: z.string().trim().min(1).max(80),
  id: z.string().trim().min(1).max(240),
  label: z.string().trim().max(240).optional().nullable(),
});

const createIncidentSchema = z.object({
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().max(4000).optional().default(""),
  severity: severitySchema.optional().default("medium"),
  ownerUserId: z.string().trim().min(1).max(200).optional().nullable(),
  correlationId: z.string().trim().min(1).max(200).optional().nullable(),
  resources: z.array(resourceSchema).max(50).optional().default([]),
  note: z.string().trim().max(4000).optional().nullable(),
});

const updateIncidentSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  summary: z.string().trim().max(4000).optional(),
  severity: severitySchema.optional(),
  status: statusSchema.optional(),
  ownerUserId: z.string().trim().min(1).max(200).optional().nullable(),
  correlationId: z.string().trim().min(1).max(200).optional().nullable(),
  resources: z.array(resourceSchema).max(50).optional(),
  note: z.string().trim().max(4000).optional().nullable(),
});

const timelineSchema = z.object({
  kind: z.enum(["note", "evidence", "mitigation", "status", "resolution"]).default("note"),
  message: z.string().trim().min(1).max(4000),
  correlationId: z.string().trim().min(1).max(200).optional().nullable(),
});

function incidentMessage(input: { title: string; severity: string; status: string }) {
  return `${input.severity.toUpperCase()} · ${input.status} · ${input.title}`;
}

async function userLabels(prisma: any, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))].slice(0, 250);
  if (!uniqueIds.length) return new Map<string, string>();
  const rows = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, username: true, displayName: true, preferredName: true },
  });
  return new Map<string, string>(rows.map((row: any) => [String(row.id), String(row.displayName || row.preferredName || row.username || row.id)] as [string, string]));
}

function serializeIncident(row: any, labels: Map<string, string>) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary || "",
    severity: row.severity,
    status: row.status,
    ownerUserId: row.ownerUserId || null,
    ownerName: row.ownerUserId ? labels.get(row.ownerUserId) || row.ownerUserId : null,
    correlationId: row.correlationId || null,
    acknowledgedAt: row.acknowledgedAt || null,
    acknowledgedById: row.acknowledgedById || null,
    alertCycle: row.alertCycle || 1,
    openedById: row.openedById || null,
    openedByName: row.openedById ? labels.get(row.openedById) || row.openedById : null,
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt || null,
    closedAt: row.closedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resources: (row.resources || []).map((resource: any) => ({ id: resource.id, kind: resource.kind, resourceId: resource.resourceId, label: resource.label || null, createdAt: resource.createdAt })),
    timeline: (row.timeline || []).map((entry: any) => ({
      id: entry.id,
      kind: entry.kind,
      message: entry.message,
      actorUserId: entry.actorUserId || null,
      actorName: entry.actorUserId ? labels.get(entry.actorUserId) || entry.actorUserId : null,
      correlationId: entry.correlationId || null,
      createdAt: entry.createdAt,
    })),
  };
}

export function registerOperationsIncidentRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const { prisma, requireAdminUserForRequest, logActivity } = deps;

  app.get("/api/admin/operations/alert-policies", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const now = new Date();
    const [configured, adminIds, teams, departments] = await Promise.all([
      prisma.operationsAlertPolicy.findMany({ where: { key: { in: [...SYSTEM_ALERT_KEYS] } }, take: SYSTEM_ALERT_KEYS.length }),
      eligibleAlertAdminIds(prisma, now),
      prisma.studioTeam.findMany({ where: { archived: false }, select: { id: true, name: true }, take: 100, orderBy: { name: "asc" } }),
      prisma.department.findMany({ where: { archived: false }, select: { id: true, name: true }, take: 100, orderBy: { name: "asc" } }),
    ]);
    const users = adminIds.length ? await prisma.user.findMany({ where: { id: { in: adminIds } }, select: {
      id: true, username: true, displayName: true, preferredName: true,
    }, take: 64 }) : [];
    reply.header("Cache-Control", "no-store, private");
    return { ok: true, policies: SYSTEM_ALERT_KEYS.map((key) => configured.find((policy: any) => policy.key === key) || {
      ...defaultAlertPolicy(key), revision: 0,
    }), targets: { users: users.map((user: any) => ({ id: user.id, name: user.displayName || user.preferredName || user.username })), teams, departments } };
  });

  // One PIN protects the entire draft, which commits atomically or not at all.
  app.put("/api/admin/operations/alert-policies", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const body = batchPolicyMutationSchema.parse(request.body || {});
    if (new Set(body.policies.map((item) => item.key)).size !== body.policies.length)
      return reply.code(400).send({ ok: false, code: "OPERATIONS_ALERT_POLICY_DUPLICATE_KEY" });
    for (const policy of body.policies) {
      if (!validateAlertPolicy(policy)) return reply.code(400).send({ ok: false, code: "OPERATIONS_ALERT_POLICY_INVALID" });
      for (const [type, id] of [[policy.recipientType, policy.recipientId], [policy.escalationType, policy.escalationId]]) {
        if (type === "admins") continue;
        const row = type === "user" ? await prisma.user.findUnique({ where: { id }, select: { id: true, archived: true } })
          : type === "team" ? await prisma.studioTeam.findFirst({ where: { id, archived: false }, select: { id: true } })
          : await prisma.department.findFirst({ where: { id, archived: false }, select: { id: true } });
        if (!row || (row as any).archived)
          return reply.code(400).send({ ok: false, code: "OPERATIONS_ALERT_TARGET_NOT_FOUND" });
      }
    }
    // Reject invalid/locked PINs before entering the settings transaction.
    await deps.verifyUserPin(admin, body.securityPin, "apply_server_configuration", request);
    let updated: any[];
    try {
      updated = await commitOperationsAlertPolicyBatch(prisma, body.policies, admin.id);
    } catch (error: any) {
      if (error?.code === "P2002" || error?.message === "OPERATIONS_ALERT_POLICY_CONFLICT")
        return reply.code(409).send({ ok: false, code: "OPERATIONS_ALERT_POLICY_CONFLICT", error: "Alert routing changed while you were editing. Refresh and retry." });
      throw error;
    }
    await deps.logSecurityEvent?.({ event: "operations.alert_policy.update_batch", actorUserId: admin.id,
      result: "SUCCESS", reasonCode: "ADMIN_OPERATIONS_ALERT_POLICY_UPDATE", request, metadata: {
        keys: updated.map((policy: any) => policy.key), revisions: updated.map((policy: any) => policy.revision),
      } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, policies: updated };
  });

  // Inbox acknowledgement is personal. This action acknowledges the incident
  // itself and stops all further automatic reminders for its current cycle.
  app.post("/api/admin/operations/incidents/:incidentId/acknowledge", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const { incidentId } = z.object({ incidentId: z.string().min(1).max(200) }).parse(request.params);
    const now = new Date();
    const outcome = await prisma.$transaction(async (tx: any) => {
      const claim = await tx.operationsIncident.updateMany({ where: {
        id: incidentId, acknowledgedAt: null, status: { in: [...ACTIVE_INCIDENT_STATUSES] },
      }, data: { acknowledgedAt: now, acknowledgedById: admin.id } });
      const incident = await tx.operationsIncident.findUnique({ where: { id: incidentId } });
      if (!incident) return { kind: "missing", incident: null };
      if (claim.count === 1) await tx.operationsIncidentTimeline.create({ data: {
        incidentId, kind: "acknowledgement", message: "Incident response acknowledged by an administrator.", actorUserId: admin.id,
      } });
      return { kind: claim.count === 1 ? "acknowledged" : "unchanged", incident };
    });
    if (outcome.kind === "missing") return reply.code(404).send({ ok: false, code: "OPERATIONS_INCIDENT_NOT_FOUND" });
    if (outcome.kind === "unchanged" && !outcome.incident.acknowledgedAt) return reply.code(409).send({ ok: false, code: "OPERATIONS_INCIDENT_NOT_ACTIVE" });
    if (outcome.kind === "acknowledged") await deps.logSecurityEvent?.({ event: "operations.incident.acknowledge", actorUserId: admin.id,
      result: "SUCCESS", reasonCode: "ADMIN_OPERATIONS_INCIDENT_ACKNOWLEDGE", request, metadata: { incidentId } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, acknowledged: true, incidentId, acknowledgedAt: outcome.incident.acknowledgedAt };
  });

  app.get("/api/admin/operations/incidents", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const query = z.object({
      status: z.string().trim().max(40).optional(),
      severity: z.string().trim().max(40).optional(),
      q: z.string().trim().max(300).optional(),
      limit: z.coerce.number().int().min(1).max(250).default(100),
    }).parse(request.query || {});
    const rows = await prisma.operationsIncident.findMany({
      where: {
        ...(query.status && query.status !== "all" ? { status: query.status } : {}),
        ...(query.severity && query.severity !== "all" ? { severity: query.severity } : {}),
        ...(query.q ? { OR: [
          { title: { contains: query.q, mode: "insensitive" } },
          { summary: { contains: query.q, mode: "insensitive" } },
          { correlationId: { contains: query.q, mode: "insensitive" } },
        ] } : {}),
      },
      include: { resources: { orderBy: { createdAt: "asc" } }, timeline: { orderBy: { createdAt: "desc" }, take: 8 } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: query.limit,
    });
    const labels = await userLabels(prisma, rows.flatMap((row: any) => [row.ownerUserId, row.openedById, ...(row.timeline || []).map((entry: any) => entry.actorUserId)].filter(Boolean)));
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      incidents: rows.map((row: any) => serializeIncident(row, labels)),
      counts: rows.reduce((acc: Record<string, number>, row: any) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {}),
    };
  });

  // Read-only canonical import evidence, requested explicitly by an admin.
  // Do not read the native spool through HTTP or expose its filesystem paths.
  app.get("/api/admin/operations/native-emergency-history", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const records = await prisma.operationsNativeAlertReceipt.findMany({
      orderBy: [{ processedAt: "desc" }, { id: "desc" }], take: 20,
      select: { id: true, code: true, category: true, outcome: true,
        occurredAt: true, processedAt: true, incidentId: true },
    });
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, records };
  });

  app.get("/api/admin/operations/incidents/:incidentId", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const { incidentId } = z.object({ incidentId: z.string().min(1).max(200) }).parse(request.params);
    const row = await prisma.operationsIncident.findUnique({
      where: { id: incidentId },
      include: { resources: { orderBy: { createdAt: "asc" } }, timeline: { orderBy: { createdAt: "asc" }, take: 500 } },
    });
    if (!row) return reply.code(404).send({ ok: false, code: "OPERATIONS_INCIDENT_NOT_FOUND", error: "Incident not found." });
    const labels = await userLabels(prisma, [row.ownerUserId, row.openedById, ...(row.timeline || []).map((entry: any) => entry.actorUserId)].filter(Boolean));
    reply.header("Cache-Control", "no-store");
    return { ok: true, incident: serializeIncident(row, labels) };
  });

  app.post("/api/admin/operations/incidents", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const body = createIncidentSchema.parse(request.body || {});
    const ownerUserId = body.ownerUserId || admin.id;
    if (ownerUserId) {
      const owner = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { id: true } });
      if (!owner) return reply.code(400).send({ ok: false, code: "OPERATIONS_INCIDENT_OWNER_INVALID", error: "Incident owner was not found." });
    }
    const row = await prisma.$transaction(async (tx: any) => {
      const incident = await tx.operationsIncident.create({ data: {
        title: body.title,
        summary: body.summary,
        severity: body.severity,
        status: "open",
        ownerUserId,
        correlationId: body.correlationId || null,
        openedById: admin.id,
      } });
      if (body.resources.length) await tx.operationsIncidentResource.createMany({ data: body.resources.map((resource) => ({ incidentId: incident.id, kind: resource.kind, resourceId: resource.id, label: resource.label || null })), skipDuplicates: true });
      await tx.operationsIncidentTimeline.create({ data: { incidentId: incident.id, kind: "status", message: `Incident opened at ${body.severity} severity.`, actorUserId: admin.id, correlationId: body.correlationId || null } });
      if (body.note) await tx.operationsIncidentTimeline.create({ data: { incidentId: incident.id, kind: "note", message: body.note, actorUserId: admin.id, correlationId: body.correlationId || null } });
      return tx.operationsIncident.findUnique({ where: { id: incident.id }, include: { resources: { orderBy: { createdAt: "asc" } }, timeline: { orderBy: { createdAt: "asc" } } } });
    });
    await logActivity?.({ userId: admin.id, type: "created", entityType: "operations_incident", entityId: row.id, title: "Operations incident opened", message: incidentMessage(row) });
    await deps.logSecurityEvent?.({ event: "operations_incident.create", actorUserId: admin.id, result: "SUCCESS", reasonCode: "ADMIN_OPERATIONS_INCIDENT_CREATE", request, metadata: { incidentId: row.id, severity: row.severity, correlationId: row.correlationId || null } });
    const labels = await userLabels(prisma, [row.ownerUserId, row.openedById, ...(row.timeline || []).map((entry: any) => entry.actorUserId)].filter(Boolean));
    return reply.code(201).send({ ok: true, incident: serializeIncident(row, labels) });
  });

  app.patch("/api/admin/operations/incidents/:incidentId", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const { incidentId } = z.object({ incidentId: z.string().min(1).max(200) }).parse(request.params);
    const body = updateIncidentSchema.parse(request.body || {});
    const existing = await prisma.operationsIncident.findUnique({ where: { id: incidentId } });
    if (!existing) return reply.code(404).send({ ok: false, code: "OPERATIONS_INCIDENT_NOT_FOUND", error: "Incident not found." });
    if (body.ownerUserId) {
      const owner = await prisma.user.findUnique({ where: { id: body.ownerUserId }, select: { id: true } });
      if (!owner) return reply.code(400).send({ ok: false, code: "OPERATIONS_INCIDENT_OWNER_INVALID", error: "Incident owner was not found." });
    }
    const nextStatus = body.status || existing.status;
    const row = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.operationsIncident.update({ where: { id: incidentId }, data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.severity !== undefined ? { severity: body.severity } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.status && ACTIVE_INCIDENT_STATUSES.includes(body.status as any) && ["resolved", "closed"].includes(existing.status)
          ? { acknowledgedAt: null, acknowledgedById: null, alertCycle: { increment: 1 }, openedAt: new Date() } : {}),
        ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
        ...(body.correlationId !== undefined ? { correlationId: body.correlationId } : {}),
        ...(body.status === "resolved" && existing.status !== "resolved" ? { resolvedAt: new Date() } : {}),
        ...(body.status && body.status !== "resolved" && existing.status === "resolved" ? { resolvedAt: null } : {}),
        ...(body.status === "closed" && existing.status !== "closed" ? { closedAt: new Date() } : {}),
        ...(body.status && body.status !== "closed" && existing.status === "closed" ? { closedAt: null } : {}),
      } });
      if (body.resources) {
        await tx.operationsIncidentResource.deleteMany({ where: { incidentId } });
        if (body.resources.length) await tx.operationsIncidentResource.createMany({ data: body.resources.map((resource) => ({ incidentId, kind: resource.kind, resourceId: resource.id, label: resource.label || null })), skipDuplicates: true });
      }
      if (body.status && body.status !== existing.status) await tx.operationsIncidentTimeline.create({ data: { incidentId, kind: "status", message: `Status changed from ${existing.status} to ${body.status}.`, actorUserId: admin.id, correlationId: body.correlationId ?? existing.correlationId ?? null } });
      if (body.severity && body.severity !== existing.severity) await tx.operationsIncidentTimeline.create({ data: { incidentId, kind: "status", message: `Severity changed from ${existing.severity} to ${body.severity}.`, actorUserId: admin.id, correlationId: body.correlationId ?? existing.correlationId ?? null } });
      if (body.note) await tx.operationsIncidentTimeline.create({ data: { incidentId, kind: nextStatus === "resolved" || nextStatus === "closed" ? "resolution" : "note", message: body.note, actorUserId: admin.id, correlationId: body.correlationId ?? existing.correlationId ?? null } });
      return tx.operationsIncident.findUnique({ where: { id: incidentId }, include: { resources: { orderBy: { createdAt: "asc" } }, timeline: { orderBy: { createdAt: "asc" } } } });
    });
    await logActivity?.({ userId: admin.id, type: "updated", entityType: "operations_incident", entityId: incidentId, title: "Operations incident updated", message: incidentMessage(row) });
    await deps.logSecurityEvent?.({ event: "operations_incident.update", actorUserId: admin.id, result: "SUCCESS", reasonCode: "ADMIN_OPERATIONS_INCIDENT_UPDATE", request, metadata: { incidentId, previousStatus: existing.status, status: row.status, severity: row.severity } });
    const labels = await userLabels(prisma, [row.ownerUserId, row.openedById, ...(row.timeline || []).map((entry: any) => entry.actorUserId)].filter(Boolean));
    return { ok: true, incident: serializeIncident(row, labels) };
  });

  app.post("/api/admin/operations/incidents/:incidentId/timeline", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const { incidentId } = z.object({ incidentId: z.string().min(1).max(200) }).parse(request.params);
    const body = timelineSchema.parse(request.body || {});
    const incident = await prisma.operationsIncident.findUnique({ where: { id: incidentId }, select: { id: true, correlationId: true } });
    if (!incident) return reply.code(404).send({ ok: false, code: "OPERATIONS_INCIDENT_NOT_FOUND", error: "Incident not found." });
    const entry = await prisma.operationsIncidentTimeline.create({ data: { incidentId, kind: body.kind, message: body.message, actorUserId: admin.id, correlationId: body.correlationId ?? incident.correlationId ?? null } });
    await prisma.operationsIncident.update({ where: { id: incidentId }, data: { updatedAt: new Date() } });
    await deps.logSecurityEvent?.({ event: "operations_incident.timeline", actorUserId: admin.id, result: "SUCCESS", reasonCode: "ADMIN_OPERATIONS_INCIDENT_TIMELINE", request, metadata: { incidentId, kind: body.kind } });
    return reply.code(201).send({ ok: true, entry });
  });
}
