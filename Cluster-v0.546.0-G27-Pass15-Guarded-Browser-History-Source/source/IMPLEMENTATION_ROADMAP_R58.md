# Cluster implementation roadmap | revision 58

**Source baseline:** v0.546.0 TD4 R58, extending verified R57. Authoritative historical technical debt remains `TECH_DEBT_MASTER_ROADMAP.md`; independent runtime certification remains `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Next direction |
| --- | --- | --- |
| TD0–TD2 | Source-closed | Preserve existing contracts |
| TD3 | Source-closed (R30) | Preserve UI/Qt behaviors; native acceptance separate |
| TD4 | **Active (R58)** | Finish provider/event ownership, shared Search/Action adapter coverage and Library hierarchy/disposal |
| TD5 | Partly implemented | Dependent native/platform features |
| TD6 | Major backlog | CD-01–CD-20 including Forms and studio integrations |
| TD7 | Not started | Canonical cleanup and freeze after source convergence |

## R58 delivered

- Authenticated, Project-permission-checked repository revision to Source Commit resolution for previously parsed native Git links.
- Deterministic rejection of ambiguous SHA prefixes and multiple authorized Project placements; no unauthorized record discovery.
- Pending native commit intent survives signed-out shell without leaking data or triggering protected requests; one newer intent wins across resource/revision links.
- Exact older Source Commit and Source Review hydration scoped to the primary Project repository; review serialization reused from the owning service.
- Project-scoped `source_review` canonical URIs and user-facing Copy link actions in Commit/Review panels; correct inspector focus.
- Project Source state request-generation fencing on Project switches.
- Focused route/handoff regression tests, 25 inherited suites, active source scan, patch/source integrity evidence packaged.

## Required before TD4 source closure

1. **Typed events:** audit all remaining real producers/subscribers and their ownership, durable retry, ordering, backpressure, permission revocation, and cleanup.
2. **Search/Action adapters:** finish remaining mandatory workspaces and full target hydration/verification without misleading route guesses, especially secondary Source repository selection.
3. **Provider lifecycle:** disable/drain/re-enable for non-TD2 providers, subscriber and job cleanup, and source-level lifecycle matrix.
4. **Library hierarchy:** bounded, durable, recoverable hierarchy-wide bulk moves/mutations, with crash and concurrency evidence.
5. **File disposal:** retention, legal holds, restore grace, audit evidence, and authorized idempotent physical deletion.
6. **Source TD4 closeout audit:** exact owner/kind/consumer matrix, negative permissions, source regression evidence and no duplicate frameworks.

**Certification exclusions:** fresh Node 24 dependency-backed build, live PostgreSQL concurrency/authorization, native Qt Windows protocol activation, actual multi-user/browser/desktop click-through, and OS process certification remain open; do not convert this source pass into a runtime release claim.
