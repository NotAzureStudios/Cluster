# Phase 5 performance baseline

Cluster v0.408.0 starts the Performance & Scalability phase with measurable renderer baselines.

## Startup classes

Renderer startup is classified as `cold`, `warm`, or `reload`. Warm startup means a prior Cluster renderer session was observed within 30 minutes. Reports expose DOMContentLoaded, load, first-frame, Web Vital, network, memory, and cache data.

## Render health

The root React Profiler records mount/update/nested-update counts, total actual render time, average commit cost, and maximum commit cost. The existing p95 render budget remains 120 ms.

## Subscription isolation

The application shell no longer subscribes to the complete offline-sync object. It consumes a compact connectivity bitmask, so queue counts, transfer progress, cache health, timestamps, and conflict bookkeeping do not rerender the full application shell. Detailed sync consumers continue using the full store.

## Stable derived state

Sidebar visible, pinned, and ordered project collections are memoized rather than recreated for unrelated sidebar renders.

These baselines are intentionally local and privacy-preserving. Cluster does not upload performance traces automatically.
