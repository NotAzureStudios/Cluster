# Cluster v0.546.0 | F4 P1 Configurable Operations Cadence

## Exact parent
`Cluster-v0.546.0-F2-P6-Network-Deployment-Auto-Rollback-Source.zip`.

## Implemented in application source
- Reuses the existing, single `BackgroundTaskRegistry.scheduleAdaptive` job for **each** of four established health/incident functions; no per-tool, per-dashboard or additional polling loops.
- Server Config now has a **Maintenance** section and an All Settings search entry for bounded cadence of API dependency/readiness checks (2–15 min), durable incident escalations (2–5 min), native emergency incident import (2–5 min), and data-integrity reconciliation (1–24 h).
- A shared pure helper `operations-maintenance-cadence.ts` defines defaults, bounds and conversion to milliseconds. Untrusted/missing/invalid values fall back to safe defaults. The saving route uses strict Zod integer min/max validation.
- These are **database-backed AppSetting keys**, not boot-file network settings. They share the existing admin-only protected **one PIN at Save**, optimistic per-setting revision checks and atomic database setting write. They require no native service restart or schema migration.
- Each existing scheduler callback reads effective cached settings and chooses its **next** delay. No new external probes or artificial health signals were added. Existing skip/pressure/backoff and ready/draining gating remain intact.
- The maintenance panel clarifies that a cadence change does **not** approve a restart, update, database restore, or destructive maintenance action.

## Critical scheduling semantics
- The existing adaptive registry uses bounded jitter (+/- 8%) and error backoff. Next-run intervals are approximate rather than clock-exact.
- A changed interval is read **on the next scheduled execution**, not immediately after Save. If a long integrity scan was already scheduled for 24 h later, changing it to 1 h may take until that next execution to converge. A later task should explicitly rearm configured loops on committed settings changes without overlapping scans.
- No separate on-call calendar, outside-client network probe, arbitrary remediation engine, Windows task scheduler or update mechanism is claimed here.

## Validation
`node tools/scripts/cluster-f4-p1-operations-cadence-tests.mjs` covers 99 focused behavior/source contract assertions. Selected inherited suites cover F2 P5/P6 networking, F2 P4 native incident reconciliation, F3 routing/atomic settings/API readiness and Domain configuration recovery. The TS/TSX/CSS/relative-import scanner is run independently.

## 1.0 release blockers retained
- Real Windows 10 22H2 Service Control Manager, LocalService/NAS ACL, boot/kill/restart/rollback and child process cleanup acceptance.
- Live PostgreSQL 18 migrations and recoveries, pinned Node 24 and Go 1.27.1 toolchain, Garnet Redis-protocol coverage, actual HTTPS/TLS/Windows Firewall/proxy checks.
- The independent service pre-boot fallback, scheduled updates, authorized bounded remediation, maintenance windows, emergency alerts, and on-call rotations need final integration/certification.
- Current 1.0 source is not deployment-certified. No automatic software update or server reboot is enabled by this pass.
