# Cluster 0.546.0 | TD6 G26 Library Media Authorization & Cache Closeout

**Parent:** `Cluster-v0.546.0-TD6-G26-Retention-Mutation-Authority-Closeout-Source.zip`.

## Implemented connected fixes

1. **View permission no longer grants thumbnail replacement.** `PUT /api/library/:itemId/model-thumbnail` now requires the canonical `contribute` Library permission. Model thumbnails remain viewable to authorized viewers; copyright-disabled source assets cannot be displayed or overwritten. IDs used in thumbnail filenames must satisfy a bounded safe-name grammar. The server refuses a redirected thumbnail root, and both thumbnail and GLB streaming validate their managed cache paths before returning data.
2. **Independent dependency authorization.** `.blend` preview conversion previously trusted IDs from user-controlled `modelBundle` metadata and loaded every referenced companion without checking that viewer's Library access. The route now reads each dependency with the normal Library authorization projection and fails closed for missing/inaccessible, trashed, archived, Records-governed or restricted companions, rather than silently incorporating their bytes in the derivative. Copyright restrictions apply to the model and all companions. Unauthorized references receive the same generic denial instead of revealing their names.
3. **Revision-aware cached GLBs.** The conversion key is now SHA-256 of the source revision/checksum/stat, ordered companion identities, names, revisions/checksums/stats, source-relative name, converter limit and cache schema. Previously a cached model could still include old content after a linked texture changed. Both on-disk cache filename and ETag use the fingerprint instead of leaking paths or source-only identity.
4. **Managed-path validation.** The Library source resolver now uses the shared `validateManagedDerivativePath` checks for directory redirection/symlink/junction traversal and refuses multi-linked final source files. The GLB and thumbnail return paths are also checked. These are pre-stream safety checks, **not** atomic filesystem snapshots across all conversion reads.
5. **Request admission.** The thumbnail upload cost/body policy was still matching removed `/api/knowledge/:id/model-thumbnail` rather than `/api/library/:id/model-thumbnail`. It now classifies actual writes as bounded heavy work with an 8 MiB body ceiling instead of the generic 2 MiB ceiling. Other API routes keep their prior budgets.

## Validation

- Run `npm run cluster:td6:g26:library-media-authority` for **36 focused assertions**, including pure authorization, revision fingerprints, actual filesystem path redirection, and actual request-admission classification.
- Run `npm run cluster:td6:g26:one-batch` and `npm run cluster:td6:g26:retention-mutation-closeout` for inherited G26 and earlier security validation.
- Native Go helper tests and static analysis remain unchanged and pass.
- The source scan verifies source syntax and imports. This does **not** replace Node 24 full compilation, live PostgreSQL, authenticated multi-user browser tests, Assimp model-conversion tests or Windows/Qt certification.

## Remaining important runtime tests

- A user with view-only access must be unable to `PUT` a model thumbnail while an editor can write and both can read it.
- Give one user access to a `.blend` model but not its texture asset; confirm it cannot obtain the derivative or cached derivative from an earlier admin request. Change and revoke the dependency between requests and repeat.
- Upload a valid model with multiple textures and confirm conversion is correct and cache identity changes on all relevant asset updates.
- Exercise symlink/junction/hardlink races and video/media storage on Windows and NAS. Path verification is not equivalent to pinning an immutable file descriptor during conversion.
- Verify bounded application request concurrency, copyright takedown, model cache repair, and manual thumbnail regeneration.

**G26 remains open** for Native Windows MSI recovery, external credential verification, provider-generation-fenced physical disposition, and Node 24/PostgreSQL 18/browser/Qt certification. No new migrations or native binary changes.
