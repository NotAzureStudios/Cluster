# Cluster v0.546.0 | TD5 P7: PostgreSQL admission and acceptance-runner hardening

**Baseline:** TD5 P6 (`7716e9ed863dc0ef96b26aae77b763b327b5d24a2c2512ba15b7b9c5f3d37bd9`). TD4 remains source-closed. TD5 remains active.

## Implemented source changes

1. **PostgreSQL version contract:** The disposable runtime gate now requires the exact PostgreSQL major declared in `config/toolchain-versions.json` (18), instead of incorrectly accepting PostgreSQL 17 when the actual server startup requires 18+. This removes a false-positive release-certification path. The standalone TD1/TD2 SQL harnesses still support 17/18 for their narrower SQL contract tests; that does not certify full Cluster startup on 17.
2. **Connection budget accounting:** The Prisma database pool may no longer exceed its configured global per-studio budget when `connection_limit` is oversized. Fair-share math allows a viable one-connection pool, rejects impossible combinations of reserved slots and expected API nodes before server startup, and rejects malformed/non-integer limit strings as overrides.
3. **Disposable acceptance exclusivity:** The build/DB gate holds a session-scoped PostgreSQL advisory mutex across all subprocess stages and rejects pre-existing concurrent database sessions. It never mutates a database unless all previous explicit opt-in, identity, emptiness and prerequisite guards pass.
4. **Bounded acceptance subprocesses:** Prisma validation/generation, build, migration deploy/status and TD1/TD2 SQL checks have explicit per-step deadlines. Timed-out or interrupted processes receive process-tree termination (POSIX process group or Windows taskkill fallback). Missing executables and nonzero exit codes cannot be reported as successful certification.
5. **Inherited cleanup regression:** The TD2 upload-retention fixture now correctly expects P5's safe direct-upload evidence journal, never unfenced remote deletion. A new negative case verifies that failure to write evidence preserves the upload session.

## Evidence obtained on the available host

- **54/54 selected TD2, TD4 and TD5 regression scripts passed.** This includes a repaired inherited TD2 fixture and four direct TD4 R76/R62 checks.
- **18/18 new P7 executable tests passed:** 10 connection-budget/PostgreSQL server contract checks, 8 subprocess/runner checks.
- **8/8 inherited P6 gate/redaction tests passed.**
- Active source scan: **1,042 TS/TSX, 110 CSS, 4,502 authored relative imports; 0 syntax/CSS errors; 0 missing authored imports**. Generated Prisma client remains intentionally absent in the lean archive.
- Incomplete TypeScript server semantic comparison: **0 new normalized diagnostic signatures against untouched P6**. Both checkouts produce dependency/generated-client errors and do not constitute a successful compile.
- Reproducible patch and SHA-256 manifest / ZIP integrity independently checked (see integrity report).

## Still blocked / NOT certified

- Pinned Node 24.20.0, reviewed lockfile and `npm ci`, generated Prisma 7.9.1 client, full build, live disposable PostgreSQL 18.6 migration and multiple independent worker-process tests.
- Native Windows Go/Qt lifecycle, NTFS/SMB/NAS/S3 races, restore/recovery and provider-generation fencing.
- Managed garbage collection, tier migration, quarantine and physical destruction stay disabled. P7 does not enable them.

## Next TD5 milestone

Run `npm run techdebt:td5:p7:runtime-gate -- --run` on a **reviewed, isolated machine** with an explicitly acknowledged empty `cluster_td5_cert_*` PostgreSQL 18 database and pinned dependencies. Fix the first real compiler or migration error. Preserve success/failure logs privately. Then add separate-process queue/outbox crash and Windows/SMB acceptance evidence.
