import crypto from "node:crypto";
import { redactForLog, redactSensitiveText, sanitizeClientCorrelationId, sanitizeRequestPath } from "./security-observability.js";

export const SECURITY_AUDIT_INTEGRITY_VERSION = 1;
export const SECURITY_AUDIT_GENESIS_HASH = "GENESIS:cluster-security-audit:v1";
export const SECURITY_AUDIT_METADATA_MAX_BYTES = 32 * 1024;

export type SecurityAuditHashRecord = {
  id: string;
  sequence: number;
  integrityVersion: number;
  previousHash: string;
  event: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  workspaceId?: string | null;
  result: string;
  reasonCode: string;
  requestId?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata: string;
  occurredAt: Date | string;
};

function stableValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function stableAuditJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function normalizeSecurityAuditMetadata(value: unknown) {
  const sanitized = redactForLog(value ?? {});
  const serialized = stableAuditJson(sanitized);
  if (Buffer.byteLength(serialized, "utf8") <= SECURITY_AUDIT_METADATA_MAX_BYTES) return serialized;
  return stableAuditJson({
    truncated: true,
    sanitizedSha256: crypto.createHash("sha256").update(serialized).digest("hex"),
    maximumBytes: SECURITY_AUDIT_METADATA_MAX_BYTES,
  });
}

export function normalizeSecurityAuditPath(value: unknown) {
  const path = sanitizeRequestPath(value);
  return path === "/" && !String(value || "").trim() ? null : path;
}

export function normalizeSecurityAuditRecord(input: Record<string, any>) {
  return {
    event: String(input.event || "security.unknown").trim().slice(0, 160) || "security.unknown",
    actorUserId: input.actorUserId ? String(input.actorUserId).slice(0, 200) : null,
    targetUserId: input.targetUserId ? String(input.targetUserId).slice(0, 200) : null,
    workspaceId: input.workspaceId ? String(input.workspaceId).slice(0, 200) : null,
    result: input.result === "FAILURE" ? "FAILURE" : "SUCCESS",
    reasonCode: String(input.reasonCode || "UNSPECIFIED").trim().slice(0, 160) || "UNSPECIFIED",
    requestId: sanitizeClientCorrelationId(input.requestId),
    requestMethod: input.requestMethod ? String(input.requestMethod).trim().toUpperCase().slice(0, 16) : null,
    requestPath: normalizeSecurityAuditPath(input.requestPath),
    sessionId: input.sessionId ? String(input.sessionId).slice(0, 200) : null,
    ipAddress: input.ipAddress ? String(input.ipAddress).trim().slice(0, 128) : null,
    userAgent: input.userAgent ? redactSensitiveText(input.userAgent).slice(0, 500) : null,
    metadata: normalizeSecurityAuditMetadata(input.metadata || {}),
  };
}

export function securityAuditHashPayload(record: SecurityAuditHashRecord) {
  return {
    id: record.id,
    sequence: record.sequence,
    integrityVersion: record.integrityVersion,
    previousHash: record.previousHash,
    event: record.event,
    actorUserId: record.actorUserId || null,
    targetUserId: record.targetUserId || null,
    workspaceId: record.workspaceId || null,
    result: record.result,
    reasonCode: record.reasonCode,
    requestId: record.requestId || null,
    requestMethod: record.requestMethod || null,
    requestPath: record.requestPath || null,
    sessionId: record.sessionId || null,
    ipAddress: record.ipAddress || null,
    userAgent: record.userAgent || null,
    metadata: record.metadata,
    occurredAt: record.occurredAt instanceof Date ? record.occurredAt.toISOString() : new Date(record.occurredAt).toISOString(),
  };
}

export function computeSecurityAuditHash(record: SecurityAuditHashRecord) {
  return crypto.createHash("sha256").update(stableAuditJson(securityAuditHashPayload(record)), "utf8").digest("hex");
}

export function verifySecurityAuditChain(events: Array<SecurityAuditHashRecord & { eventHash?: string | null }>) {
  let expectedSequence = 1;
  let expectedPreviousHash: string | null = null;
  for (const event of events) {
    if (event.integrityVersion !== SECURITY_AUDIT_INTEGRITY_VERSION) {
      return { ok: false, checked: expectedSequence - 1, error: `Unsupported integrity version at sequence ${event.sequence}.` };
    }
    if (event.sequence !== expectedSequence) {
      return { ok: false, checked: expectedSequence - 1, error: `Audit sequence gap: expected ${expectedSequence}, found ${event.sequence}.` };
    }
    if (expectedPreviousHash === null) {
      if (event.previousHash !== SECURITY_AUDIT_GENESIS_HASH) return { ok: false, checked: 0, error: "Audit chain has an invalid genesis anchor." };
    } else if (event.previousHash !== expectedPreviousHash) {
      return { ok: false, checked: expectedSequence - 1, error: `Audit previous-hash mismatch at sequence ${event.sequence}.` };
    }
    const computed = computeSecurityAuditHash(event);
    if (!event.eventHash || computed !== event.eventHash) {
      return { ok: false, checked: expectedSequence - 1, error: `Audit event hash mismatch at sequence ${event.sequence}.` };
    }
    expectedPreviousHash = event.eventHash;
    expectedSequence += 1;
  }
  return {
    ok: true,
    checked: events.length,
    firstSequence: events[0]?.sequence || null,
    lastSequence: events.at(-1)?.sequence || null,
    tipHash: events.at(-1)?.eventHash || null,
    anchor: events[0]?.previousHash || SECURITY_AUDIT_GENESIS_HASH,
  };
}
