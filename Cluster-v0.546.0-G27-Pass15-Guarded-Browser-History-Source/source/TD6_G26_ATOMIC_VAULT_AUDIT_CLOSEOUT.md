# Cluster v0.546.0 | G26 Vault state / audit transaction boundary

## Baseline and scope

Parent source: `Cluster-v0.546.0-TD6-G26-Credential-Disclosure-Audit-Custody-Source.zip`.

This grouped pass fixes a failure mode in **Vault writes**, not just reads. Before this change, standalone Vault credential creation, metadata update, revocation, and all three independently reviewed rotation transitions committed their state change first and then invoked a general-purpose security logger. `logSecurityEvent` can acknowledge logging failures without throwing. Consequently a changed/revoked secret or approved rotation could exist without matching security audit evidence.

## Implemented production code

1. `createAuditService` exposes `recordSecurityInTransaction(tx, input)`, which appends to the existing chained PostgreSQL security audit using the caller's Prisma transaction. It **does not** open a second transaction and **throws** when the write fails, even if diagnostic logging itself fails. The previous best-effort `recordSecurity` contract remains available for non-mutation use.
2. Standalone Vault create, metadata update and revoke now execute their mutation and its audit append in **one Prisma transaction**. Failed, missing, or unconfirmed transactional audit writes fail closed (HTTP 503 `VAULT_AUDIT_UNAVAILABLE`) and roll back the Vault mutation. Stale revisions and Inventory-bound secrets continue to reject unsupported lifecycle changes. Metadata/revoke recheck binding with the Vault row locked inside the transaction.
3. Independent Vault rotation request, second-admin approve/reject, and final requester commit all append their audit inside their existing approval/credential transaction. There is no post-commit security log that can silently fail. Audits contain review IDs and actor/action metadata, **never the submitted replacement credential**.
4. The canonical `cluster:td6:g26:one-batch` regression script now includes `cluster:td6:g26:atomic-vault-audit`. Older Vault test fixtures use transaction and rollback semantics instead of interpreting direct nontransactional writes as current behavior.

## Failure boundaries and limitations

- An audit write after an in-transaction mutation is still atomic because its failure causes the transaction to roll back. This uses Cluster's existing advisory-locked, tamper-evident security audit chain.
- The new audit event is evidence the **database state change committed**, not verification of any external provider revocation or credential rotation.
- This pass does not authorize an unattended MSI retry, a credential reveal without persisted audit, or physical storage disposal.
- Live PostgreSQL 18 transaction/advisory-lock contention, full Node 24 dependency-backed compilation, provisioned Windows MSI/Qt runtime, and authenticated browser acceptance remain **unverified**. The test harnesses model DB rollback; they are not a replacement for PostgreSQL concurrency tests.

## Development verification

- `npm run cluster:td6:g26:atomic-vault-audit`: **27/27** handler and audit adapter checks (15 standalone + 12 reviewed rotation).
- `npm run cluster:td6:g26:credential-disclosure`: **15/15** reveal checks, **44/44** key-pool checks, **18/18** Vault workspace checks.
- `npm run techdebt:td5:source-closeout`: **167** inherited cases pass.
- `node tools/scripts/cluster-td6-source-scan.mjs`: zero syntax/import/CSS findings in the scanned source.
- Native Go stager standard tests pass (native code unchanged).
- The full combined G26 command was attempted but exceeded the execution window; therefore it is **not** reported as a complete pass. The relevant suites listed above were separately rerun and passed.
