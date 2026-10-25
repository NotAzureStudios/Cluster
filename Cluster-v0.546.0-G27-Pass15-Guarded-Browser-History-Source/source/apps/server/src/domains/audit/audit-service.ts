import crypto from "node:crypto";
import { createAuditRepository } from "./audit-repository.js";
import { appendSecurityAuditEvent } from "../../core/security-audit-store.js";
import { buildCursorPage } from "../../core/cursor-pagination.js";
import { SECURITY_AUDIT_INTEGRITY_VERSION, stableAuditJson, verifySecurityAuditChain } from "../../core/security-audit-integrity.js";

export function createAuditService(deps: any) {
  const repository = createAuditRepository(deps.prisma);
  let writeFailures = 0;
  let lastWriteFailureAt: string | null = null;

  async function recordSecurity(input: any) {
    try {
      await repository.createSecurity(input);
      return { ok: true as const };
    } catch (error) {
      writeFailures += 1;
      lastWriteFailureAt = new Date().toISOString();
      deps.logger.error(error, "security audit domain event failed");
      return { ok: false as const, error: "SECURITY_AUDIT_WRITE_FAILED" };
    }
  }

  // Used by high-assurance mutations that must commit their security evidence
  // in the SAME transaction as the protected state transition. Never swallow an
  // audit failure here: the outer Prisma transaction must roll back.
  async function recordSecurityInTransaction(tx: any, input: any) {
    try {
      await appendSecurityAuditEvent(tx, input);
      return { ok: true as const };
    } catch (error) {
      writeFailures += 1;
      lastWriteFailureAt = new Date().toISOString();
      try { deps.logger.error(error, "transactional security audit event failed"); } catch { /* diagnostics must not replace failure */ }
      throw error;
    }
  }

  function evaluateSecurityIntegrity(events: any[]) {
    // Legacy/unexpected-version events are NOT part of the v1 hash chain.
    // Verification must disclose their existence and refuse a global OK.
    const current = events.filter((event: any) => event.integrityVersion === SECURITY_AUDIT_INTEGRITY_VERSION);
    const uncheckedEvents = events.length - current.length;
    const integrity = verifySecurityAuditChain(current as any);
    return {
      ...integrity,
      ok: integrity.ok && uncheckedEvents === 0,
      ...(uncheckedEvents > 0 ? { error: [integrity.ok ? null : integrity.error,
        `Security audit contains ${uncheckedEvents} unchained or unsupported-version event(s).`].filter(Boolean).join(" ") } : {}),
      totalEvents: events.length,
      uncheckedEvents,
      writeFailures,
      lastWriteFailureAt,
      verifiedAt: new Date().toISOString(),
    };
  }

  async function verifySecurityIntegrity() {
    // Standalone inspection is a point-in-time read; export has a stronger
    // combined snapshot contract implemented in the repository.
    return evaluateSecurityIntegrity(await repository.securityIntegrityEvents());
  }

  async function exportSecurity(query: any, parseMetadata: (value: string) => unknown) {
    if (typeof parseMetadata !== "function") throw new Error("Security audit export requires its response metadata parser.");
    // Fail closed if the database cannot provide an isolated snapshot.
    // The export route must not log success or deliver bytes on this error.
    const { events, integrityEvents } = await repository.securitySnapshotForExport(query);
    const integrity = evaluateSecurityIntegrity(integrityEvents);
    // Digest the *actual JSON response projection* (including parsed metadata),
    // not a different pre-serialization representation of the records.
    const projectedEvents = events.map((event: any) => {
      // Never silently substitute {} for invalid persisted metadata during an
      // evidence export. The normal UI may be tolerant; an audit export cannot.
      const raw = event.metadata;
      let verifiedMetadata: unknown;
      try { verifiedMetadata = JSON.parse(raw); }
      catch { throw new Error("Security audit export contains invalid metadata JSON."); }
      if (!verifiedMetadata || typeof verifiedMetadata !== "object" || Array.isArray(verifiedMetadata)) {
        throw new Error("Security audit export contains non-object metadata.");
      }
      return { ...event, metadata: parseMetadata(raw) };
    });
    const payload = {
      format: "cluster-security-audit-export/v2",
      exportDigestScope: "stableAuditJson(payload without exportDigestSha256)",
      integrityScope: "global-audit-table-at-export-snapshot",
      snapshotConsistency: "PostgreSQL REPEATABLE READ for audit rows; in-process diagnostics sampled after snapshot",
      generatedAt: new Date().toISOString(),
      filters: {
        event: query.event || null,
        result: query.result || null,
        actorUserId: query.actorUserId || null,
        targetUserId: query.targetUserId || null,
        requestId: query.requestId || null,
        from: query.from || null,
        to: query.to || null,
        limit: query.limit,
      },
      integrity,
      events: projectedEvents,
    };
    const canonical = stableAuditJson(payload);
    return {
      ...payload,
      exportDigestSha256: crypto.createHash("sha256").update(canonical, "utf8").digest("hex"),
    };
  }

  return {
    recordSecurity,
    recordSecurityInTransaction,
    verifySecurityIntegrity,
    exportSecurity,
    securityCount: () => repository.securityCount(),
    async securityEvents(query: any) { return buildCursorPage(await repository.securityEvents(query), query.limit, "occurredAt"); },
    async activityEvents(query: any) { return buildCursorPage(await repository.activityEvents(query), query.limit, "createdAt"); },
  };
}
