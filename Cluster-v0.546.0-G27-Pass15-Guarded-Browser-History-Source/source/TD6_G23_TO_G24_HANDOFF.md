# Cluster TD6 G23 → G24 continuation handoff

**Canonical source:** `Cluster-v0.546.0-TD6-G23-Durable-Collaboration-Paging-Atomic-History-Source.zip` (complete source, G23 migration, tests, manifest and roadmap). G22 is its parent. **Never reconstruct from an earlier WIP/RC branch.**

**TD5:** Source closed (167/167 regression cases reaffirmed). Live Node24/Prisma/PostgreSQL, Windows Host/Qt, SMB/NAS/S3 and destructive storage certification deferred to final release testing. Do not reopen TD5 for those gates.

**G23 implemented:** `GET /api/entity-comments` breaking return shape `{items,hasMore,nextCursor}` with root-specific pinned/newest stable keyset paging + `_count` groupBy; `GET /api/entity-comments/:commentId/replies` with authenticated, thread-scoped ascending paging; renderer load-more + lazy replies; tombstone migration `deletedAt` preserving replies and hiding deleted content; atomic Prisma transaction for comment creation/edit/deletion + Activity domain outbox via `activityService.recordInTransaction` + `wakeCommittedActivity`. Two paging indexes. Newly created Activity events use neutral messages, avoiding raw comment body duplication. Reaction CAS remains without separate Activity events.

**Caveats:** Real PostgreSQL migrations/index plans and multi-user authenticated UI are unverified. Existing pre-G23 Activity/Inbox excerpt retention is not automatically purged by deletion. Root pages reset upon realtime change to re-check authorization. Anchor filtering only evaluates currently loaded threads. No server-persisted drafts, undo/redo, per-user unread history or cross-workspace conflict merge yet. Do not overclaim CD-03/CD-19 completion.

**Tests:** `npm run cluster:td6:g23` (G23 24 route/assertion + 5 Activity/outbox, G22/Board/Whiteboard/G21/G20/G08/G06/source scans); `npm run techdebt:td5:source-closeout` (167/167). Source manifest/checksum/archive integrity verified at packaging. All are controlled/source-level tests.

**Next:** G24 connected feature work should address permission-safe persistent discussion drafts and scoped Undo/Redo + per-user unread state, OR Calendar occurrence moves with Scheduler reservation authority; then continue remaining CD requirements. Keep single-source-of-truth architecture, no compatibility scaffolding, no silent unsafe physical deletion. Finish TD6 → TD7 → actual certification.
