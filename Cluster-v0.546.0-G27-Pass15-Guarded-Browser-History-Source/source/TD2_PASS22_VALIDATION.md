# TD2 Pass 22 validation — source checkpoint, not runtime certified

**Date:** 2026-10-12. **Baseline:** Cluster v0.546.0 TD2 Pass 21.

| Check | Result |
|---|---|
| Inherited + added TD0–TD2 + tool registry commands | **40/40 PASS** on Node 22.16.0 |
| New bounded exhaustion / contention scenarios | **6/6 PASS** (transaction simulator) |
| New combined certification safety-gate scenarios | **5/5 PASS** |
| Static TypeScript parser audit | **994 TS/TSX, zero syntax diagnostics** |
| Generated Prisma client | Not present in lean source package; unresolved generated import expected |
| Combined certification preflight on this container | Correctly BLOCKED (exit code 2): Node 22, no pg/prisma, no disposable URL/consent |
| Opt-in PostgreSQL 17/18 real claim/capacity/recovery SQL | **NOT EXECUTED** |
| Node 24 full installed-dependency build | **NOT EXECUTED** |
| Windows native host/child-process lifecycle | **NOT EXECUTED** |
| Full-server CPU, SQL, network, p95 queue latency | **NOT MEASURED** |

Machine-readable regression records: `TD2_PASS22_REGRESSION_RESULTS.json`. The independent cleanup simulator is intentionally not presented as a real PostgreSQL throughput measurement. Source manifest and patch reconstruction are validated separately during checkpoint packaging.
