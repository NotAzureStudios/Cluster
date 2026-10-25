# Cluster TD4 R65 → R66 continuation handoff

## Canonical baseline

`Cluster-v0.546.0-TD4-R65-Related-Storage-Authority-Source.zip`, folder `source/`. Preserve the R57–R64 code, migrations and finite owner matrix. TD0–TD3 source-closed, TD4 active. **Never claim release certification from lean source tests.**

## Implemented

- New `library-disposition-related-authority.ts`: bounded filtered SQL correlations for known Library content hashes against managed blobs and uploads; separately scans immutable Packet releases and counts detached derivatives. Intentionally always refuses quarantine/physical deletion.
- Extended `library-disposition-ownership.ts`: integrates related evidence/fingerprint/blockers and detects changed historical version/derivative pointers and root content digest.
- `library-routes.ts`: incomplete related match limits map to HTTP 409 as with the original bounded owner scan.
- `LibraryGovernancePanel.tsx`: admin-only related storage evidence in the existing read-only inspector.
- New executable and integration tests, updated source scan and source manifest; no schema migration or native executable changes.

## Priority for R66

Build actual independent *decision* authority before mutation: two distinct qualified administrators (requester cannot approve), explicitly versioned evidence snapshots, append-only decision records, revocation/cancellation, revision and retention/hold rechecks. Keep approvals separate from execution, and physical mutation disabled. Then design provider-aware staged quarantine journal and restore protocol. **Do not reuse the SQL scan fingerprint as a deletion permit.** Explore the existing `ManagedBlob` GC path separately to ensure its claim/move/delete semantics cannot be mistaken for Library disposition authority.

## Maintain exclusions

No automatic orphan deletion. No provider-neutral filesystem quarantine. No S3/NAS mutation until provider generation fencing, backup retention, active upload and managed blob leases, race-safe revalidation, crash recovery and tested full restore exist. Run actual PostgreSQL/Windows/Node24 certification separately, not just source tests. Continue finite typed-event/Search/Action owner audits after disposal safety work.
