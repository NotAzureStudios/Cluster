# Cluster implementation roadmap | active TD4 view | revision 41

Baseline: v0.546.0 TD4 R41. Comprehensive history in `TECH_DEBT_MASTER_ROADMAP.md`; source certification separately in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | State | Source exit |
|---|---|---|
| TD0 | Core closed | Confirmed regressions only |
| TD1–TD2 | Source-closed | Preserve Settings/tool and durable-job owners |
| TD3 | Source-closed (R30) | Preserve shared UI, native Qt and Appearance contracts |
| TD4 | **Active** | Canonical resources/actions/search adapters, typed provider events, lifecycles, safe Library storage/disposition and large hierarchy jobs |
| TD5 | Partial | Native/background/diagnostics implementation as consumers require |
| TD6 | Major mandatory backlog | CD-01–CD-20 finished workflows |
| TD7 | Not started | Canonical-path fossil removal and source freeze |

## Source-delivered TD4 workflow slices

R31–R33: Collection sharing, permission-filtered matching selection, Manual/Smart Collection matching. R34–R36: durable metadata/collection and file-only archive/unarchive jobs. R37–R39: transaction-safe hierarchy changes and durable storage reconciliation. R40: read-only orphan candidate inventory. **R41:** permanently destroyed Library records no longer race an unprotected post-commit file unlink; activity evidence is transactional; authorized audit candidates have live, read-only evidence recheck.

## Next required cohesive work

1. Design and implement write-fenced, retention-governed orphan **disposition**, with explicit immutable ownership/provenance, approvals, durable checkpointed quarantine and verified cleanup. Do not turn the R40/R41 read-only sample into direct deletion authority.
2. Deliver large hierarchy-wide durable moves and lifecycle operations (ACLs, descendants, locks, revisions, progress, cancellation and filesystem reconciliation).
3. Finish shared resource/action/search provider enrollment, typed events, ownership lifecycles, and TD4 source exit audit.
4. Continue TD5/TD6 only alongside integrated consumer workflows; leave Windows/Postgres/Qt runtime acceptance to release certification.

**Source status:** R41 is complete only for the implemented safety/recheck slice. TD4 stays open. No invented overall source-completion percentage.
