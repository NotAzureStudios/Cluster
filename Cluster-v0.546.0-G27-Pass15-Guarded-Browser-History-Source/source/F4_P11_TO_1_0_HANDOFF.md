# F4 P11 → Cluster 1.0 closeout handoff

**Authoritative full-source parent:** `Cluster-v0.546.0-F4-P11-Verified-Redis-Connection-Gate-Source.zip`. Includes all F4 P7–P10 and prior F2/F3/F4 features. Keep exact-parent patches and the full ZIP.

1. Run real Garnet on Windows 10 22H2: verify .NET runtime/self-contained packaging, signed executable, loopback-only bind, authentication, `--lua` enabled, Pub/Sub enabled, full configured-command probe and reconnect/failover. A compatibility-passing Redis server is not proof of product identity.
2. Install/boot Cluster's independent Windows Service with least privilege and verify UI tray independence, Job Object process cleanup, ports, permission ACLs, storage/NAS, local preflight and rollback.
3. Apply and test three pending F3 P2/F3 P3/F2 P4 migrations only on disposable PostgreSQL 18 before touching studio data. Test incident idempotency, native journal replay and restored operation.
4. Finish an exclusive Windows Service-owned maintenance executor and protected calendar/window policies. Advisory preflight and runtime fencing are not authority to restart/update.
5. Audit CD01–CD20, TD7, full Node 24 + pinned Go 1.27.1 build, update rollbacks, backups/restores, simulated faults and multi-user soak.

Do not call Cluster 1.0 production-ready or claim Windows 10/Garnet certification from these source and fake transport tests. No new Prisma migration in F4 P11.
