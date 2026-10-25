# Cluster v0.546.0 · TD6 G23 — Durable Discussion Pages & Atomic Collaboration History

**Baseline:** `Cluster-v0.546.0-TD6-G22-Project-Board-Whiteboard-Collaboration-Source.zip`.
**State:** G23 source implementation complete, **CD-03/CD-19 still partial**. TD0–TD5 remain source-closed. Full PostgreSQL/Node24/Qt/browser/Windows acceptance is **not** claimed.

## Shipped as one connected implementation

1. **Paginated discussion threads:** Canonical `GET /api/entity-comments` now returns `{ items, hasMore, nextCursor }` rather than a silently truncated 500-entry flat array. Pages contain roots, ordered pinned first, then newest with an ID tie-breaker. Default 25, hard ceiling 50 roots per request. The cursor is strictly validated and never replaces the normal target authorization check. The server calculates per-root reply counts with one scoped aggregation for the displayed roots.
2. **On-demand paginated replies:** `GET /api/entity-comments/:commentId/replies` returns a bounded reply page (default 25, maximum 100) with an ascending deterministic `(createdAt, id)` keyset cursor. Only root comment IDs may access this endpoint, and access to the underlying entity is reevaluated on every request. Fetches are restricted to the same canonical resource and thread root.
3. **Renderer:** Shared `CollaborationPanel` now loads root pages progressively, exposes explicit **Load older threads**, expands replies on demand, and exposes **Load more replies** without an N+1 flood on initial render. Project/Board/Whiteboard and other shared work surfaces inherit the same UI. Scoped realtime refresh invalidates stale pages, rechecking authorization and reopening only currently expanded visible threads. Changing context invalidates pending fetches.
4. **Atomic mutation/history:** Comment creation, body/assignment/resolution edits, and deletions persist their canonical records, Activity and the Activity domain outbox in one Prisma transaction. Activity failures roll back the user mutation. Successful commits wake the normal event dispatcher; broadcasts happen only after commit. Activity's strict transactional writer is reusable, while existing best-effort `record()` behavior remains unchanged for other domains. Reactions continue using the pre-existing revision-guarded retry path and do **not** yet emit a separate audit event.
5. **Thread-safe deletion tombstones:** `EntityComment.deletedAt` and a PostgreSQL migration preserve root/reply hierarchy rather than orphaning children with physical deletes. CAS-protected tombstones strip comment body, author link, mentions, evidence, anchor, reactions, and assignee, retain its thread ID, and write a **content-free deletion Activity** in the same transaction. Deleted comments are displayed as redacted placeholders, cannot be edited/reacted to again, and are not physically discarded. New create/edit Activity records no longer duplicate private comment text in their message field. **Previously emitted Activity/Inbox records are not retroactively scrubbed**; their retention/disposition remains a separate governance requirement.
6. **Query indexes:** Two schema indexes and migration DDL cover root paging and per-root reply traversal. This is source-level SQL/schema alignment, not proof of live-DB index use.

## Verification and limitations

- New G23 registered-route/mock integration tests: **24/24 passed** (includes previous G22 cases and G23 pagination, scoping, tombstones, CAS, rollback).
- New G23 Activity service/outbox tests: **5/5 passed** (strict vs best-effort contract, transactional failure and wake ordering).
- Inherited G22, Board, Whiteboard, Calendar G21/G20/G08/G06 and source scan: **passed** using the project's existing test commands.
- TD5 source closeout: **14/14 scripts, 167 test cases passed**. TD5 certification status is unchanged.
- The recorded test evidence uses controlled dependencies and TypeScript syntax/import scans. **No live Prisma-generated client, PostgreSQL migration execution, React authenticated browser session, Qt build or Windows native binary certification.**
- Root pages reset on realtime refresh, rather than retaining old pages that may no longer be authorized. Anchor-specific filtering currently operates on loaded threads; older anchors require loading older pages.
- Source implementation is not the same as finish of CD-03/CD-19. Collaboration-safe persisted drafts, edit/redo history, unread cursors, presence beyond current tool implementations, and fully coordinated cross-tool notifications remain open.

## Recommended next major grouped work (TD6 G24)

1. Complete **shared cross-tool draft/recovery and collaboration-safe Undo/Redo** with permission-aware storage, revision conflicts and strict version limits. Avoid storing sensitive drafts in unencrypted client persistence.
2. Build **per-user unread thread state** and history navigation using the new paginated thread authority; handle notifications, membership and Project/Board/Whiteboard access revocation.
3. Resume **CD-11 Scheduler-aware detached occurrence rescheduling and reservations**, or group remaining Library/media large-upload and Package lifecycle gaps if prioritizing another complete workflow.

**Permanent sequence:** finish remaining CD-01–CD-20 implementation in substantial grouped batches → TD7 cleanup → full Node24/PostgreSQL/browser/Qt/Windows runtime certification. Destructive storage cleanup remains disabled pending actual provider and recovery tests.
