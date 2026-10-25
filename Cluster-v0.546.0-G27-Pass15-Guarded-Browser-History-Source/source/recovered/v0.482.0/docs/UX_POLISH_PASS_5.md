# Cluster v0.394.0 — UX polish pass 5

UX polish pass 5 standardizes asynchronous loading, failure, empty, refresh, and recovery behavior across Cluster's primary workspaces. The goal is to keep useful stale data visible when refreshes fail, expose actionable server error references, and prevent indefinite text-only loading states.

## Shared request-state contract

`components/RequestState.tsx` provides shared request error, empty, and status primitives. API-backed failures use `apiErrorPresentation()` so the interface can consistently expose the Cluster error code, request ID, API contract version, retry guidance, validation issues, and an explicit retry action without leaking raw server payloads.

The renderer API boundary now normalizes `ClusterApiClientError` into the renderer-owned `ApiError`. Network failures, timeouts, backpressure, malformed responses, and server errors therefore retain retryability and request metadata all the way to the UI.

## Loading consistency

Lazy feature boundaries now use the structural skeleton system instead of a text-only loading panel. Account Settings, My Work, Timeline, Calendar reminders, Project Control, Notifications, Activity, and Server Performance use the shared skeleton primitives on first load.

## Refresh and stale-data recovery

Notifications, Activity, My Work, Timeline, Calendar reminders, Server Performance, and the sidebar server-health monitor preserve the last successfully loaded snapshot when a later refresh fails. Failures render as compact recovery surfaces beside the stale data instead of clearing the workspace.

The sidebar health monitor also distinguishes browser/device-offline state from server failure, prevents overlapping health checks, keeps the last successful health snapshot visible, and reports consecutive failures plus the last healthy check when available.

## Release-blocking boundary

`tools/scripts/ux-polish-pass-five-audit.mjs` verifies the shared request-state primitive, transport-error normalization, structural lazy loading, major workspace recovery paths, server-health stale-data behavior, API capability, documentation, and packaging. Pass 5 also preserves the pass 3 raw-color ratchet and pass 4 semantic-interaction boundary.
