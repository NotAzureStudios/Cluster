# F4 P2 handoff and next safe slice

Current authoritative source: `Cluster-v0.546.0-F4-P2-Live-Operations-Schedule-Rearm-Source.zip`.

**Next: F4 P3 Maintenance Mode enforcement audit + integration**. Reconcile existing runtimeAccessModeFromEnvironment, cached readiness and write guards with native Host lifecycle. Do not invent an inconsistent second policy service. Stage/configure maintenance windows in the existing one-PIN settings UX only after a single source-of-truth authority is identified. Plan and test bounded transitions Normal → Draining → Maintenance/Read-only → Verified Normal; no unsafe write replay, no unauthorized gateway bypass. Background jobs must checkpoint and respect status; native supervisor alert path must remain independent.

Also pending: Windows 10 native service, PostgreSQL 18 live migration+restore, pinned Go 1.27.1, Node 24, Garnet, external TLS/firewall/proxy, process Job Object fault injection, signed update/rollback.
