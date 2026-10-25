# Cluster v0.546.0 · TD6 G24 — Persistent Discussion Drafts, Read State & Revision-Safe History

**Baseline:** `Cluster-v0.546.0-TD6-G23-Durable-Collaboration-Paging-Atomic-History-Source.zip` (full verified source). **State:** G24 source implemented. TD0–TD5 source-closed; TD6 CD-03 / CD-19 remain partial. **Not a certified release.**

## Delivered (connected cross-tool work)

1. **Per-user discussion drafts:** The canonical comments service now exposes `GET/PUT/DELETE /api/entity-comments/draft`. Authenticated authors must pass the underlying target's **contribute** permission for every request. A normalized `EntityCommentDraft` model uniquely identifies `(userId, entityType, entityId, slotKey)`, where `slotKey` is `root` or `reply:<existing-comment-id>`. The latter is checked against the original resource. Draft text is never broadcast to collaborators or included in comment Activity/notifications. Drafts use guarded first-create semantics, transactional CAS revision updates, and guarded deletion to block cross-tab lost writes. No draft is stored in localStorage or browser persistent state.
2. **Server-backed shared UI composer:** `useDiscussionDraft` integrates with the existing `CollaborationPanel` across Projects, Boards, Whiteboards, and other canonical shared-work targets. Root and reply composers recover their own private saved texts. Debounced serialization prevents stale responses from superseding newer local keystrokes; an explicit **Save now** is available. HTTP errors and 409 conflicts block blind overwrites; the user can deliberately **Load saved** or **Replace saved**. Committing a comment and deleting its matching draft happen in the same Activity-backed comment transaction when the client submits a matching observed draft revision. If another tab created a newer draft, the comment may still post but the newer draft is retained and the client shows a conflict warning. Drafts are best-effort autosaved; abrupt page termination before the network write can still lose the last unsent keystrokes.
3. **User-only read watermarks:** `GET/POST /api/entity-comments/read-state` return an access-checked, per-user/per-resource unread count and an explicit server snapshot. Users **Mark all read** intentionally, using the snapshot instant rather than `now` at commit; newly arrived comments are not automatically consumed. The server writes a monotonic watermark even if two tabs mark at different snapshots. Read state does not reveal private recipients and is not published as social presence.
4. **Reversible thread metadata controls:** Session-local Undo/Redo supports *pin, resolve, and assignment* changes using the same audited, revision-guarded canonical PATCH operation. If a collaborator changes the comment in between, history stops and reloads rather than overwriting their work. Cross-comment history is bounded to 20 operations. **Not universal Undo/Redo:** text edits, posts, deletions, other workspaces, offline conflicts, and durable session restoration still require an operation-history engine.
5. **Privacy/export/erasure:** Private drafts and read watermarks appear in the user privacy summary and bounded personal-data export (export schema 6). Approved erasure deletes those private-only records transactionally rather than retaining unpublished text on a pseudonymized account. Comments and mandatory audit evidence preserve their own governance rules. New Prisma migration creates both models with scoped uniqueness, indexes and cascade account references.

## Verification

- **G24 registered-route tests:** 12/12 passing, exercising actual registered handlers with controlled Prisma policy mocks: isolation, read/contribute permission, reply validation, CAS, stale delete, atomic draft cleanup on post, retention of newer drafts, monotonic per-user reads, stale history inverse refusal, and privacy code wiring.
- **Inherited G23 integration:** 24/24 cases; Activity/outbox: 5/5 cases. G22, Board, Whiteboard and G21/G20/G08/G06 Calendar suites passed under `npm run cluster:td6:g24`.
- **TD5 source closeout:** 14/14 suites, 167/167 cases passed again.
- Source TS/TSX parsing and renderer import/CSS scans passed. These are **not** dependency-backed `tsc`/Prisma generation or authenticated runtime tests.
- G24 PostgreSQL migration and indexes **have not** been deployed to a live database. Native Win32/Qt executables unchanged. No Windows/SMB/NAS/S3 certification was performed. Destructive storage functions remain gated.

## Next priorities: G25 and beyond

1. **CD-03/CD-19:** durable cross-workspace reversible command history and collision resolution beyond discussion metadata; finish per-thread unread and visibility-aware activity navigation; remove stale pre-G23 Activity/Inbox excerpts under retention governance.
2. **CD-11:** Scheduler-authoritative detached occurrence reschedules with atomic reservation release/rebook, collision guards and attendee notifications.
3. **CD-02/CD-07/CD-13/CD-08:** recipient-safe PDF/media derivatives, long-running streaming transfers, Library bulk UX, Package repair/update/rollback.
4. Remaining CD-01–CD-20 functional gaps grouped by real end-to-end workflows. Then TD7 implementation cleanup, then full runtime certification.

**No declaration of full TD6, CD-03, CD-19 or 1.0 completion.**
