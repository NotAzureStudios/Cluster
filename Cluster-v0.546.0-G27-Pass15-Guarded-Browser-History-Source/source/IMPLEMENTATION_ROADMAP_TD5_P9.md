# Cluster v0.546.0 | TD5 P9 runtime acceptance output containment

## Baseline and scope

- Canonical source: TD5 P8 (`874f84329314cd8df113dd03c5eec7d71e46b2f73b27bcd6eca2f4069d956187`).
- TD0–TD4 remain source-closed; TD5 is active. The next measurable milestone is dependency-backed Node 24 and live PostgreSQL 18 acceptance, not another source-only green bar.
- This package changes **only the disposable acceptance subprocess supervisor and its regression evidence**. It does not modify database schema, native binaries or product storage execution.

## P9 implemented

1. Mask incomplete known-secret prefixes on child close, timeout and failed process execution, including shorter credential tokens that are prefixes of longer ones. This intentionally over-redacts harmless partial strings to avoid leaking truncated credentials.
2. Apply a combined default 16 MiB raw stdout/stderr budget per stage (up to 128 MiB can be explicitly configured). Count bytes across both streams, and terminate the process tree with a failing outcome when the budget is exceeded.
3. Reject unsafe inherited stdout/stderr (`stdio: inherit`) from the sensitive acceptance helper. The runtime gate uses credential-filtered pipes.
4. Treat output sink failures as failed acceptance stages, including failures while draining buffered output at child close.
5. Add real subprocess tests for incomplete URLs, truncated credentials, timeouts, stdout/stderr flooding, tree termination and sink failures. Preserve P6–P8 regression tests.

## Evidence boundaries

- P9 can run under available Node 22 as a source/runtime-helper test, NOT the pinned product runtime.
- No `package-lock.json`, reviewed dependency tree, Prisma generated client, Node 24.20.0 or PostgreSQL 18 server was available for the full gate.
- `node tools/scripts/cluster-td5-p6-runtime-gate.mjs --json` therefore reports `NOT_PERFORMED`. A refusal is not a certification pass.
- Windows `taskkill`, real Windows/Qt, NTFS/SMB, NAS/S3 and physical storage recovery remain unverified; destructive storage actions remain disabled.

## Mandatory next actions

1. In an isolated controlled test environment restore Node 24.20.0, reviewed lockfile provenance, install via `npm ci`, generate Prisma client, and provision a new empty `cluster_td5_cert_*` PostgreSQL 18 database.
2. Run the P7 gated acceptance command with explicit disposable consent; capture redacted, access-controlled logs and actual build/migration evidence.
3. Resolve authentic compiler, migration or transaction defects. Run competing independent server/worker processes and forced crash/restart tests.
4. Certify Windows Host/launcher/Qt, NTFS/SMB, NAS/S3 provider identity and recoverability before enabling quarantine, tier migration, GC or permanent deletion.
