import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";

const querySchema = z.object({
  stream: z.enum(["operational", "audit", "security"]).default("operational"),
  severity: z.enum(["info", "warning", "error"]).optional(),
  component: z.string().trim().max(120).optional(),
  event: z.string().trim().max(200).optional(),
  resourceKind: z.string().trim().max(120).optional(),
  resourceId: z.string().trim().max(240).optional(),
  operation: z.string().trim().max(240).optional(),
  trace: z.string().trim().max(240).optional(),
  q: z.string().trim().max(400).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

type EvidenceEntry = {
  id: string;
  stream: "operational" | "audit" | "security";
  severity: "info" | "warning" | "error";
  component: string;
  event: string;
  message: string;
  resourceKind: string | null;
  resourceId: string | null;
  operationId: string | null;
  traceId: string | null;
  causationId: string | null;
  occurredAt: Date;
};

function dateWhere(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
}

function componentFromEvent(value: string) {
  const token = String(value || "runtime").split(/[.:/]/)[0]?.trim();
  return token || "runtime";
}

function matches(entry: EvidenceEntry, query: z.infer<typeof querySchema>) {
  if (query.severity && entry.severity !== query.severity) return false;
  if (query.component && !entry.component.toLowerCase().includes(query.component.toLowerCase())) return false;
  if (query.event && !entry.event.toLowerCase().includes(query.event.toLowerCase())) return false;
  if (query.resourceKind && entry.resourceKind !== query.resourceKind) return false;
  if (query.resourceId && entry.resourceId !== query.resourceId) return false;
  if (query.operation && entry.operationId !== query.operation && entry.id !== query.operation) return false;
  if (query.trace && entry.traceId !== query.trace && entry.causationId !== query.trace && entry.operationId !== query.trace) return false;
  if (query.q) {
    const haystack = [entry.component, entry.event, entry.message, entry.resourceKind, entry.resourceId, entry.operationId, entry.traceId, entry.causationId].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(query.q.toLowerCase())) return false;
  }
  return true;
}

function serialize(entry: EvidenceEntry) {
  return { ...entry, occurredAt: entry.occurredAt.toISOString() };
}

export function registerOperationsEvidenceRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const { prisma, requireAdminUserForRequest } = deps;

  app.get("/api/admin/operations/evidence", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const query = querySchema.parse(request.query || {});
    const occurredAt = dateWhere(query.from, query.to);
    const take = Math.min(500, Math.max(query.limit * 3, 100));
    let entries: EvidenceEntry[] = [];

    if (query.stream === "operational") {
      const [events, receipts] = await Promise.all([
        prisma.domainEventOutbox.findMany({
          where: {
            ...(occurredAt ? { occurredAt } : {}),
            ...(query.event ? { type: { contains: query.event, mode: "insensitive" } } : {}),
            ...(query.resourceKind ? { resourceKind: query.resourceKind } : {}),
            ...(query.resourceId ? { resourceId: query.resourceId } : {}),
            ...((query.trace || query.operation) ? { OR: [
              { correlationId: query.trace || query.operation },
              { causationId: query.trace || query.operation },
              { id: query.operation || query.trace },
            ] } : {}),
          },
          select: { id: true, type: true, resourceKind: true, resourceId: true, correlationId: true, causationId: true, attempts: true, lastError: true, occurredAt: true, processedAt: true, deadLetteredAt: true },
          orderBy: { occurredAt: "desc" },
          take,
        }),
        prisma.apiMutationReceipt.findMany({
          where: {
            ...(occurredAt ? { createdAt: occurredAt } : {}),
            ...((query.trace || query.operation) ? { correlationId: query.trace || query.operation } : {}),
          },
          select: { id: true, method: true, path: true, correlationId: true, state: true, statusCode: true, requestId: true, createdAt: true, completedAt: true },
          orderBy: { createdAt: "desc" },
          take,
        }),
      ]);
      entries = [
        ...events.map((row: any): EvidenceEntry => ({
          id: `event:${row.id}`,
          stream: "operational",
          severity: row.deadLetteredAt || row.lastError ? "error" : Number(row.attempts || 0) > 0 ? "warning" : "info",
          component: componentFromEvent(row.type),
          event: row.type,
          message: row.deadLetteredAt ? "Domain event entered the dead-letter state." : row.lastError ? "Domain event processing reported an error." : row.processedAt ? "Domain event processed." : "Domain event pending processing.",
          resourceKind: row.resourceKind || null,
          resourceId: row.resourceId || null,
          operationId: row.correlationId || null,
          traceId: row.correlationId || null,
          causationId: row.causationId || null,
          occurredAt: row.occurredAt,
        })),
        ...receipts.map((row: any): EvidenceEntry => {
          const failed = row.state === "failed" || Number(row.statusCode || 0) >= 400;
          return {
            id: `request:${row.id}`,
            stream: "operational",
            severity: failed ? "error" : row.state === "processing" ? "warning" : "info",
            component: "api",
            event: `${String(row.method || "REQUEST").toUpperCase()} ${row.path || "unknown"}`,
            message: failed ? "Mutation request failed." : row.state === "processing" ? "Mutation request is still processing." : `Mutation request completed${row.statusCode ? ` with HTTP ${row.statusCode}` : ""}.`,
            resourceKind: "api_request",
            resourceId: row.requestId || row.id,
            operationId: row.correlationId || null,
            traceId: row.correlationId || null,
            causationId: null,
            occurredAt: row.completedAt || row.createdAt,
          };
        }),
      ];
    } else if (query.stream === "audit") {
      const [activity, persistence] = await Promise.all([
        prisma.activityEvent.findMany({
          where: {
            ...(occurredAt ? { createdAt: occurredAt } : {}),
            ...(query.event ? { type: { contains: query.event, mode: "insensitive" } } : {}),
            ...(query.resourceKind ? { entityType: query.resourceKind } : {}),
            ...(query.resourceId ? { entityId: query.resourceId } : {}),
          },
          select: { id: true, type: true, entityType: true, entityId: true, title: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take,
        }),
        prisma.persistenceAuditLog.findMany({
          where: {
            ...(occurredAt ? { createdAt: occurredAt } : {}),
            ...(query.event ? { action: { contains: query.event, mode: "insensitive" } } : {}),
            ...(query.resourceKind ? { kind: query.resourceKind } : {}),
            ...(query.resourceId ? { recordId: query.resourceId } : {}),
          },
          select: { id: true, recordId: true, kind: true, action: true, summary: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take,
        }),
      ]);
      entries = [
        ...activity.map((row: any): EvidenceEntry => ({ id: `activity:${row.id}`, stream: "audit", severity: "info", component: row.entityType || "activity", event: row.type, message: row.title || "Activity recorded.", resourceKind: row.entityType || null, resourceId: row.entityId || null, operationId: null, traceId: null, causationId: null, occurredAt: row.createdAt })),
        ...persistence.map((row: any): EvidenceEntry => ({ id: `persistence:${row.id}`, stream: "audit", severity: "info", component: "persistence", event: row.action, message: row.summary || "Persistence audit event recorded.", resourceKind: row.kind || null, resourceId: row.recordId || null, operationId: null, traceId: null, causationId: null, occurredAt: row.createdAt })),
      ];
    } else {
      const rows = await prisma.securityAuditEvent.findMany({
        where: {
          ...(occurredAt ? { occurredAt } : {}),
          ...(query.event ? { event: { contains: query.event, mode: "insensitive" } } : {}),
        },
        select: { id: true, event: true, result: true, reasonCode: true, requestId: true, requestMethod: true, requestPath: true, targetUserId: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
        take,
      });
      entries = rows.map((row: any): EvidenceEntry => ({
        id: `security:${row.id}`,
        stream: "security",
        severity: String(row.result || "").toUpperCase() === "FAILURE" ? "error" : /warn|deny|blocked/i.test(String(row.reasonCode || "")) ? "warning" : "info",
        component: "security",
        event: row.event,
        message: `${row.reasonCode || "SECURITY_EVENT"}${row.requestMethod && row.requestPath ? ` · ${row.requestMethod} ${row.requestPath}` : ""}`,
        resourceKind: row.targetUserId ? "user" : row.requestId ? "request" : null,
        resourceId: row.targetUserId || row.requestId || null,
        operationId: null,
        traceId: row.requestId || null,
        causationId: null,
        occurredAt: row.occurredAt,
      }));
    }

    const filtered = entries.filter((entry) => matches(entry, query)).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, query.limit);
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      stream: query.stream,
      filters: { severity: query.severity || null, component: query.component || null, event: query.event || null, resourceKind: query.resourceKind || null, resourceId: query.resourceId || null, operation: query.operation || null, trace: query.trace || null, from: query.from || null, to: query.to || null, q: query.q || null },
      entries: filtered.map(serialize),
      redaction: {
        rawPayloads: false,
        responseBodies: false,
        requestBodies: false,
        ipAddresses: false,
        userAgents: false,
        arbitraryMetadata: false,
        secretValues: false,
      },
    };
  });
}
