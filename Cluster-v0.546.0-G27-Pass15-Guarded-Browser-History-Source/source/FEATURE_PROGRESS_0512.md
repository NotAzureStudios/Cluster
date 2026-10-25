# v0.512.2 larger connected implementation pass (source-only)

- **Packets:** release-pinned, bounded ZIP of independently SHA-256-verified detached note derivatives; includes a source-free per-note integrity manifest, sanitized file names and authorized recipient endpoint and UI. No original Library blobs are bundled.
- **Packet release administration:** administrator-only, reasoned, fingerprint-checked revocation with transactional activity audit, recipient listings/deliveries fail closed for revoked releases. Publication and source backlinks remain immutable/preserved; no deletion of audit history.
- **Notifications:** canonical Inbox event materialization is first-writer-wins on the existing unique `(userId, activityEventId)` record; replay never marks an existing alert as new nor repeats live/Discord delivery, and read state survives reprocessing.
- **Discord:** stale pending receipts can be requeued by an authorized admin and automatically by the existing adaptive, pressure-aware maintenance scheduler. Reuses original receipt and background-queue dedupe key, skips disabled/archived routes, avoids a high-frequency polling loop.
- **Validation:** new executable source/mock suites for Bundle, Release Revocation, Notification Idempotency and Discord Recovery, including concurrency/authorization and integrity failure paths. Inherited suites and independent ZIP reader validated. Full Node 24/Prisma build, PostgreSQL, Windows and multi-user certification remain **unverified**.

**Still outstanding:** signed/derivative PDF/image/media delivery, managed Packages, full Notifications outbox and collaboration, native and database certification, Pass 14/15 authoritative source merge. See `VERSION_0512_BUNDLE_REVOCATION_NOTIFICATION_HANDOFF.md`.

# v0.512.1 incremental feature progress

**Source implemented, not runtime certified:** An author can explicitly publish detached downloadable UTF-8 notes (max 64 KiB per note, max 1 MiB per release); published records contain immutable content and SHA-256, never a Library path. Recipient downloads re-check Packet visibility, release integrity, frozen audience and content hash; audit is recorded before delivery. An editor-only preflight shows eligible and pending counts. Ordinary metadata-only publishing remains the default.

**Not implemented:** PDF/image/audio/video derivative conversions, watermarking, external portal delivery, Package deployment, full Notification outbox, shared Undo/Redo and collaboration workflows, remaining Library 3.0 and calendar UX, or live database/runtime certification.

# Cluster v0.512 | Certification/Hardening Development Entry

**Current status:** Source checkpoint advanced to `0.512.0`. Product **not certified**, **not production ready**. v0.511 Communications/Distribution wave did not complete its full feature ledger.

## Newly source-implemented
- Packet recipients can inspect hash-verified, audience-frozen publication catalogues without receiving Library source identifiers or file URLs.
- Packet reader displays available published catalogues and clearly labels pending derivative delivery.
- Published Packet source backlinks are written in the release transaction and are protected from permanent Library destruction.
- Critical System security notifications remain visible and interruptive despite user category mutes and quiet-hours policies; routine notifications remain configurable.
- 15 targeted executable source/mock tests added. Inherited 0.507–0.510 regression suites remain green.

## Major remaining 1.0 feature tracks
1. Packet derivative delivery, immutable recipient artifacts, entitlement audit, ownership/IP restrictions, external-safe releases.
2. Managed Packages: manifests, signatures, Git source publishing, staged rollout, version pin/rollback, device state, drift/modified-file protection, Inventory/Vault entitlements.
3. Notification outbox/deduplication, scoped alerts, recipients/channels, quiet hours, announcements/actions separation, actionable deep links.
4. Work collaboration/undo/review shared engine, advanced Calendar layers, Library 3.0, People/Form/Inventory admin polish, Project role positive scoped grants.

## Hard release blockers
- Merge Pass 14/15 authoritative source with the staged 0.506–0.512 branch.
- Install pinned Node 24.20+ dependencies and generate Prisma Client; full typecheck/build.
- Fresh real PostgreSQL schema/migration and multi-user authorization + transaction testing.
- Native Windows binaries, shutdown/process tree, GPU/media, DPI/scaling, offline/reconnect testing.
- Security/retention/version-compatibility review and disaster-recovery exercises.

**Rule:** Static parse + mocked suites certify neither database behavior nor production readiness. Keep these gates explicit until individually proven.
