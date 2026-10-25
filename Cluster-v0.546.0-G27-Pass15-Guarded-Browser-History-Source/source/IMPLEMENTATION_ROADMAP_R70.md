# Cluster implementation roadmap | revision 70

**Source baseline:** v0.546.0 TD4 R70, continuing from R69. Historical technical debt remains governed by `TECH_DEBT_MASTER_ROADMAP.md`; runtime acceptance is separately tracked by `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## R70 source delivery

1. Added bounded, permission-neutral **live Search record admission** for the current indexed domains before returning indexed titles, secondary metadata or navigation targets.
2. Project and nested resource scope/version fencing, including a Project-revision stamp in the Search index. Missing, archived, moved, stale or mismatched results are suppressed.
3. Retained existing strict Library, personnel Records, Packet audience, Policy audience, Calendar visibility and authorization checks; no new permission registry.
4. Stopped non-navigable results from redirecting to unrelated Projects. Server-authorized Project matches are authoritative online. Explicit local Project lookup remains offline-only with a conditional worker.
5. Executable negative tests, updated inherited Search fixture, selected regression suite, implementation matrix, package script, reproducible patch and source manifest.

## TD4 still open before source closeout

1. **Resource and action adapters:** Search does not index every canonical resource kind. Audit source-review/commit/repository discovery, Studio Forms, approvals and automation consumers; implement actual cross-system operations with domain-owned authorization and navigation hydration, not registration-only stubs.
2. **Provider/event ownership:** Confirm finite domain producer/subscriber matrix and drain/re-enable semantics for non-configurable providers; an assignment-specific consumer requires historical durable backfill rather than a no-op owner.
3. **Library physical disposition:** R63–R68 governance and evidence remain simulation/inspection-only; provider generation fencing, backup proofs, recoverable quarantine and real failure recovery are still required before re-enabling any physical delete/migrate/GC.
4. **TD4 closure audit:** Evidence-backed no-bypass negative authorization, lifecycle/permission revocation, dependent workspaces, owner matrix and source freeze handoff.

## Certification exclusion

No Node 24 dependency-backed build, live PostgreSQL concurrency, authenticated multi-user Search performance, Windows/Qt protocol activation or NAS/SMB/S3 recovery certification has been performed for this checkpoint. Source-closed TD0–TD3 remain untouched. TD5/TD6/TD7 and final release certification remain independent workstreams.
