# TD2 Pass 21 validation record

- Date: 2026-10-12
- Baseline: Cluster v0.546.0 TD2 Pass 20
- Changes: two-stage workspace-scoped claim admission, new contention tests, expanded PostgreSQL certification harness
- Runtime: Node 22.16.0 (NOT Node 24)
- **38/38** local regression, static audit, simulated contention and tool-registry commands passed; full machine-readable log: `TD2_PASS21_REGRESSION_RESULTS.json`.
- **8/8** new workspace-claim simulator cases passed and **12/12** additional repeat executions passed.
- TypeScript syntax audit: **994 TS/TSX**, **zero parser diagnostics**. Expected unresolved relative import of omitted generated Prisma client.
- PostgreSQL 17/18 live database tests: **NOT EXECUTED** (server and `pg` dependency not available). Consent rejection gate returned status 2 as designed; script syntax check passed.
- Node 24 full build/Windows/native process tests/production throughput: **NOT EXECUTED**.
- Final manifest, ZIP and patch replay: see package verification in handoff and tool execution transcript.

No Prisma migrations or native executable changes. The two-query admission safety path adds PostgreSQL load; SQL/query efficiency must be measured before release.
