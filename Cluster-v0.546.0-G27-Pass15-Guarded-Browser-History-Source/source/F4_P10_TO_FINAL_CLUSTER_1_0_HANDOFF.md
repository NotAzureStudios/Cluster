# Cluster v0.546.0 F4 P10 → final 1.0 handoff

**Authoritative parent:** Cluster v0.546.0 F4 P10 (the full ZIP in this checkpoint). It cumulatively includes F4 P7–P10 and all prior F2/F3/F4 changes. Do not restart from a G27 or F4 P6 historical archive.

**Completed in this batch**
1. F4 P7, GET side-effect fence for Operations integrity/storage lifecycle.
2. F4 P8, operator-triggered configured Redis/Garnet command compatibility check + UI.
3. F4 P9, rate-limit response validation and secret-safe Redis error classification.
4. F4 P10, read-only Windows 10 22H2 prerequisite inventory.

**Open critical work before 1.0**
1. Exclusive Windows Service-owned drain/maintenance executor. Advisory web preflight alone is **not** permission to restart, mode-switch or update. It must account for active uploads and durable workers, quiesce with bounded deadlines, record native evidence, and verify recovery.
2. Maintenance windows and blackout policies with authorized one-PIN protected configuration, incident suppression limited to expected maintenance noise, and auditable incident escalation for real failures.
3. Live Garnet under Windows 10 with a supported .NET 10 runtime or reviewed self-contained package. Enable `--lua`, keep Pub/Sub enabled, explicitly bind 127.0.0.1/::1, validate security, test all six required protocol capabilities and failure/reconnect paths. Optional memory fallback must remain usable.
4. PostgreSQL 18 disposable migration/reconciliation with the three unapplied migrations: `20261108000000_f3_api_dependency_incident_automation`, `20261109000000_f4_incident_alert_routing`, `20261110000000_f2_native_emergency_incident_receipts`.
5. Real Windows 10 22H2 Service installation, LocalService ACL and SMB/NAS permissions, reboots, ports, Job Object ownership, orphan detection, native journal recovery and OS ESU security coverage.
6. Pinned Go 1.27.1 + Node 24 full build, signature/update/rollback proof, restores and multi-user soak. Prior unit/fixture/source checks are not that certification.
7. Reconcile CD-01..CD-20 feature ledger and TD7 cleanup. No claim of complete 1.0 production readiness until these gates pass.

**Safety invariants:** no external network probes from admin-supplied URLs; no public bind for PostgreSQL/Garnet/private API; no unsupervised auto-updates or potentially destructive repairs; no raw Redis/DB secret strings in diagnostics; PostgreSQL remains authoritative; Network rollback must not overwrite changed configuration.
