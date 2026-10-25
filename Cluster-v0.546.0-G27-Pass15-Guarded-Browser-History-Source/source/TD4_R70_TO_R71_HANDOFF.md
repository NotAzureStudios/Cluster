# Cluster TD4 R70 → R71 handoff

**Canonical source:** `Cluster-v0.546.0-TD4-R70-Live-Search-Resource-Admission-Source.zip`. Extracts to `source/`. Its patch replays on `Cluster-v0.546.0-TD4-R69-Typed-Consumer-Ownership-Source.zip`.

## Source changes

- `apps/server/src/domains/search/search-live-admission.ts`: request-local live record and owning Project freshness checks, 12-candidate admission ceiling, no cached privilege decisions.
- `apps/server/src/domains/search/search-index-builder.ts` and `search-index-types.ts`: Project revision stamp on indexed children.
- `apps/server/src/domains/search/search-routes.ts`: admission before the existing owning permissions.
- `packages/renderer/src/features/search/CommandPalette.tsx` and `use-local-search-worker.ts`: remove online shell-Project authority shadowing, keep an offline-only signed-in local project worker, reject wrong fallback navigation.
- `tools/scripts/cluster-td4-r47-search-route-integration-tests.mjs`: isolated legacy ACL fixture stub for new admission dependency, not softened authorization expectations.
- New R70 executable tests, source scan, npm verify script, audit and roadmap.

## Read first

`TD4_R70_SEARCH_ADMISSION_AND_NAVIGATION_AUDIT.md` states the complete currently indexed kind matrix, runtime caveats, and exact negative coverage. `TD4_R70_TEST_RESULTS.json` lists inherited suite outcomes; `TD4_R70_SOURCE_SCAN.json` contains static checks. `TECH_DEBT_MASTER_ROADMAP.md` and `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` remain their respective authorities.

## R71 priorities

1. Audit remaining finite Search/Action adaptation for **source repositories/reviews/commits, Studio governance, Forms and other mandatory workspaces**, including server-side hydration and wrong-placement, deleted, revoked or disabled-tool cases. Integrate a real owner end to end rather than adding a generic framework.
2. Audit residual event producer/subscriber obligations (especially `work.assignment.changed`) and provider toggle/drain/re-enable behavior. A dedicated new subscriber requires a migration/backfill policy for previously acknowledged events; do not ship a placeholder owner.
3. Preserve the zero-active-production-instance rule: delete proven fossils, but do not add compatibility aliases or rewrite historical migrations.
4. Keep Library physical disposal, managed-blob GC and automatic tier migration disabled until generation-fenced quarantine/backup and actual NAS/S3/PostgreSQL certification.
5. Run dependency-backed Node 24, live PostgreSQL permission/concurrency, authenticated browser and Windows/Qt acceptance on a real environment before making release claims.

## Validation boundaries

Static and mocked source regressions are not native runtime certification. False positives from a stale Search index now fail closed, so monitor temporary missing results and added batched SQL pressure in actual runtime testing.
