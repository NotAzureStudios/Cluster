# Cluster implementation roadmap | revision 71

**Source baseline:** v0.546.0 TD4 R71, derived from verified R70. `TECH_DEBT_MASTER_ROADMAP.md` remains the historical ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` independently owns release acceptance.

## R71 implemented

- Canonical global Command Search scope `source_review` (with review/source aliases), a bounded Project-scoped corpus and incremental refresh, and ranking/index facets for Source Reviews.
- Only reviews belonging to the **actual active Source tab repository** are indexed. Cluster selects that binding by `isPrimary DESC, createdAt ASC`. Secondary/unbound/archived repository reviews are not presented as links that cannot open.
- Per-request, 12-candidate-bounded live admission: compare record identity, Project revision, repository association/revision/archive state, and active primary binding/revision before any indexed title or navigation target can be returned.
- Per-user Source Control tool permission **and** Project authorization are required before result publication, including for privileged users. Existing domain ACL is authoritative, not an indexed grant.
- Renderer Search uses the existing `source_review` Project Source inspector placement; reverse Work Action navigation recognizes all three canonical Source Control kinds without adding an alias route.
- 26 focused tests, 51 selected inherited suites, source scanner, and R70→R71 reproducible patch.

## TD4 remaining blockers; do not mark source-closed

1. **Finite Search/Actions matrix:** verify actual working navigation, authorization and live hydration for Source repositories/commits, Studio Forms/submissions, approvals, application/announcement and automation resources. Do not index a kind without an accessible target.
2. **Durable event owner matrix:** `work.assignment.changed` has wildcard delivery consumers but no dedicated assignment materializer. Adding a real materializer requires historical replay/backfill + checkpoint policy, not a dummy subscriber. Verify provider disable/drain/re-enable across nonconfigurable integrations, too.
3. **Storage:** provider generation fencing and backup retention proof are absent. R63–R68 disposition reviews and quarantine simulation are *not* physical recovery. Keep quarantine execution, destruction, automatic migration and managed-blob GC deletion disabled.
4. **Closure audit:** no-bypass negative authorization, event ordering/replay and actual UI navigation, provider ownership, a finite known-kind matrix and source freeze. Reconcile unimplemented requirements into TD5/TD6 with explicit acceptance criteria rather than silently calling TD4 done.

## Certification remains independent and unverified

Node 24 dependency-backed build, PostgreSQL migration and concurrency, authenticated multi-user browser acceptance, native Windows/Qt, and NAS/SMB/S3 recovery have not been performed by R71's source checks. No new migration/native executable required for R71.
