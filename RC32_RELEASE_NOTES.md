# Cluster 1.0.0 RC32 | Navigation and Runtime Performance

**Baseline:** RC31. **Target:** faster repeat navigation and less idle/read request churn, without raising API or authentication quotas.

## Client

- `queryApi` retains per-account, per-path in-flight deduplication and short-lived authorized caching. Stale-while-revalidate background GETs now use a **20-second minimum attempt gap per key**, and do not start in hidden documents.
- Failed/blocked IndexedDB cache reads no longer abort an otherwise healthy network GET. Explicit refresh avoids the unnecessary IndexedDB read.
- `peekApiQuery` provides **synchronous, fresh-only, in-memory snapshots** for instant navigation; command search is excluded because its results require current server authorization. Snapshots never cross account scope.
- Timeline immediately restores a fresh cached view when reopening the same date range and filters. When changing filters, it will not show a different range while fetching. The Timeline query now has a **60-second freshness window and five-minute absolute cache lifetime**.
- Projects, Boards and Whiteboards use longer navigation read freshness (60/30 seconds) and explicitly revalidate on relevant changes, access updates, and connectivity recovery. Unrelated Board/Card activity no longer refetches the Project directory when it is not being viewed.
- Shared visible-refresh hooks coalesce repeated focus/visibility recovery signals with a **12-second per-hook cooldown**, keeping online recovery and explicit refresh available. Rapid application deltas coalesce in a 500ms window.

## Server / database

- A new PostgreSQL index `Card_archived_dueDate_idx` supports the Timeline's global non-archived due-card range query, without changing query results or authorization.
- A new migration `20261111000000_rc32_timeline_due_date_lookup` creates that index. Startup's latest-migration gate and required-index checks are updated accordingly. The migration **has not been applied to a live database here**.
- Authorization remains enforced server-side. No extra global rate-limit increase, privilege cache, or silent permission fallback was introduced.

## Development validation

- Inherited RC source smoke suite: **33/33 passed**.
- RC32 focused cache/backend/navigation assertions: **34/34 passed**.
- RC31 inherited cache/Inventory checks: **27/27 passed**.
- RC30 performance/traffic checks: **26/26 passed**.
- The native Go installer is rebuilt from source and embeds the new revision; ZIP integrity and embedded-hash comparison are verified separately.

## Outstanding before certification

- The full Node 24 / npm dependency-backed TypeScript and web build could not run here. Offline `npm install` failed due to missing registry packages, and the project still has no npm lockfile.
- No live authenticated browser performance measurements, Windows installation, PostgreSQL migration timing, multi-user permission-revocation verification or p95 server query benchmarking have been completed here.
- RC32 is a **development release candidate**, not evidence of production speed or stability.

## Test on Windows

1. Run the RC32 installer normally. The old installation should remain intact if build or migration checks fail.
2. Verify the full renderer and server TypeScript builds complete.
3. Open Timeline, switch to Projects/Boards/Settings, then return. Compare network traffic and time-to-first-content with RC31.
4. Repeat rapid tab switching and widget-heavy Home navigation; inspect rate-limit bucket headers on any remaining 429s.
5. Test actual edits and permission changes with two accounts, ensuring realtime invalidation and authoritative access checks still work.
