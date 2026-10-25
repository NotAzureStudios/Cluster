# TD1 Pass 7 — Validation record

Baseline `Cluster-v0.546.0-TD1-Pass6-Distributed-Settings-Source.zip`; new checkpoint `TD1 Pass 7 Project Calendar Inheritance` (v0.546.0).

## Executed locally

- **130/130** assertion lines passed across all inherited TD0–TD2 / Settings suites, 15 new Project Calendar inheritance checks, and 9 tool registry checks.
- `npm run tool:check`: passed. Existing tool registry still contains 28 routes, 22 permission identities and three standalone module registrations.
- `npm run techdebt:source:static`: passed. Active source: **993 TS/TSX files, zero parser diagnostics**. Only unresolved relative import is the deliberately omitted generated Prisma client.
- New 15-case test suite covers effective Studio fallback, Project write/provenance, revision CAS, concurrent creates, stale updates/deletes, reset and fresh Studio inheritance, invalid stored data, an explicit non-security allowlist, unauthorized admin/API access, Project-not-found, and UI/route wiring.
- The inheritance route harness stubs Zod parsing and Prisma operations for fast source-level checks, not full dependency-backed integration. This distinction is essential.

## Not performed / not certified

- Prisma CLI migration generation/validation with installed dependencies, or live PostgreSQL fresh bootstrap, migration, and multi-admin concurrency.
- Full TypeScript typecheck with generated Prisma client, React types, and Node 24 runtime.
- Windows/Qt renderer test, real browser UX and DPI, cross-process propagation timing, CPU/network resource measurements.
- User/device-scoped overrides and parent locks. Those remain TD1 backlog items; this pass implements Project default-view inheritance only.

## Packaging

Updated source archive, SHA-256 source manifest, ZIP integrity, and patch replay against the exact TD1 Pass 6 baseline are verified as part of final packaging. Native executable and private binary assets are preserved unchanged.
