# Cluster implementation roadmap | revision 45

**Baseline:** v0.546.0 TD4 R45. Historical ledger: `TECH_DEBT_MASTER_ROADMAP.md`. Release certification: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source implementation state | Next boundary |
| --- | --- | --- |
| TD0–TD2 | Closed | Demonstrable regressions only |
| TD3 | Closed at R30 | Preserve native, interaction and Appearance contracts |
| TD4 | **Active** | Provider coverage and shared adapters; deferred Library tree/storage safety |
| TD5 | Partial | Complete native/background/diagnostic consumers |
| TD6 | Major unfinished source backlog | Mandatory CD-01–CD-20 workflows |
| TD7 | Not started | Cleanup only after canonical replacements |

## New verified R45 source work

1. Enrolled Studio Forms, Form submissions, public Applications and Packets in the authoritative Resource Change provider snapshot. Existence, audience, respondent ownership, Studio reviewer permission and Packet/Library access are resolved independently of the event envelope.
2. Studio audience context now supports **strict** reads for change-feed security. Transient membership query failures no longer become an empty context that accidentally authorizes an exclusion audience. Existing non-stream UI behavior remains unchanged.
3. Added cross-boundary route/provider tests, fixed inherited provider test mocks, and preserved R42–R44 history.
4. No schema migration, altered outbox format, UI appearance change or native executable change.

## Remaining TD4 completion gates

- Remaining resource providers: Source Control repository/review/commit bindings, People visibility, other governance-sensitive resources; remove generic authorization only after equivalent canonical providers exist.
- Typed event producer contracts and consumer invalidations; action/search provider adapters; tool enable/disable/draining hooks with TD2 owner policy.
- Durable hierarchy-wide moves and lifecycle jobs with current membership, locks, revision/folder protection and transactional checkpoints.
- Retention/provenance-fenced blob quarantine and disposal; read-only orphan evidence is not authority to delete.
- Source closeout audit. Full Node 24 builds, real PostgreSQL, Windows/Qt and authenticated multi-user testing are certification, not TD4 source implementation gates.
