# F4 P12 → Cluster 1.0 handoff

**Authoritative source:** `Cluster-v0.546.0-F4-P12-Operations-OpenAPI-Contract-Source.zip`, the cumulative exact successor of F4 P11. Contains F4 P7-P11, all prior F2/F3/F4 changes, and the Operations route documentation closeout.

**Next required source/runtime work:**
- Implement exclusive, authenticated Windows Service-owned planned maintenance, safe drain and explicit restart/update windows. `maintenance/preflight` remains an advisory and cannot authorize execution.
- Implement scheduled maintenance window persistence and role-aware notices, but do not enable destructive unattended actions until supervisor quiescence and rollback are certified.
- Exercise actual Node 24/PostgreSQL 18 migrations, the independent Windows 10 22H2 service, LocalService/SMB/NAS permissions, native alert recovery, Job Objects and network config rollback.
- Validate a real Garnet executable, .NET 10 availability, loopback binding, Lua enabled with `--lua`, Pub/Sub, reconnect and forced failure fallback. Current tests use an isolated fake RESP transport.
- Finish TD7 and the remaining CD-01–CD-20 feature-ledger audit, full signed build, backups, restore drills and multi-user runtime soak.

No new Prisma migrations in F4 P7 through F4 P12. The earlier incident/alert/native receipt migrations remain unapplied and deployment is not certified.
