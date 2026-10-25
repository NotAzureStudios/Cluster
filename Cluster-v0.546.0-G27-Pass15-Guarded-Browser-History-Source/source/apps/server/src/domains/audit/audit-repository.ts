import { cursorWhere } from "../../core/cursor-pagination.js";
import { appendSecurityAuditEvent } from "../../core/security-audit-store.js";

function securityWhere(query: any) {
  const occurredAt: any = {};
  if (query.from) occurredAt.gte = new Date(query.from);
  if (query.to) occurredAt.lte = new Date(query.to);
  return {
    event: query.event || undefined,
    result: query.result || undefined,
    actorUserId: query.actorUserId || undefined,
    targetUserId: query.targetUserId || undefined,
    requestId: query.requestId || undefined,
    ...(Object.keys(occurredAt).length ? { occurredAt } : {}),
  };
}

export function createAuditRepository(prisma: any) {
  return {
    async createSecurity(input: any) {
      return prisma.$transaction((tx: any) => appendSecurityAuditEvent(tx, input));
    },
    securityEvents(query: any) {
      return prisma.securityAuditEvent.findMany({
        where: { ...securityWhere(query), ...(cursorWhere(query.cursor || null, "occurredAt", "desc") || {}) },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        include: {
          actor: { select: { id: true, username: true, displayName: true } },
          target: { select: { id: true, username: true, displayName: true } },
        },
      });
    },
    // A security export must describe one MVCC database snapshot. Individual
    // Prisma reads outside a transaction can observe different chain tips when
    // another request appends an audit record between the two queries.
    securitySnapshotForExport(query: any) {
      return prisma.$transaction(async (tx: any) => {
        const scoped = createAuditRepository(tx);
        // Both statements use the same PostgreSQL REPEATABLE READ snapshot.
        // Do not perform the export's own append inside this read transaction:
        // that append is authorized/audited AFTER this immutable projection.
        const events = await scoped.securityEventsForExport(query);
        const integrityEvents = await scoped.securityIntegrityEvents();
        return { events, integrityEvents };
      }, { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 30_000 });
    },
    securityEventsForExport(query: any) {
      return prisma.securityAuditEvent.findMany({
        where: securityWhere(query),
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: query.limit,
        include: {
          actor: { select: { id: true, username: true, displayName: true } },
          target: { select: { id: true, username: true, displayName: true } },
        },
      });
    },
    securityIntegrityEvents() {
      return prisma.securityAuditEvent.findMany({
        // Include *all* audit records, not only v1 records. Otherwise a
        // corrupted version flag or an unchained record disappears from
        // verification and can produce a false green integrity report.
        orderBy: [{ sequence: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          sequence: true,
          integrityVersion: true,
          previousHash: true,
          eventHash: true,
          event: true,
          actorUserId: true,
          targetUserId: true,
          workspaceId: true,
          result: true,
          reasonCode: true,
          requestId: true,
          requestMethod: true,
          requestPath: true,
          sessionId: true,
          ipAddress: true,
          userAgent: true,
          metadata: true,
          occurredAt: true,
        },
      });
    },
    securityCount() {
      return prisma.securityAuditEvent.count();
    },
    activityEvents(query: any) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.gte = new Date(query.from);
      if (query.to) createdAt.lte = new Date(query.to);
      return prisma.activityEvent.findMany({
        where: {
          type: query.type || undefined,
          entityType: query.entityType || undefined,
          entityId: query.entityId || undefined,
          projectId: query.projectId || undefined,
          userId: query.userId || undefined,
          ...(Object.keys(createdAt).length ? { createdAt } : {}),
          ...(cursorWhere(query.cursor || null, "createdAt", "desc") || {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        include: {
          user: { select: { id: true, username: true, displayName: true } },
          project: { select: { id: true, name: true } },
        },
      });
    },
  };
}
