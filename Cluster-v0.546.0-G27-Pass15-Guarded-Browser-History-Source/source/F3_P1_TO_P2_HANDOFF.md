# Cluster 1.0 F3 P1 → P2

Canonical source for continuation: **F3 P1 full-source ZIP**, not the older G27 Batch 3 or another standalone operations-core archive.

## Next implementable connected slices

1. **P2: operator-defined probes and API/tool integrity**: register explicit *safe read-only* service probes with owner, dependencies, auth and rate budget; background job scheduler triggers bounded probes without a per-tool dashboard poll. Server-side registry only, never accept arbitrary URLs (SSRF). Persist health transitions and distinguish observed traffic issues from actual readiness outcomes.
2. **P3: durable incident lifecycle**: extend `OperationsIncident` and timeline transactionally using canonical Prisma and Notification Inbox outbox. Stable fingerprints and dedupe, acknowledged/escalated transitions, and routing from real Users/Teams/Departments with permissions kept separate. Avoid second incident store.
3. **P4: Windows supervisor and network port manager**: native process authority, boot/tray/stop/drain controls, staged port/exposure preflight, recovery, installed-service and firewall diagnostics; preserve G27 Domain Registry handoff and don't auto-expose LAN/TLS/DB.
4. **P5: periodic maintenance and safe automation**: scheduler with leases/timeout, configured windows, jitter, retries/circuit-breakers, backups/rollback verification; never auto-run physical deletion or unsafe restore.
5. **P6: protected settings save**: one PIN at Save after local staging, transaction/revision protection, audit, OS apply/health test and explicit rollback. Use canonical Security PIN policy.

## Unfinished release gates

- G27 remaining Help/Search/Create/accessibility/Inbox follow-through, TD6 Feature Ledger CD-01–20 reconciliation, G26 safety-guarded provider/package/retention work, TD7 removal of obsolete paths.
- Node 24 + PostgreSQL 18 migration/transaction tests, Qt/Windows native supervisor builds, full installer and outbound/inbound networking, Garnet command compatibility and reconnect/fallback, real multi-user browser soak, backup and restore drilling.

Maintain 1.0 feature freeze. Source-implemented is NOT deployment-certified.
