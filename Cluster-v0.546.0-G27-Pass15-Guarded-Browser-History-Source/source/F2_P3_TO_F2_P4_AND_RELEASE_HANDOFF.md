# F2 P3 → F2 P4 / F3 F4 release continuation

**Parent:** `Cluster-v0.546.0-F2-P3-Service-Network-Preflight-Source.zip`. Verify SHA-256, file manifest and exact-parent patch before modifying.

## Next connected implementation slice

1. **Native-to-canonical event reconciliation:** Transactionally import native emergency journal events into existing OperationsIncident and Inbox after PostgreSQL recovers. Deduplicate by stable event ID, preserve event time, avoid replaying old notifications and resolve authorized responder routing. Do not build a second alert store.
2. **Canonical Network Manager:** Unify `serverHost/serverPort`, Go Host private API port, `webHost/webPort`, public origin, TLS, CORS, proxy trust and firewall intent in one model. Add dry-run, listener ownership, before/after firewall diff, explicit consent, critical change PIN at Save, revision-checked transaction and rollback after failed reachability. Never automatically open an internet-facing port.
3. **Live LocalService acceptance:** Test actual Windows SCM boot before login, restricted account ACLs, NAS/SMB paths, unexpected reboot, slow database provisioning, orphaned children and Job Object inheritance. Fix any Start()→Assign() race with suspended/atomic ownership where required.
4. **API+hardware panel:** Per-worker CPU/RAM/I/O/job totals, GPU availability and true process subtree accounting, persistent readiness evidence, port owner *process identity* where authorized, read-only observer separated from privileged mutations.
5. **Maintenance/Garnet:** Managed Garnet provision/Redis-compatibility tests with safe memory fallback; bounded update schedule, maintenance modes, restart policy, backups and restore verification. No destructive auto-repair or PostgreSQL direct restore without operator authorization.
6. **Complete 1.0 gates:** Apply and test F3 P2/P3 database migrations on disposable PostgreSQL 18, install using pinned Node 24/Go 1.27.1, execute Windows native/Qt/browser tests, perform backup-restore and power-loss fault injection, then reconcile TD6 CD-01..20 and TD7 source cleanup.

**Release status: not deployment-certified.** Every source milestone must separately track live OS/database acceptance; source checks do not close those gates.
