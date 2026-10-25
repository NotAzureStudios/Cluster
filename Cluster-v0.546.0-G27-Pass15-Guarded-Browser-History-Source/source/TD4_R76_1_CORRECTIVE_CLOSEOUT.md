# Cluster TD4 R76.1 | post-closeout verified Library correction

**Baseline:** the exact R76 archive, SHA-256 `f15250938d3e0df68c716d3b2d4e6d76025e087736d17d7629c136d579b5c978`.

**Decision:** TD4 remains **bounded SOURCE-CLOSED after a reproduced source-level data-integrity regression was repaired**. R76.1 is a correction to the signed-off R76 code, not a new framework, an extension of feature scope, or runtime certification. Use this checkpoint rather than uncorrected R76 for further development.

## Confirmed defect 1: committed Library bytes removed on Activity failure

In `apps/server/src/domains/library/library-routes.ts`, `POST /api/library/:itemId/versions` kept the Prisma version transaction, upload consumption, Activity projection and success response inside a single `try`. The `catch` unconditionally removed `stored.fullPath`.

If the database transaction **committed**, then Activity logging threw, the catch deleted a file already referenced by the current Library item. A retry could also create a second version even though the first commit had succeeded.

**Fix:** The cleanup `catch` now covers only the transaction. Once the version is committed, upload consumption runs without destructive cleanup. A failed secondary Activity projection is logged with the committed item/version and the API returns the committed result instead of a misleading failure. There is no new physical-disposal permission.

## Confirmed defect 2: resumable transfer created ghost Library versions

In `apps/server/src/domains/library/library-9e2-jobs.ts`, conflict policy `version` performed `createLibraryVersionSnapshot(prisma, existing)` and then an independent `libraryItem.update`. A failed or racing update could leave a historical snapshot without the corresponding current-version change.

**Fix:** The worker rereads the current item, checks its revision and lifecycle, and performs snapshot plus revision-guarded update in **one serializable Prisma transaction**. A failed update rolls back both writes; a stale transfer cannot overwrite a concurrent revision. File bytes staged before publication may remain as unreferenced candidates after an aborted transaction; reclamation stays governed and is NOT silently re-enabled.

## Independent regression evidence

- **58/58** inherited R76 TD4 scripts independently passed on the untouched R76 source before correction.
- **60/60** selected scripts passed on the corrected source, including two new dynamic tests exercising real extracted/compiled route and job handlers with controlled database failures.
- **6/6** new targeted executable cases: normal commit, Activity failure after commit, precommit rollback; successful transfer, stale revision denial, transactional update rollback.
- Active-source parsing: **1,040 TypeScript/TSX**, **110 CSS**, **4,498 authored relative imports**, **zero syntax/CSS failures or missing authored imports**.
- Comparison under the available incomplete Node 22/TypeScript 5.8 toolchain: **zero new normalized server TypeScript error signatures versus R76**. Both source trees still have 2,898 dependency/generated-client-related compiler diagnostics, so this is NOT a dependency-backed successful compilation.
- Source package manifest, integrity and replay results are recorded separately in the R76.1 integrity report.

## Unchanged non-claims

No actual PostgreSQL concurrency, migration/bootstrap, Windows/Qt, external Git/Discord, or NAS/S3 provider recovery tests were executed. No permanent Library destruction, quarantining, automatic managed-blob garbage collection or tier migration was enabled. Real provider-generation fencing, storage reclamation/repair and interrupted remote-call acceptance remain TD5 work. Missing end-user destinations remain TD6 work. The independent release-certification roadmap stays open.
