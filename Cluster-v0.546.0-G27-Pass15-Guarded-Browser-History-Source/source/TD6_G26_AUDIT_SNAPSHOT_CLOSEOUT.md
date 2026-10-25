# G26 grouped closeout: Consistent security export snapshots

**Parent source:** `Cluster-v0.546.0-TD6-G26-Audit-Integrity-Export-Authority-Source.zip`.

## Implemented

1. `createAuditRepository().securitySnapshotForExport()` performs the filtered export read and **unfiltered global integrity read within the same Prisma interactive transaction**. PostgreSQL `REPEATABLE READ` is explicitly requested. The transaction has `maxWait: 5_000` and `timeout: 30_000`; unavailable or timed-out snapshots fail rather than silently downgrading to separate queries.
2. `createAuditService()` evaluates chain integrity against the **same snapshot** used to build the export. Standalone integrity inspection remains a separate single-query endpoint. Unsupported and legacy integrity versions still force a global failure; invalid persisted metadata is still rejected.
3. The existing v2 JSON export and digest semantics remain compatible with the offline verifier. Its snapshot declarations now accurately describe the transactional read. The in-process write-failure counters and `verifiedAt` are observations outside the database snapshot, not MVCC-guaranteed database fields.
4. The route returns a generic `503 SECURITY_AUDIT_SNAPSHOT_UNAVAILABLE`, without event data, a digest header, or a misleading export success audit when the snapshot cannot be obtained. After a **successful** snapshot, a distinct durable `security.audit_exported` append must succeed **before** any export body is released, as in the preceding checkpoint. That append naturally occurs after the captured snapshot and is not claimed to be included in its integrity totals.
5. Added executable snapshot tests that run the transpiled production modules against an MVCC-simulation fixture. Tests inject a concurrent event append between filtered and global reads, corrupt the chain, force transaction rejection, verify the isolation settings and route failure behavior, and recompute the exported digest.

## Verification

- Existing audit integrity/export regression: 15/15 passed.
- New transaction-snapshot regression: 7/7 passed.
- Inherited G26 `one-batch` chain: passed.
- Credential custody and atomic Vault tests: passed.
- TD5 closeout and native Go standard tests: passed.
- Source syntax/import/CSS scanner: passed.
- See adjacent integrity report for exact archive/patch verification.

## Limits and deliberate non-claims

- The simulated MVCC test proves transaction wiring and expected application behavior, **not actual PostgreSQL 18 isolation under load**. Full DB-backed certification still requires a provisioned runtime with Node 24, pinned dependencies, Prisma generation, and concurrent writers.
- `REPEATABLE READ` prevents read skew *among rows read in the transaction*; it does not authenticate exports, protect against database administrators deleting a chain tip, or make the later `security.audit_exported` record part of the earlier snapshot.
- This read must still enumerate the global audit chain and can hit the 30-second transaction bound on a sufficiently large deployment. The safe result is export refusal. Large-scale performance tests and a streaming/snapshot-job design remain future work.
- Exports of a damaged chain remain available for *authorized forensic analysis*, explicitly marked `integrity.ok = false`; their contents are never declared verified. Sensitive plaintext disclosure controls are unchanged.
- No schema migration, provider deletion, external credential revocation, Windows Installer automation, or native binary replacement was introduced.

**G26 remains open for actual runtime and security-provider certification.**
