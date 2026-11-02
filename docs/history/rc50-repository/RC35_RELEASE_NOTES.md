# Cluster 1.0 RC35 | Performance & release-closeout source checkpoint

**Status:** development source only; **not** a Windows-certified installer or production release. Based on `Cluster-RC34-Visual-First-Development-Source.zip`. Preserves the RC29–RC34 Inventory, caching, graphs, Transfer Center, and visual-first changes.

## Correctness and performance changes

| Area | Actual source change | Expected effect (not yet measured on Windows) |
|---|---|---|
| Session scope | `setOfflineScope` no longer broadcasts an unchanged account on every `/api/me` response | Less repeated IndexedDB queue hydration and unnecessary offline sync wakeups |
| Board/Whiteboard offline queue | Queue subscribers now react only to mutation, account scope or full-storage changes, not every cached API response | Less local I/O on widget-heavy pages and normal navigation |
| Durable cache write pruning | Group expensive `getAll()` cleanup scans: no more full scan after each cached API write; 30-second / 16-write triggering with one scan in flight | Less IndexedDB contention during loading |
| Cache invalidation | Multiple prefix/tag invalidations in the same tick are combined per account into one disk invalidation scan | Fewer large IndexedDB transactions after mutations and realtime events |
| Cache race | An invalidation advances a scope-local epoch; older pending writes cannot persist old data after invalidation | Avoids stale cached results being restored by delayed storage writes |
| Native Desktop caching | If the bridge lacks optional `offlineCacheRemoveMany`, invalidation deletes keys individually through the supported `offlineCacheRemove` method | Restores invalidation in Desktop bridge implementations without bulk-delete support |
| API cancellations | Caller-initiated `AbortError` is no longer converted into a misleading server timeout; actual GET timeout now reports the longer configured read allowance | Fewer spurious timeout messages after navigating away |
| Server rate limiter | Expired-bucket scans are periodic (15 s) once large; individual keys still expire on access and map remains bounded by hard cap | Avoids O(number-of-clients) work per API request once the limiter is busy |

No data model changes, new API endpoints, background polling, migrations, authentication bypasses, rate-limit increases, or native binary replacements.

## Tests executed on source checkpoint

- Inherited release-candidate smoke: **33/33**.
- RC30 performance: **26/26**.
- RC31 regression: **27/27**.
- RC32 navigation/cache: **34/34**.
- RC33 transfer telemetry: **10/10**, plus graph/cache tests.
- RC34 visual-metric checks: passed.
- G27 cross-tab offline storage: **14/14**.
- New RC35 release-closeout behavior regressions: **7/7** (scope events, Desktop single-delete, stale Desktop writes, combined invalidations, abort cancellation, limiter bounds, collaboration subscription).
- TypeScript/TSX source audit: **1,191 files**, **0 syntax errors**; **4,894** relative imports checked with **0 authored paths missing**. One expected generated Prisma import is not present until `db:generate`.
- Full-source and incremental archives: byte-for-byte overlay replay and ZIP integrity verified separately.

## Unverified release blockers

1. **Full TypeScript compilation:** Node.js 24.20 and the workspace dependencies are not available here; npm registry DNS lookup fails. `ts.createSourceFile` is not a substitute for `tsc --noEmit` or a full build.
2. **Dependency lock:** `package-lock.json` is still missing. The release is not reproducible until a lockfile is generated on a correctly provisioned build machine, committed to the source and validated with `npm ci`.
3. **Prisma/PostgreSQL:** Client generation, real migrations, fresh database setup, authorization and recovery have not been certified on a live PostgreSQL 18 server.
4. **Native Windows:** The installer, Go 1.27.1 native launchers, end-to-end transfers, server restart/restore, UI scaling and interactive multi-tab performance have not been tested here.
5. **Performance before/after:** No live P50/P95 navigation, API request count, database pressure, Web Vitals, transfer throughput or 429 telemetry captured; do not claim a measured speedup.

See `RC35_WINDOWS_CERTIFICATION.md` for the exact acceptance commands and tests. Do **not** replace installed Cluster files with this source ZIP.
