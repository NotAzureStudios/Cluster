# Cluster implementation roadmap | revision 43

**Baseline:** v0.546.0 TD4 R43. Historical ledger: `TECH_DEBT_MASTER_ROADMAP.md`. Runtime acceptance: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Status | Next source work |
| --- | --- | --- |
| TD0–TD2 | Core/source closed | Confirmed regressions only |
| TD3 | Source closed (R30) | Preserve UI contracts |
| TD4 | **Active** | Enroll remaining resource providers, typed events, action/search adapters and lifecycle integration; finish safe hierarchy/storage contracts |
| TD5 | Partly built | Native/diagnostic/background implementation |
| TD6 | Major unfinished code | CD-01 through CD-20 workflow completion |
| TD7 | Not started | Canonical-path fossil removal and source freeze |

## Completed TD4 source work

R31–R36: Library collection sharing/selection and bounded durable metadata/lifecycle operations. R37–R39: hierarchy and durable storage reconciliation. R40–R41: read-only orphan audits and safe database-only destruction. R42: fail-closed resource-change read policy and live session checks. **R43:** Board, Whiteboard and Timeline change provider enrollment with canonical identity/project proof and domain permissions; admin Card/Calendar existence/provenance bypass corrected; live SSE authorization failures terminate the stream for safe reconciliation.

## Outstanding TD4 source implementation

1. Expand per-kind providers, shared resource action/search adapters, typed events and subscription consumers. Three enrolled resource kinds do not complete full federation.
2. Complete provider enable/disable/draining and cleanup, avoiding duplicate TD2 job ownership.
3. Finish durable tree-wide moves/lifecycle operations with authorization and revision fences.
4. Implement write-fenced retention/provenance-controlled blob quarantine/disposal; R40–R43 orphan audits still do not delete files.
5. Complete finite source closeout audit. Node24/PostgreSQL/Windows/Qt/multi-user certification remains a separate roadmap.
