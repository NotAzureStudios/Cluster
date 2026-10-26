import { decodeCursor } from "../../core/cursor-pagination.js";
import { auditActivityQuerySchema, securityEventExportQuerySchema, securityEventQuerySchema } from "@cluster/shared";

export function registerAuditRoutes(deps: any) {
  const { app, authorization, parseJsonObject, auditService, logSecurityEvent } = deps;

  app.get("/api/security/events", async (request: any, reply: any) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const query = securityEventQuerySchema.parse(request.query || {});
    const page = await auditService.securityEvents({ ...query, cursor: decodeCursor(query.cursor) });
    const items = page.items.map((event: any) => ({ ...event, metadata: parseJsonObject(event.metadata) }));
    reply.header("Cache-Control", "no-store");
    if (!query.cursor) { if (page.nextCursor) reply.header("X-Next-Cursor", page.nextCursor); return items; }
    return { ...page, items };
  });

  app.get("/api/security/events/integrity", async (request: any, reply: any) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    return auditService.verifySecurityIntegrity();
  });

  app.get("/api/security/events/export", async (request: any, reply: any) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const query = securityEventExportQuerySchema.parse(request.query || {});
    // A missing/expired PostgreSQL snapshot must never fall back to two
    // unrelated reads or return partially assembled audit evidence.
    reply.header("Cache-Control", "no-store");
    let exported: any;
    try { exported = await auditService.exportSecurity(query, parseJsonObject); }
    catch {
      return reply.code(503).send({ ok: false, code: "SECURITY_AUDIT_SNAPSHOT_UNAVAILABLE" });
    }
    // Security export is a sensitive disclosure: never serve it when durable
    // audit evidence is unavailable. The shared logging facade now returns
    // the underlying persistence acknowledgement, not only telemetry.
    let auditWrite: { ok?: boolean } | undefined;
    try { auditWrite = await logSecurityEvent({
      event: "security.audit_exported",
      actorUserId: admin.id,
      result: "SUCCESS",
      reasonCode: "ADMIN_EXPORT",
      request,
      metadata: { exportedEvents: exported.events.length, exportDigestSha256: exported.exportDigestSha256 },
    }); } catch { /* no export without durable evidence */ }
    if (auditWrite?.ok !== true) {
      reply.header("Cache-Control", "no-store");
      return reply.code(503).send({ ok: false, code: "SECURITY_AUDIT_WRITE_FAILED" });
    }
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Disposition", `attachment; filename="cluster-security-audit-${new Date().toISOString().slice(0, 10)}.json"`);
    reply.header("X-Cluster-Audit-Digest-SHA256", exported.exportDigestSha256);
    return exported;
  });

  app.get("/api/audit/activity", async (request: any, reply: any) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const query = auditActivityQuerySchema.parse(request.query || {});
    const page = await auditService.activityEvents({ ...query, cursor: decodeCursor(query.cursor) });
    const items = page.items.map((event: any) => ({ ...event, metadata: parseJsonObject(event.metadata) }));
    if (!query.cursor) { if (page.nextCursor) reply.header("X-Next-Cursor", page.nextCursor); return items; }
    return { ...page, items };
  });
}
