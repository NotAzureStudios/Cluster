# G26 grouped pass: Security audit integrity coverage and export authority

**Baseline:** `Cluster-v0.546.0-TD6-G26-Atomic-Vault-Audit-Source.zip`.
**Change scope:** Server audit repository, audit service, export route, shared security logger, executable regression tests, offline export verifier. No schema migration, destructive action, native binary replacement, or third-party provider integration.

## Verified source defects and corrections

1. **Integrity coverage gap.** Audit verification previously fetched only `integrityVersion=1`. Any historical, corrupted or manually reclassified event outside that version was omitted and could yield a misleading `ok: true`. The repository now retrieves all audit rows, the validator verifies the v1 chain, and a global `ok` requires zero unsupported/unchained rows. Response includes `totalEvents` and `uncheckedEvents`. A damaged chain and unsupported-version records are both reported when present.
2. **Export digest mismatch.** The v1 export digest covered raw stored metadata strings. The HTTP route then parsed metadata into JSON objects, silently changing the content after hashing. Export v2 now parses the actual event projection *before* calculating SHA-256. The digest covers `stableAuditJson` of the complete response payload **excluding** `exportDigestSha256`, including all metadata objects and export-control fields. A separate offline verifier is provided.
3. **Security-export fail-open.** The shared `logSecurityEvent` facade previously consumed the persisted-audit `ok` result and returned `undefined`. The export handler did not distinguish an audit-write failure from a successful write, and could deliver sensitive logs without a durable export event. The facade now returns the persistence result. The export route returns HTTP 503 and zero export records when audit persistence fails, throws or returns no positive acknowledgement.
4. **Malformed evidence normalization.** Ordinary UI JSON helpers tolerate invalid metadata by substituting `{}`. Exports no longer erase invalid persisted metadata silently; malformed/non-object audit metadata aborts export instead.
5. **Operator verification.** `node tools/scripts/verify-security-audit-export.mjs <export.json>` verifies exported-v2 payload digest with no installed dependencies. It deliberately does **not** prove origin, audit-chain completeness, original data authenticity or the server's current authorization. An attacker able to replace both the export and its self-declared digest cannot be detected with a bare digest; authenticated signatures/external anchors remain future work.

## Verification performed

- New audit integrity/export suite: **15/15** passed, exercising actual transpiled repository, service and route logic plus an independent offline verifier.
- Existing Atomic Vault Audit, reviewed rotation, credential disclosure, key-pool, Vault workspace, retention and provider evidence regressions: passed in grouped run.
- TD5 source closeout: **14/14 scripts, 167/167 cases**.
- TS/TSX and renderer-import source scan: passed; this is **not** a dependency-backed TypeScript compilation.
- Native Go stager: standard tests, race tests, `go vet`, and Windows x64 cross-compilation passed. No native source changes in this pass.
- Source SHA-256 manifest, full ZIP integrity and exact-parent patch replay: recorded in adjacent integrity report.

## Limitations and certification boundary

- **Non-atomic export snapshot:** filtered export rows and global chain verification are read with separate queries; concurrent audit writes may occur between them. The v2 payload explicitly declares `snapshotConsistency: "non-transactional; concurrent writes may occur"` and its global integrity scope. It does not claim a point-in-time PostgreSQL snapshot.
- **Unsupported/legacy rows** now make the global audit integrity report fail rather than silently disappearing. Their existence needs investigation or an explicit audited migration policy; do not automatically rewrite old history.
- **Audit-chain anchoring:** verification cannot detect deletion of the most recent events without a separately retained, trusted chain tip. The digest detects accidental alteration of a downloaded export, not forgery by someone with full control of both JSON and hash.
- A persisted export audit event establishes authorization/evidence prior to responding; it cannot establish successful receipt by a remote browser or device.
- Node 24.20.x, installed pinned dependencies/lockfile, Prisma generation, real PostgreSQL 18, authenticated browsers, Windows MSI/Qt, external provider revocation and physical storage recovery still require provisioned runtime tests. The current environment has Node 22.16.0 and no workspace dependencies.

**G26 remains open.** This closes the audit reporting/export defects at source level, not production certification.
