# Cluster v0.546.0 — F4 P4 Maintenance Preflight

Parent: F4 P3 Maintenance-Mode Control-Plane Fence. Source-only integration; no Windows or PostgreSQL 18 live certification.

- New `operations-maintenance-preflight.ts`: strict bounded evaluation of dependency freshness, server mode, drain state, scheduled work, durable running jobs and heavy/critical in-flight requests. Missing evidence blocks readiness instead of defaulting to idle.
- New admin-only, no-store `GET /api/admin/operations/maintenance/preflight?intent=` for `enter-maintenance`, `enter-read-only`, `restart`, or `update`. Uses only existing local database/storage probes, the existing task registry, job-count query, and in-memory request counters. Independent probe exceptions are represented as missing evidence, not healthy signals.
- Server Config → Maintenance adds an on-demand, four-intent preflight view and actionable blockers. No new polling worker, no implicit restart, no PIN required for read-only inspection.
- 114 new focused assertions. Existing runtime-request fence unchanged.

**Not implemented by this pass:** operator-initiated drain or mode switch, runtime restart, persisted/scheduled maintenance windows, pre-upgrade checkpoint execution, pause/resume of external workers, automatic update/rollback. Even `ok: true` means *only* that this point-in-time sampled evidence has no listed blockers. The native Windows supervisor must recheck under its own exclusive drain/action lock before acting.
