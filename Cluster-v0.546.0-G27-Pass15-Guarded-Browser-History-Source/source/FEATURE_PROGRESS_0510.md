# Cluster v0.510 | Planning, Projects, Library, Administration

**Status: feature wave transitioned to 0.511; important follow-up work remains, not runtime certified.**

## Priority implementation tracks
1. Project Control/identity, Project Types, resource availability and Project closeout/approval correctness.
2. Calendar / Scheduler / Timeline integration, capacity/overlays, timezone and recurrence authority, and coherent drag-drop/rescheduling.
3. Library 3.0 explorer, asset records, project folder navigation, revisions, references, retention, metadata and bulk operations.
4. Tool Config, inherited Studio/Project configuration, Administration observability and effective-access explanation.
5. Shared actions, views, resource pickers and inspector adoption, with permission-safe creation and deep links.

## Carry-forward requirements
- From 0.509: common work status and lifecycle beyond the Card/Board foundation, Whiteboard-to-Card conversion, cross-tool undo/redo/autosave, comments edit history, multi-writer sync/offline replay and reviews/approvals.
- From 0.508: Packet derivative delivery, complete entitlements, Vault secure recovery and reveal UX, onboarding/offboarding depth.
- From 0.507: per-user positive scoped grants and full impact preview.

## Release gates (remain open)
- Authoritative Pass 14/15 reconciliation, generated Prisma client and migration validation, Node 24+ full compilation, multi-user PostgreSQL runtime, Windows Qt/native packaging and 100/125/150% DPI parity.
- Do not promote source parser/mock tests into production certification.

**Next planned stopping point:** `0.511.0`, where Communications/Packages/Integrations becomes active.

## v0.510 closeout implementation, source tested
- Project closeout action transitions are explicit and revision-fenced. Serialization of partner links is manager-only and strips hashes and raw tokens. First-read initialization is advisory-locked. Readiness scans now use database counts for Boards, Tickets, Library, and Roadmap.
- Calendar API validates offset-bearing timestamps, IANA timezones, positive bounded range windows, and real calendar dates. Multi-day overlap queries include events starting before the viewport. Scheduler DST recurrence uses a deterministic gap/fold policy.
- Library destruction preview reports exact dependency counts even when evidence lists are truncated. Permanent destruction uses a serializable transactional hold, revision, relationship and retention recheck; filesystem unlink avoids blobs referenced by other items/versions.
- No Prisma schema change/new migration in this wave. Live PostgreSQL and Windows behavior remain unverified.
