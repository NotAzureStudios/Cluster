# Operations & Performance Overhaul

Cluster v0.387.0 is Core Product & Architecture Roadmap Step 6 of 7. It combines the work-inbox overhaul, operational observability, enforceable performance budgets, and PostgreSQL/query scalability work into one production-facing boundary.

## Durable work inbox

Notifications are now materialized into `NotificationInboxItem` records rather than reconstructed in the renderer from Activity, Calendar, Timeline, Project, User, Knowledge, and Time requests. Inbox state is durable across Web and Desktop and supports read/unread, snooze, dismiss/restore, priority, category lanes, digest summaries, search, and cursor pagination.

Activity delivery is idempotent per user and activity event. Explicit recipient metadata, card assignment, broadcasts, and bounded `@username` mention resolution can identify recipients. Existing activity history is backfilled as already read so an upgrade does not turn historical events into new unread work.

The shell badge uses `/api/notifications/summary` rather than rebuilding the inbox from multiple product APIs. The full inbox remains authorization-protected and server-backed; renderer filters and per-project notification modes remain user-facing presentation controls rather than security boundaries.

Notification inbox records are included in personal-data inventory/export, privacy erasure, schema verification, and the normal data-retention engine. The default notification retention policy is 180 days, bounded from 30 to 730 days.

## Performance budgets

`performance-budgets.ts` defines explicit pass/warn/fail thresholds for:

- API request p95 and p99 latency
- HTTP server error rate
- event-loop p95 delay
- database query p95 and p99 latency
- PostgreSQL cache-hit ratio
- PostgreSQL index-scan ratio
- active lock waits
- dead-row ratio
- durable dead-letter jobs

A metric with no meaningful sample is `unknown`, not automatically failed. This avoids an idle/new database being declared unhealthy merely because it has not accumulated block or index statistics yet.

The administrator endpoints `/api/admin/operations/health` and `/api/admin/operations/performance` expose budget posture. Budgets are operational defaults and regression signals, not universal capacity guarantees; deployments with materially different hardware or workload should validate them against representative load before changing thresholds.

## Query and PostgreSQL diagnostics

Runtime request telemetry now reports p50/p95/p99 latency at aggregate and route level. Prisma query diagnostics report p50/p95/p99 globally plus bounded route/query groups.

PostgreSQL diagnostics expose:

- connection and lock-wait posture
- cache-hit and index-scan ratios
- live/dead row pressure
- hot user-table statistics
- low-use index statistics
- analyze/autovacuum timestamps
- database size and workload counters
- actionable recommendations for cache, sequential-scan, dead-row, and lock pressure

Step 6 also adds indexes for the durable inbox and common `ActivityEvent` access paths. Query diagnostics are observational; schema changes remain reviewed migrations rather than an automatic index-creation system.

## Admin operations surface

Admin → Operations includes a live Server Performance panel with:

- request and database p95/p99 latency
- cache/index posture
- lock waits
- dead-letter job count
- individual budget status cards
- slow routes
- hot query groups
- table pressure
- database recommendations

The panel is read-only. It does not expose an arbitrary SQL console or automatically mutate PostgreSQL tuning settings.

## API contract

v0.387.0 advances the API contract to `2026-08-02.28` and advertises:

- `work-inbox-v2`
- `operations-observability-v2`
- `performance-budgets-v1`
- `postgresql-scalability-v2`

Notification domain contract is v2, diagnostics v6, database v3, and privacy v6 because self-service export schema v4 now includes notification inbox records.

## Release boundary

Step 6 is release-blocked by `operations-performance-audit.mjs`, source audits, architecture audits, unit/release contracts, schema/index verification, OpenAPI checks, and Cluster Master packaging verification.

This engineering evidence does not replace representative load testing. Production certification still requires the pinned Node toolchain, complete dependency graph, runtime integration/E2E coverage, backup/upgrade drills, desktop smoke testing, and signing gates defined by Cluster's release pipeline.
