# Cluster Phase 9 — Perceived Performance

Phase 9 reduces avoidable blanking, reload churn, and lost context while keeping Cluster's existing server-authoritative data model. The product should remain useful while a refresh is in flight, but stale content must be clearly bounded and mutations must roll back when the server rejects them.

## Product contract

### 1. Existing useful content wins over replacement spinners

A refresh of the same logical view should keep the current rows visible whenever those rows are still a valid representation of that view. Initial loads and materially different queries may still use blocking skeletons so Cluster does not show results for the wrong filter, project, folder, or week.

Library uses this distinction explicitly: a new Library query receives a structural loading state, while same-query refreshes retain the current result set and expose a non-blocking `Refreshing` state.

My Work, Notification Inbox, and Scheduler explicit refreshes keep existing content available. Scheduler week/project changes remain blocking because showing a previous week's schedule under a new date heading would be fast but incorrect.

### 2. Skeletons should resemble the content they replace

Cluster's canonical list and card-grid skeletons are preferred over feature-local animated placeholder blobs. Library now selects a list-shaped or grid-shaped loading surface based on the active layout.

Skeleton motion continues to honor `prefers-reduced-motion`.

### 3. Stale-while-revalidate uses the existing authenticated query cache

Phase 9 does not add a second client cache. Read prefetch and Library workspace reads use `queryApi`, which already provides:

- memory cache deduplication
- durable profile-scoped read cache
- stale/fresh bounds
- stale-while-revalidate
- network-failure fallback to unexpired durable data
- mutation-driven invalidation
- performance cache metrics

Cached data never broadens authorization; the server remains authoritative for every network read and the cache remains scoped by the authenticated offline scope.

### 4. Navigation prefetch warms code and safe read data

Navigation intent schedules idle prefetch rather than performing synchronous work on every pointer movement. Prefetch may warm route code plus bounded, read-only data for high-frequency destinations such as Projects, Tickets, Activity, People, My Work, Library, Calendar, and Settings.

Data prefetch is skipped while the browser reports offline. Prefetch never uses mutation endpoints and never bypasses normal API authorization.

### 5. Scroll context survives routine navigation

The Phase 9 scroll helper stores only a bounded numeric `scrollTop` value in session storage. It does not persist record content, query results, or filesystem information.

Tickets and Library use persisted virtual-scroll positions; Notification Inbox keeps a separate position per lane/group/search context. Virtual windows clamp restored positions against the current result count so an old position cannot render an empty viewport after the collection shrinks.

### 6. Selection is preserved only when still valid

Same-query Library refreshes retain selected IDs that still exist in the refreshed result. A materially different query clears selection. Notification refreshes prune selected IDs that no longer exist.

This prevents background refresh from destroying active work without allowing stale selections to target records that are no longer present.

### 7. Optimistic mutations require targeted rollback

Optimism is reserved for operations whose local result is deterministic and safely reversible. Notification read/unread state now updates immediately, then rolls back only the affected records and unread-count delta if the server rejects the mutation.

Destructive or structurally ambiguous changes should continue to wait for server confirmation unless they have an equally precise rollback/undo contract. Existing offline mutation safety and conflict policy remain authoritative.

### 8. Virtualization remains bounded and deterministic

Phase 9 reuses the existing Ticket and Library windowing implementations instead of introducing another virtualization library. Restored scroll positions feed the same fixed-height window math and are clamped to the current collection height.

## Trust and privacy boundary

Phase 9 does **not** add:

- background mutation prefetch
- cross-user cache sharing
- persisted response bodies outside Cluster's existing offline read cache
- persistent scroll history beyond the current browser/session storage scope
- speculative authorization
- generic service-worker mutation replay
- optimistic destructive writes without rollback
- analytics uploads of scroll position or refresh behavior

The server API contract remains `2026-08-02.62`.

## Release-blocking boundary

`tools/scripts/perceived-performance-phase9-audit.mjs` blocks release packaging if non-blocking refresh behavior, structural Library skeletons, query-cache adoption, safe navigation prefetch, scroll restoration, selection preservation, optimistic notification rollback, virtualization clamping, documentation, or package integration regress.

Capability: `perceived-performance-phase9-v1`
