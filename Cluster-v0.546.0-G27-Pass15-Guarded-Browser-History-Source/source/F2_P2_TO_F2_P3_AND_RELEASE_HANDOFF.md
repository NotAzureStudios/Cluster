# F2 P2 → F2 P3 and Cluster 1.0 acceptance

**Authoritative parent:** `Cluster-v0.546.0-F2-P2-Windows-Job-Supervision-Readiness-Source.zip`. Verify source hash, manifest and incremental patch before editing. Do not branch from F2 P1 again.

Continue the final roadmap in coherent source slices:
1. Validate actual Windows 11/Server LocalService boot/restart and readiness report, including long provisioning. Verify real nested Win32 Job Objects, PostgreSQL `pg_ctl` process-group accounting, and safe shutdown; implement truly atomic child creation if process-spawn race occurs. Add Windows-specific reproducible fault tests.
2. Derive UI status from both SCM and application readiness; make native logs and per-process CPU/RAM/storage/GPU/port ownership visible without exposing secrets. Separate read-only observer from privileged actions.
3. Network/port configuration: explicit TCP bindings, collision checks, firewall diff/consent, gateway configuration, TLS validation, safe rollback and restricted Postgres/Garnet endpoints.
4. Install-time secure ACL account provisioning and SMB/NAS testing; verify absolute service paths, opt-in policy and installer signature/rollback.
5. Reconcile native emergency journal into persistent canonical Incident/Inbox after database recovery, preserving idempotency and responsible-team assignments.
6. Complete bounded scheduled maintenance, upgrades, Garnet compatibility, TD6 feature ledger cleanup, TD7 fossil removal, and real release certification.

Never claim 1.0 readiness from source checks. Only 1.0.0 after production Windows, Go 1.27.1, Node 24, PostgreSQL 18 migrations, backup restoration and operational acceptance evidence.
