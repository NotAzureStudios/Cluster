# Cluster 1.0: F2 P5 → F2 P6 / Final Release

**Exact source parent:** `Cluster-v0.546.0-F2-P5-Network-Ports-Draft-Review-Source.zip`. Read `F2_P5_NETWORK_PORTS_DRAFT_REVIEW_CLOSEOUT.md` first.

## Next connected source slice: network apply and rollback

- Build a native-service-owned **last-known-good network boot contract** with a durable config revision, preflight guard, bounded post-restart `/health/ready` verification and rollback only when the service can prove it is restoring the prior validated state. Ensure reversion is atomic with the existing server-config publication journal. Handle Windows Service startup failures even when the Node API is absent. Do not confuse a successful localhost health response with outside-client HTTPS/TLS reachability.
- Remove remaining fixed port assumptions from native/Node API integration; audit configured PostgreSQL and optional Garnet port management plus gateway/proxy/TLS/firewall *intent* in one page, without silently opening firewall rules.
- Validate real Windows user/service account ACLs, SCM boot/start/stop/recovery, suspended child-job assignment, precise process-resource metrics, TCP listener PID ownership, and managed config failure observability.
- Finish maintenance scheduler, health-based safe restart/update policy, user/team system incident ownership, quiet-hour delivery, Garnet protocol compatibility and safe fallback.

## Hard certification gate

Run actual Node 24 dependencies, generate Prisma and apply all migrations on disposable PostgreSQL 18, then clean Windows x64 Go 1.27.1/Win32 launcher and service build, real boot and port conflict tests, TLS/gateway/outside-client tests, backup/restore and network rollback fault injection. No signed 1.0 deployment before these gates.

## Product closeout

Reconcile CD-01 through CD-20 implementation ledger, then TD7 dead-code and UI cleanup without compatibility shims. Record evidence for every completed core workflow; defer optional improvements to 1.1 only by explicit disposition.
