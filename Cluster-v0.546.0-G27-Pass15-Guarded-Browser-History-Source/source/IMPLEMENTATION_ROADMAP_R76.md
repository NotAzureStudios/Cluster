# Cluster implementation roadmap | revision 76

**Baseline:** Cluster v0.546.0 TD4 R76, derived exclusively from R75. This roadmap governs *source implementation*. `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` separately governs real-environment release acceptance.

| Phase | Source state | Next responsibility |
|---|---|---|
| TD0–TD3 | Source-closed | Preserve previously implemented contracts |
| **TD4** | **SOURCE-CLOSED (R76 bounded canonical contracts)** | Reopen only for a reproduced regression; see `TD4_R76_SOURCE_CLOSEOUT.md` and final owner matrix |
| TD5 | Partially implemented | Native/runtime/provider generation-safe mutation and recovery; explicitly held storage features |
| TD6 | Major implementation backlog | Actual remaining studio workflows and previously excluded exact resource destinations |
| TD7 | Not started | Fossil cleanup and source freeze after TD5/TD6 canonical convergence |

## R76 source implementation

1. **Safe durable outbox drain:** timeout can no longer silently pass the shutdown barrier while a consumer is still processing. The timeout is bounded (default 10 seconds; injectable only through the runtime construction options for tests). Failure preserves subscribers and propagates rather than allowing premature webhook unregistration.
2. **Explicit assignment consumer policy:** `work.assignment.changed` is a signal-only event using the three wildcard consumers. No assignment-specific state materializer or historical replay registration was added.
3. **Regression closeout:** 58 TD4 script files tested, including one repaired pre-R62 Library fixture; 11 new focused checks, active source parsing, CSS parsing, and import resolution. All passing in the development test environment.
4. **Finite ownership and transfer evidence:** TD4 R76 closeout decision, owner matrix, and TD5/TD6 handoff. Existing resource/navigation/authorization and provider safeguards remain in effect.

## Do not reinterpret the closure

Actual physical quarantine, deletion, managed GC and automatic tier migration are **still disabled**. Source-governed preview/approval/simulation is not storage execution. Full Node 24 dependency-backed TypeScript/Prisma compilation, multiworker PostgreSQL, authenticated browser/Qt and NAS/S3 certification were **not performed** in this development checkpoint.
