# Cluster TD4 R71 → R72 handoff

**Canonical artifact:** `Cluster-v0.546.0-TD4-R71-Source-Review-Search-Integration-Source.zip` (one `source/` root). Patch: `Cluster-v0.546.0-TD4-R70-to-R71.patch` on R70. The historical master roadmap is *not* an R71 status substitute; read `IMPLEMENTATION_ROADMAP_R71.md`.

## Code delivered

- `packages/shared/src/cluster-manifest.ts`: added first-class remote `source_review` search kind.
- `apps/server/src/domains/search/search-repository.ts`: bounded full/Project corpus, Project active binding and repository selection; incremental user corpus kept empty.
- `apps/server/src/domains/search/search-index-builder.ts`: authorized-target-compatible source review results, Project source binding matching and refresh merging.
- `apps/server/src/domains/search/search-live-admission.ts`: fresh review/repository/active-binding/Project checks.
- `apps/server/src/domains/search/search-routes.ts`: Source Control tool and current Project authorization for Search, including privileged sessions.
- `apps/server/src/domains/search/search-query-runtime.ts`, `search-service.ts`: query aliases and diagnostics.
- `packages/renderer/src/features/search/search-ranking.ts` + `features/workflow/work-actions.ts`: UI kind label and canonical reverse navigation.
- New source-review direct tests, source scan, implementation roadmap and this handoff. Schema unchanged.

## Verified checks

See `TD4_R71_TEST_RESULTS.json`, `TD4_R71_SOURCE_SCAN.json`, and `TD4_R71_SOURCE_REVIEW_SEARCH_AUDIT.md`. Selected 51 inherited scripts and 26 new focused checks passed under available Node 22 source test environment. This is **not** Node 24 runtime certification.

## R72 targets in priority order

1. Audit Source Repository/Commit Project-scoped identity. Avoid a single repository ID mapping into multiple Project result rows without a stable placement key. Implement only what the Source tab can actually open and what the server can hydrate/authorize.
2. Audit Form templates/submissions and administrative approval records for concrete, separately authorized Search/Action adapters. Prefer a working end-to-end owner rather than adding unopenable generic kinds.
3. Reconcile event consumer ownership, assignment-specific projection/backfill obligations and non-configurable provider lifecycle. Document finite owner matrix, negative revocation, and drain/re-enable behavior.
4. Keep disabled destructive storage paths disabled. Either implement real provider-generation fencing and recoverable quarantine under live certified tests or explicitly defer physical execution as an open dependency. No mock-only enablement.
5. Complete TD4 closeout checklist and source freeze only after the above contracts are fulfilled or explicitly re-scoped with evidence. TD5/TD6/TD7 and release certification remain distinct.

## Environment requirements

No fresh PostgreSQL migration or native binary changes in R71. Dependency-backed Node 24, live PostgreSQL, multi-user browser, Windows/Qt and NAS/S3 tests remain outstanding. Avoid claiming TD4 or v1.0 certified from source checks.
