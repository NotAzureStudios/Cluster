# Cluster TD5 P9 → P10 continuation

**Canonical source:** `Cluster-v0.546.0-TD5-P9-Acceptance-Output-Containment-Source.zip` and its P8→P9 patch. TD4 stays source-closed; TD5 remains active.

## P9 delivered

- Known-secret partial-prefix masking on child failure/timeout; cross-channel combined output cap; kill entire process tree on overflow; fail-closed sink errors; deny inherited stdout/stderr in sensitive acceptance runner.
- P9 new real subprocess checks, P6/P7/P8 inherited acceptance checks, wider TD4/TD5 scripts, active-source scan, source manifest and patch replay.
- No storage deletion enablement, schema migration, native executable or provisioned database changes.

## P10 priorities (do actual runtime acceptance)

1. On a controlled test machine obtain **verified Node 24.20.0**, reviewed `package-lock.json` from the canonical lockfile owner, and PostgreSQL 18.x. Do **not** generate a guessed lockfile or certify this lean archive by running plain `npm install` and trusting newly resolved versions.
2. Restore dependencies with `npm ci`, run the credential-safe disposable acceptance gate, capture full build and Prisma migration results. Use a **new empty** `cluster_td5_cert_*` database with explicit `TD5_CERT_DISPOSABLE=I_UNDERSTAND` and private `TD5_CERT_DATABASE_URL`. Never aim at production.
3. Run 2+ independent server/worker processes against the disposable server, including competing claims, crash before/after transaction commit, outbox replay, storage queue recovery and shutdown under load. Fix only observed defects and add executable tests.
4. Perform separate Windows Host/launcher/Qt and NTFS/SMB/NAS/S3 acceptance; do not enable managed-object GC, tier migration, quarantine or physical deletion until provider fencing and restore invariants are proven.

**Caution:** Source tests on Node 22 do not establish Node 24 compilation or PostgreSQL/Windows correctness. Keep this boundary in every status report.
