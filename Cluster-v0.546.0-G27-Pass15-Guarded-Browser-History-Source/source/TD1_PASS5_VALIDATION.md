# TD1 Pass 5 Validation — 2026-10-11

**Environment:** Node 22.16.0, lean source; no installed workspace dependencies or generated Prisma artifacts. Full Node 24 build / live PostgreSQL / Windows/Qt runtime **not certified**.

| Verification | Result |
|---|---:|
| New TD1 Tool Config reset assertions | 13/13 |
| TD1 typed definitions | 11/11 |
| TD1 provenance | 6/6 |
| TD1 Settings Authority | 9/9 |
| TD0 source/executable checks | 9/9 |
| TD1P2 scheduler lifecycle | 8/8 |
| TD1/TD2 closeout | 7/7 |
| TD2 durable jobs | 9/9 |
| TD2 Library ownership | 7/7 |
| TD2 subscriptions | 7/7 |
| TD2 upload retention | 9/9 |
| Settings conflict assertions | 11/11 |
| Config writer convergence | 23/23 |
| **Combined targeted + inherited** | **129/129** |
| Tool Registry | Passed: 28 routes, 22 permission identities, 3 standalone modules |
| TypeScript syntax | 990 active TS/TSX files, zero syntax diagnostics |
| Relative import references | 4,201 checked; missing generated Prisma client only |
| Full dependency-backed typecheck | **Not certified** |

**Test quality:** The new 13-case suite executes real Settings service logic against a serialized transactional persistence mock and runs the registered admin reset handler against a lightweight route/Zod stub, including CAS conflict, stored `null`, missing values, forbidden keys, Studio confirmation, authorization, stale cache and UI draft preservation. It **does not** prove real Zod/Fastify integration or PostgreSQL serializable behavior. The other suites remain independently executable. Additional source/manifest and replay verification is performed during packaging.
