# TD4 R76.2 | Post-commit Library activity boundary correction

**Canonical input:** R76.1, SHA-256 `afb63d3f5c193af840a2ac14238b00db60659d84cc51c76045be1d1f13f5aa30`.

**Closure decision:** TD4 remains **bounded source-closed**. R76.2 is a confirmed defect correction in enabled Library workflows; it does not reopen TD4 feature scope or certify runtime behavior.

## Reproduced contract defect

Three previously existing Library routes treated secondary Activity failure as an API failure **after** the database transaction had committed:

- `POST /api/library/upload` (ordinary Library upload)
- `POST /api/library/:itemId/versions/:versionId/restore` (restore of a historical file version)
- `POST /api/desktop-libraries/from-upload` (mounted Library creation and existing-file replacement)

The route's normal success response and `clearLibraryContextCache()` came after `await logActivity(...)`. If Activity threw, the write remained committed but the client got an error; cache invalidation was skipped and user retry could create a duplicate item/version. This is the same class of post-commit failure as the R76.1 version-upload issue.

## Correction

All three routes now invalidate Library context after committed writes, even when Activity is unavailable. They preserve their committed success responses and warn about failed Activity projection. No physical deletion, migration, GC or quarantine operation was added. Pre-commit database failures still propagate normally. Security/audit authorities remain unchanged. A failed Activity projection can still leave incomplete *human activity history*; this change prevents inconsistent file state and misleading write failure, not a durable Activity outbox feature.

## Source and regression evidence

- **8/8** new executable actual-handler checks: upload / historical restore / mounted file create / mounted version replacement, each with healthy and failing Activity.
- **60/60** inherited TD4 scripts passed: 58 on initial run, two requiring a temporary local TypeScript link in this lean source checkout. That link was removed after testing.
- Source scanner: 1,040 TypeScript/TSX files; 110 CSS; 4,498 authored relative imports; zero syntax, CSS or authored-import errors; generated Prisma-client import expected absent.
- Server TypeScript comparison against R76.1: 2,898 diagnostics each, **zero new normalized signatures** under the incomplete Node 22 + global TS toolchain. This is not a passing Node 24 dependency-backed build.
- ZIP manifest, exact patch replay and checksum verification are recorded in the separate R76.2 integrity report.

## Explicit exclusions

No live PostgreSQL, native Windows/Qt, real NAS/S3, multi-user, or interrupted upload-network runtime tests have been performed. Deferred physical storage reclamation remains disabled. R76.2 is not a substitute for TD5 and release-certification work.
