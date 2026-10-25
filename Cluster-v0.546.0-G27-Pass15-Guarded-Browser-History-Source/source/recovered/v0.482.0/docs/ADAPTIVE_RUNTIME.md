# Adaptive Runtime Architecture

Cluster v0.275 replaces fixed background polling with runtime decisions based on actual work and application state.

## Client synchronization coordinator

The web client maintains one synchronization timer. Its next run is derived from:

- browser connectivity and server reachability
- pending, failed, and conflicting mutations
- recent remote activity
- document visibility and window focus
- data-saver mode and effective connection type
- consecutive synchronization failures

Pending local changes receive the shortest delay. Hidden windows and idle sessions use a slower cadence. Server outages use exponential recovery backoff capped at two minutes. Browser online, focus, visibility, queue, and cross-window events can reschedule the coordinator immediately.

The coordinator still uses the Web Locks API so only one open Cluster window flushes the outbox and advances delta cursors. Other windows observe IndexedDB and BroadcastChannel changes.

## Storage change routing

Offline storage events now include an area classification: response cache, mutations, drafts, metadata, scope, or all. The sync runtime only scans the outbox when mutation or scope state changed. This prevents normal stale-while-revalidate cache writes from causing repeated IndexedDB mutation reads.

## Readiness probes

The server readiness probe is cached for one second and shared across concurrent callers. A slow database check returns a bounded timeout response while the original probe continues in one in-flight slot. This avoids turning health monitoring into avoidable database contention.

## Runtime telemetry

The server records bounded samples rather than unbounded request history. Diagnostics include:

- total, failed, slow, and in-flight requests
- average, p95, and maximum latency
- event-loop delay
- process memory use
- normalized high-cost routes without high-cardinality resource identifiers

Public health returns aggregate process metrics. Detailed route metrics remain in the administrator-only diagnostics response.

## Adaptive background work

Infrastructure jobs use recursive non-overlapping schedules. Successful jobs return to their base interval. Failed jobs back off exponentially up to a task-specific maximum. Small scheduling jitter prevents several maintenance jobs from repeatedly starting at the same instant.
