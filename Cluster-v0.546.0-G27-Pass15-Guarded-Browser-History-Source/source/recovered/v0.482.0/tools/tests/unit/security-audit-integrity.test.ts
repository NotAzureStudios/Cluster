import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSecurityAuditHash,
  normalizeSecurityAuditMetadata,
  SECURITY_AUDIT_GENESIS_HASH,
  SECURITY_AUDIT_INTEGRITY_VERSION,
  verifySecurityAuditChain,
} from "../../../apps/server/src/core/security-audit-integrity.js";

function event(sequence: number, previousHash: string, overrides: Record<string, any> = {}) {
  const record: any = {
    id: `event-${sequence}`,
    sequence,
    integrityVersion: SECURITY_AUDIT_INTEGRITY_VERSION,
    previousHash,
    event: "admin.test",
    actorUserId: "user-1",
    targetUserId: null,
    workspaceId: "workspace-1",
    result: "SUCCESS",
    reasonCode: "TEST",
    requestId: `request-${sequence}`,
    requestMethod: "POST",
    requestPath: "/api/admin/test",
    sessionId: "session-1",
    ipAddress: "127.0.0.1",
    userAgent: "Cluster Test",
    metadata: normalizeSecurityAuditMetadata({ sequence }),
    occurredAt: new Date(`2026-08-12T0${sequence}:00:00.000Z`),
    ...overrides,
  };
  record.eventHash = computeSecurityAuditHash(record);
  return record;
}

test("security audit hash chain verifies ordered append-only records", () => {
  const first = event(1, SECURITY_AUDIT_GENESIS_HASH);
  const second = event(2, first.eventHash);
  const result = verifySecurityAuditChain([first, second], 4);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 2);
  assert.equal(result.legacyCount, 4);
  assert.equal(result.tipHash, second.eventHash);
});

test("security audit chain detects tampered event content", () => {
  const first = event(1, "LEGACY:old-event");
  const second = event(2, first.eventHash);
  second.requestPath = "/api/admin/tampered";
  const result = verifySecurityAuditChain([first, second], 1);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /hash mismatch/i);
});

test("security audit chain detects deleted/reordered records", () => {
  const first = event(1, SECURITY_AUDIT_GENESIS_HASH);
  const third = event(3, first.eventHash);
  const result = verifySecurityAuditChain([first, third]);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /sequence gap/i);
});

test("security audit metadata is redacted before persistence", () => {
  const metadata = normalizeSecurityAuditMetadata({ token: "secret-value", nested: { password: "hunter2", safe: "kept" } });
  const parsed = JSON.parse(metadata);
  assert.equal(parsed.token, "[REDACTED]");
  assert.equal(parsed.nested.password, "[REDACTED]");
  assert.equal(parsed.nested.safe, "kept");
  assert.doesNotMatch(metadata, /secret-value|hunter2/);
});
