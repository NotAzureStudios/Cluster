import crypto from "node:crypto";
import { acquireTransactionAdvisoryLockPair } from "./postgres-advisory-lock.js";
import {
  computeSecurityAuditHash,
  normalizeSecurityAuditRecord,
  SECURITY_AUDIT_GENESIS_HASH,
  SECURITY_AUDIT_INTEGRITY_VERSION,
} from "./security-audit-integrity.js";

const AUDIT_LOCK_KEY_A = 1129070931;
const AUDIT_LOCK_KEY_B = 1096040788;

export async function appendSecurityAuditEvent(transaction: any, input: Record<string, any>) {
  await acquireTransactionAdvisoryLockPair(transaction, AUDIT_LOCK_KEY_A, AUDIT_LOCK_KEY_B);
  const previous = await transaction.securityAuditEvent.findFirst({
    where: { integrityVersion: SECURITY_AUDIT_INTEGRITY_VERSION, sequence: { not: null } },
    orderBy: [{ sequence: "desc" }, { occurredAt: "desc" }],
    select: { sequence: true, eventHash: true },
  });
  const normalized = normalizeSecurityAuditRecord(input);
  const id = crypto.randomUUID();
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date();
  const sequence = Number(previous?.sequence || 0) + 1;
  const previousHash = previous?.eventHash || SECURITY_AUDIT_GENESIS_HASH;
  const hashRecord = {
    id,
    sequence,
    integrityVersion: SECURITY_AUDIT_INTEGRITY_VERSION,
    previousHash,
    ...normalized,
    occurredAt,
  };
  const eventHash = computeSecurityAuditHash(hashRecord);
  return transaction.securityAuditEvent.create({ data: { ...hashRecord, eventHash } });
}
