# TD4 R41 | Library destruction/storage disposition source hardening

**Parent:** TD4 R40. TD3 remains source-closed. TD4 is active. This is source implementation, not a production-certified release.

## Confirmed defect and fix

`DELETE /api/library/:itemId/permanent` previously removed the database record in a Serializable transaction, selected currently unreferenced blob paths there, and then physically `fs.rm`'d them **after commit**. A second writer could attach a new current/version/derivative reference to the same pathname between that check and the unlink. This also made failed post-commit activity logging leave the destructive mutation without authoritative activity evidence.

R41 removes the synchronous unlink list entirely. A successful destruction commits a `destroyed` ActivityEvent in the same transaction as the record deletion. Released bytes remain available for the existing administrator storage-audit workflow. The endpoint returns `storageDisposition: "review_required_no_unlink"` and a released-reference count; no pathname is returned or removed. UI confirmation explicitly says this operation **does not free disk space**. Source evidence cannot be spoofed by a post-commit success/error message.

## New operator candidate recheck

`POST /api/library/storage/orphans/audit/:jobId/review`:

- Requires active authenticated Library edit access and administrator authority.
- Accepts only a pathname that is present in the **sample of a completed** server-side orphan-audit job. Arbitrary paths, old/incomplete jobs and unaudited paths are rejected.
- Re-collects *all* current LibraryItem, LibraryVersion and LibraryDerivative storage references using the bounded, canonical R40 reference collector (not `fileName = literal` aliases alone).
- Checks for queued/running Library jobs; blocks evidence while in-flight work might claim or relocate paths.
- Re-checks the sampled candidate's root containment, all intermediate directory components, symbolic links, file type, size, modification time and minimum seven-day age.
- Reports typed blocking reasons and an explicit `dispositionAllowed: false` in **all** outcomes. No delete/quarantine/rename, and no physical byte changes are exposed through the new API or UI.
- The Library admin UI provides **Recheck evidence** beside each of the up to 40 sampled candidates, with an explanation of the remaining blockers.

## Why disposal is still deliberately open

A current-reference scan cannot prove immutable external delivery provenance, historical retention obligations, legal holds, backup requirements, or atomicity with future writers. Nor can an audit sample become an authenticated deletion capability. Actual automatic cleanup needs a separate write-fenced storage ownership model, retention/provenance decisions, a durable approval/undo/quarantine state machine, and post-deletion audit. **R41 does not claim retention-aware deletion is complete.**

## Validation

`tools/scripts/cluster-td4-r41-disposition-review-tests.mjs` exercises filesystem safety, references appearing after an audit, active jobs, missing/symlink files, stale fingerprints, unsafe paths, transactional activity, server authorization/source contracts, and admin UI. Earlier R40 audit tests and inherited R37–R39, durable Library, TD2, TD3, and older destruction regressions also run.

Missing/uncertified: Full Node 24 dependency-backed build, live PostgreSQL Serializable/concurrency tests, authenticated multi-user/browser UI and Windows/Qt build. R41 includes **no Prisma migration or native executable change**.
