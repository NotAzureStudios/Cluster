# Cluster TD4 R72 → R73 handoff

**Use `Cluster-v0.546.0-TD4-R72-Source-Commit-Search-Integration-Source.zip` as canonical source.** R72 derives directly from verified R71. The incremental patch is `Cluster-v0.546.0-TD4-R71-to-R72.patch`.

## Delivered

- Source Commit Search is integrated from bounded Project binding + commit corpus through indexing, refreshed admission, Source Control and Project authorization, remote scope, ranking labels and canonical Project Source inspector navigation.
- Shared repositories use Project-specific stable search placements without changing canonical commit IDs. Active binding selection uses the same order as the existing Project Source tab.
- Source Review Search from R71 and prior R57–R70 event/storage hardening remain preserved.
- New executable tests: `npm run techdebt:td4:r72:source-commit`.

## Next work, in priority order

1. Complete the finite governance Search/Action adapter matrix by auditing real Forms/submissions and approvals navigation and per-record ACL. Only register kinds users can actually open.
2. Finish the finite typed-event consumer/provider lifecycle owner inventory, including negative revocation, disable/drain/re-enable and lost subscriber coverage. Do not fake a `work.assignment.changed` subscriber: define backfill/checkpoint semantics first.
3. Explicitly re-scope the currently *disabled* storage disposal/quarantine/migration paths to a safety-gated phase if they cannot receive live provider verification now. Do not re-enable deletion by weakening requirements.
4. TD4 source freeze requires complete source-level contract evidence and a realistic TD5/TD6 transfer list; Node 24, PostgreSQL, native Windows/Qt and NAS/S3 remain separate runtime gates.

## Validation boundaries

Selected inherited R71 suites plus new focused checks, AST syntax and source integrity are development-source evidence. Lean archive omits generated Prisma and `node_modules`; the old R35 collection test needs a temporary local TypeScript resolution. Remove such testing symlinks before packaging.
