# Cluster 0.538 → 0.539 | Library Collections handoff

**Authoritative current archive:** `Cluster-v0.539.zip`, based directly on the complete `Cluster-v0.538.zip`. Previous schema and Windows Go updater are unchanged.

## Specific code changes

- `library-platform-9e2.ts`: server-time rolling-date evaluation, saved-query normalization, media semantic condition and custom sort support.
- `library-collection-pagination.ts` (new): bounded revision-scoped pagination, input validation, stable continuation, typed stale/invalid cursor errors.
- `library-media-filters.ts` (new): single canonical media predicate for both normal Explorer and Smart Collections.
- `library-routes.ts`: now consumes the shared media predicate; behavior preserved.
- `library-9e2-routes.ts`: paginated manual and smart memberships, stable ordering, permission filtering before JSON output, CAS for collection rename/delete.
- `LibraryWorkspacePage.tsx`: incremental collection paging, rolling dates, media/visibility/pinned/exact folder filter capture, reviewed-revision delete, and explicit handling for unsupported recursive descendants.
- `domain-data-fields.ts`: semantic filter definitions for media kind, pinned, visibility, parent folder and custom order.
- `cluster-0539-library-collections-tests.mjs`: executable logic tests for date predicates, media filters, pagination, cursors, revision handling, and UI-route wiring.

## Current limits and next steps

- The pagination cursor guards collection revision, not every underlying Library item write. Changes to items during deep paging may shift results; actual DB testing is deferred.
- Page cursors limit offsets to 100,000 and 250 records per page, avoiding unbounded single responses. There is no cross-page bulk selection yet.
- Smart Collection recursive descendants scope is **not** represented. UI blocks saving it rather than silently returning broader content.
- Shared collections, Library revision diff/restore beyond existing features, broader Work Undo/Redo, People/Admin lifecycle, and optional Desktop automatic update policies remain on the roadmap.
- Avoid another Platform rewrite. Next task: choose an unfinished complete user journey from the feature ledger and implement it across its UI/server boundary.

## Certification

Source-level behavioral and inherited tests passed. A complete dependency-backed build, actual PostgreSQL, Windows/Qt and browser multi-user tests remain deferred at user request.
