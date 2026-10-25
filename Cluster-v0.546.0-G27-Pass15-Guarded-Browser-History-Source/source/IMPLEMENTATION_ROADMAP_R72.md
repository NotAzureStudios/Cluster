# Cluster implementation roadmap | revision 72

**Canonical baseline:** v0.546.0 TD4 R72, derived from R71. TD0–TD3 remain source-closed; TD4 remains **open**. Runtime certification is governed separately by `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## R72 delivered

- Indexed *Source commits* through the established global Search engine, reusing `cluster://resource/source_commit/<commitId>/<projectId>` and the authorized Project Source inspector's exact historical-commit loader. No parallel Search/ACL/deep-link framework.
- A repository can belong to multiple Projects. Search placements are keyed by `ProjectId:CommitId`; the canonical resource address contains the real commit ID and its Project scope. Active Project source bindings are selected by `isPrimary DESC, createdAt ASC` and are queried once per Project, not repeated for every commit row.
- Two bounded data reads: active binding projection for a maximum of 750 Project IDs, then up to 3,000 commit records / 3,000 resulting placements during full indexing; Project refresh caps source commits at 1,000. No commits are loaded if no active bindings exist.
- Live admission reruns per-batch bounded Project scope, repository state, commit identity/revision/message/author and current active binding checks before any indexed content is shown. Search authorization requires Source Control tool permission plus Project permission, including for admins.
- Remote source-commit kind/scope, query aliases, UI labels, corpus diagnostics and incremental Project invalidation are integrated. Indexed data omits commit author email and arbitrary metadata.
- 33 new focused checks, inherited R71 regression selection, active TypeScript syntax and authored relative-import validation, and independent R71→R72 patch reconstruction.

## Explicit TD4 source-closeout obligations

1. Source **repositories** are not separately indexed because the current Project Source UI lacks verified per-repository inspector selection. Avoid fake navigation for secondary bindings. Source reviews and commits have authorized, usable targets for the active binding only.
2. Studio Forms/submissions, approvals, applications, announcements and automation resources still need individual owner authorization + a real target, or explicit documented exclusion/transfer to TD6.
3. `work.assignment.changed` is durably published but has no assignment-specific subscriber/materializer. A future materializer requires an exact historical backfill/replay and checkpoint contract. Non-configurable provider lifecycle owners require final disable/drain/re-enable audit.
4. Recoverable quarantine and physical Library disposal are **not implemented or certified**. Provider-generation fencing, backup retention, concurrency and recovery must be proved with live services; R67–R68 deliberately disable unsafe GC, tier promotion and destruction. These are open dependencies, not source-certified capabilities.
5. Perform finite kind/consumer/owner and negative authorization audits, then source-freeze TD4 only once remaining requirements are fulfilled or formally deferred with explicit acceptance criteria.

## Runtime certification remains independent

Node 24 dependency-backed compilation, live PostgreSQL multiworker/migration tests, authenticated multi-user browser/permission behavior, native Windows/Qt and NAS/SMB/S3 recovery are **not** certified by source checks.
