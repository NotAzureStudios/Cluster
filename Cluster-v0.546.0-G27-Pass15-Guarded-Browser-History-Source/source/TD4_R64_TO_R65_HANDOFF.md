# Cluster TD4 R64 → R65 continuation handoff

## Source baseline

Use `Cluster-v0.546.0-TD4-R64-Storage-Ownership-Inspection-Source.zip` folder `source/` as the canonical source. R63's disposition ledger and migration remain intact. TD0–TD3 source-closed; TD4 active. No Node24/PostgreSQL/Windows runtime certification.

## R64 changed

- `apps/server/src/domains/library/library-disposition-ownership.ts` (new): strict read-only local pointer scanner, keyset owner lookup, bounded/cancel-admission checks, freshness and filesystem guards, SHA evidence fingerprint, permanent no-disposal blockers.
- `apps/server/src/domains/library/library-routes.ts`: admin+manage, private/no-store ownership endpoint, missing/incomplete handling and capability in disposition overview.
- `packages/renderer/src/features/library/LibraryGovernancePanel.tsx`: admin-only inspect action, evidence display, stale async result protection.
- Two R64 test scripts, source scan, test script entry, roadmap and this handoff. No Prisma schema changes or binaries modified.

## Preserve

- R63 immutable disposition requests/evidence, 30-day restore window, legal hold, denied immediate destruction and cancellation on restore.
- R61/R62 durable hierarchy move/archive/trash/restore and provenance; R59/R60 outbox ordering and lifecycle ownership.
- No automatic orphan deletion. Inspector output and storage paths are administrative only.

## R65 priority

The read-only scan cannot justify quarantine yet. Build a provider ownership/generation inventory that can validate local/NAS/object locators and immutable Packet derivative references, plus active upload/managed blob/backup evidence. Define an explicit fail-closed capability contract and staged quarantine journal with two-person authorization and recoverability. Physical unlink must stay disabled until certified NAS, multi-process PostgreSQL crash/retry and actual restore tests.

Continue the TD4 owner matrix and remaining Search/Action adapters once the storage protocol is designed. Do not add another generic job/event framework.

## Verification

`npm run techdebt:td4:r64:verify` runs the new scripts; `TD4_R64_REGRESSION_RESULTS.json` records inherited suites. The lean package may require globally installed TypeScript/PostCSS and Node22 `--experimental-strip-types` for historical tests. For official sign-off, require pinned Node 24 dependencies, Prisma generation/migrations, live PostgreSQL and Windows/Qt/NAS acceptance separately. Inspect the new scanner with actual external-provider ownership before extending it.
