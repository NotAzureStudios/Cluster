# Cluster implementation roadmap | revision 57

**Source baseline:** v0.546.0 TD4 R57, continuing exactly from verified R56. The historical technical-debt ledger remains `TECH_DEBT_MASTER_ROADMAP.md`; runtime certification is separately governed by `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Current direction |
| --- | --- | --- |
| TD0–TD2 | Source-closed | Preserve; address only demonstrated defects |
| TD3 | Source-closed (R30) | Preserve core UI/Qt contracts; native acceptance remains separate |
| TD4 | **Active (R57)** | Complete resource adapters, event producer/consumer integration, remaining provider lifecycles and Library durability/disposal |
| TD5 | Partly built | Native/platform feature implementations required by dependent workflows |
| TD6 | Major backlog | CD-01–CD-20, especially forms and studio feature integration |
| TD7 | Not started | Final canonical cleanup and source freeze after convergence |

## R57 delivered

- Canonical stable, bounded, permission-neutral `cluster://resource/...` URIs with Project scope and Card Board placement.
- Shared parser and renderer-owned resource navigation wiring for native Qt/QML deep-link dispatch, optional desktop bridge, and login-time pending intent.
- Full Work Action copy-link and Search Card navigation integration; non-navigable resource kinds rejected rather than routed to the wrong page.
- 15 focused executable checks and 25 inherited development suites; source scan and exact R56→R57 patch reproduction included in this checkpoint.

## Required before TD4 source implementation closure

1. **Typed events:** audit remaining real domain producers/subscribers for ownership, durable retry, ordering, backpressure, permission revocation and lifecycle.
2. **Search / Action adapters:** complete mandatory workspaces not yet mapped; ensure Project/Board/resource hydration and deep-link target verification, with source-review Git revision lookup specifically unresolved.
3. **Provider lifecycle:** finish ownership, disable/drain/re-enable, and subscriber cleanup for producers outside the six TD2-configurable tools.
4. **Library hierarchy:** implement safe, bounded, durable hierarchy-wide bulk mutations and crash recovery.
5. **Governed file disposal:** introduce retention policy, legal hold, evidence, restore window, then idempotent and authorized physical removal (not immediate unlink).
6. **TD4 closure audit:** finite kind/consumer owner matrix, negative authorization tests, no duplicate generic framework and updated regression evidence.

**Release-certification exclusions:** Node 24 dependency-backed build, live multi-process PostgreSQL, native Qt/Windows protocol activation and multi-user acceptance remain unverified; do not treat source tests as those results.
