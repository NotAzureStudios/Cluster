# Cluster 1.0 — TD6 implementation-first roadmap (F03)

**Standing user direction, 2026-10-17:** Deliver unfinished v1 features and integrated code first. Keep focused source checks. Do not block future TD6 work on Windows/PostgreSQL/runtime certification. Track deferred acceptance honestly.

## Current authoritative source

- `Cluster-v0.546.0-TD6-F03-Card-Saved-History-Source.zip` directly extends TD6 F02.
- TD0–TD4 remain source-closed; TD5 changes retained. TD5 platform acceptance deferred.
- TD6 F01: Forms conditional branching with hidden-field validation and editor/runner.
- TD6 F02: Form due dates, optional reminders, durable claims and admin reporting.
- **TD6 F03: Card metadata saved operation history and user-scoped post-save Undo/Redo through repository/API/editor.**
- **CD-03 remains open**: persistent Whiteboard operation inverses, broader collaborative review/approvals and shared mutation/history patterns not fully integrated.
- TD7 architecture cleanup and final source freeze follow meaningful TD6 feature completion. Certification follows after.

## Next connected work, prioritized

1. **TD6 F04/CD-03:** Whiteboard post-save operation inverse metadata and controlled Undo/Redo/review for safe element moves/patches; preserve realtime operation sequence and target conflict protection. Test conflicting target updates, ownership and compaction; do not expose universal snapshot overwrite.
2. **CD-07:** Authorized PDF/image/audio/video Packet derivatives, immutable release provenance, access and watermark/metadata processing, with narrow safe adapters and no Library source leakage.
3. **CD-08:** Managed Packages trusted install/update/rollback source integration with native Desktop and entitlement boundaries; do not claim native activation certified.
4. **CD-04:** Account/People delegated access expiry/offboarding closure, approvals and evidence.
5. **CD-02/CD-10–20:** Focus on remaining genuine end-to-end gaps using `TECH_DEBT_MASTER_ROADMAP.md`; avoid reopening source-closed TD tracks without identified defects.

## Certification backlog (explicitly deferred)

Installed pinned Node 24 toolchain, Prisma generate and migration on disposable Postgres, full compiled client/server, authenticated multiactor browser, Windows Qt/native, NAS/S3, failure/reconnect and release acceptance. See `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## Safety constraints

No unsafe Library physical delete/GC/quarantine. Preserve per-operation authorization, exact revisions, persisted actor identity, atomicity, stable source contracts and the existing Card three-way merge UX. No backwards-compatibility shims for inactive installs.
