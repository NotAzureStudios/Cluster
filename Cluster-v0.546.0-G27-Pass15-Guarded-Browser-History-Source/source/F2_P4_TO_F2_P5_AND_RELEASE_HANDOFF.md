# Cluster 1.0: F2 P4 → F2 P5 / Release Continuation

**Exact parent of the NEXT pass:** `Cluster-v0.546.0-F2-P4-Native-Emergency-Reconciliation-Source.zip`.

## Closed source slice

Read `F2_P4_NATIVE_EMERGENCY_CANONICAL_RECONCILIATION_CLOSEOUT.md`. The two native emergency producers (Go Host and Windows launcher) now have a bounded read-only consumer in the Node API, with durable PostgreSQL event receipts and established user/team/department incident routing. Production/runtime certification is **not** closed.

## Next connected implementation work

1. **Canonical Network & Ports configuration UI:** combine Go Host, API, web listener, PostgreSQL, Garnet, TLS/gateway origins/proxy trust and firewall intent into one version-checked draft. Provide before/after exposure preview, capability checks, and one Security PIN on Save. Never automatically open external firewall access. Roll back if a verified staged apply breaks connectivity.
2. **Service acceptance & shutdown lifecycle:** complete reliable service-account access, native process ownership with suspended child launch (close Start→Assign race), service-driven hardware/process metrics, Windows event logging, native UI controls, real SCM boots/stops, and lease-safe drain of jobs/uploads.
3. **Maintenance & operations:** bounded scheduled health checks, maintenance/read-only/draining transitions, safe update/restart policy, explicit backup/restore checks, operator assignment, quiet-hour-aware alert distribution, and Garnet Redis-protocol compatibility/fallback checks.
4. **Recipient model:** teams, admins, departments exist. Delegated non-admin responders, on-call rotations, secondary channels, lifecycle ownership, and escalation across quiet hours are still future source work.
5. **Prove migrations in disposable PostgreSQL 18:** F3 P2 (20261108), F3 P3 (20261109), F2 P4 (20261110), plus earlier TD6 migrations. Then full Node 24, Go 1.27.1, native Windows launcher/UI/Service, Qt/Desktop, SMB/NAS, browser, soak, restore and fault injection testing.
6. **Feature ledger and TD7:** reconcile CD-01 through CD-20 unfinished user workflows against current source and close or deliberately defer only actual optional 1.1 items. No silent compatibility scaffolding.

**Operational safety:** No automatic destructive data repair, cleanup, restore or migration while verification fences remain unproven. Do not claim deployment-ready from source assertions.
