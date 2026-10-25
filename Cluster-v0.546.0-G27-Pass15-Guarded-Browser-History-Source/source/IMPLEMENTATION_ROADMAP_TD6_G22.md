# Cluster v0.546.0 · TD6 G22 — Unified Project, Board and Whiteboard Discussion

**Source baseline:** TD5 source closeout + TD6 G21 recurring meeting occurrence responses. **Disposition:** G22 source implementation complete; CD-03/CD-19 source-partial; TD5 source-closed, platform-uncertified. No Windows/native certification has been attempted here.

## Connected feature implementation

1. **Project discussion authority:** The existing canonical `EntityComment` endpoint now recognizes `project` as a first-class target, using the existing Project access/archival policy rather than the generic `workspace` comment scope. Authorization is enforced for list, read room, create, reply, edit, reaction and delete. No new comments database or parallel Project notes table was added.
2. **Realtime and notifications:** Project comment context returns the Project's actual ID, membership state and canonical Project collaboration room; live changes broadcast through the existing Project tool. Mentions and assignments use the already integrated Activity/Inbox pathway. Mention candidates require relevant tool access and Project target access; author-only body editing and revision-guarded updates remain in force. A Project's thread cannot be replied to from another Project.
3. **Shared history and disclosure:** Project Overview now exposes the shared Discussion, Watch and Activity surfaces in a collapsible section. The Board history disclosure gains the same existing Watch and Activity surfaces; Whiteboard already had all three. The UI uses the existing components; no redundant local state or new polling loops.
4. **Deletion evidence:** Successful revision-checked comment deletion now records a resource-scoped, content-free Activity entry with actor, former revision and thread identifiers. This is ordinary Activity persistence, **not yet an atomic delete/audit commit guarantee**; stronger cross-store guarantees remain for later collaboration hardening.

## Executed source verification

- `npm run cluster:td6:g22`: 14/14 new G22 route/context/security assertions, 26/26 Board closeout cases, 27/27 Whiteboard saved-history cases, 13/13 G21, 16/16 G20, 16/16 G08, 9/9 G06, plus source scan. These exercise selected handlers with controlled dependencies or source-level fixtures, not live Postgres or signed-in React.
- `npm run techdebt:td5:source-closeout`: 14/14 regression scripts; 167 individual cases passed. These do not certify Windows/Qt/PostgreSQL.
- TypeScript/TSX syntax and renderer-relative import checks pass; complete dependency-backed `tsc`, generated Prisma and real-browser workflows are deferred.

## Scope remaining

- **CD-03/CD-19:** Cross-tool operational/durable draft support, conflict-safe Undo/Redo, read/unread comment paging, deeper collaborative review workflows and full history/notification semantics are still open. 500-comment legacy display limit remains; high-volume pagination is not yet implemented. Existing Board/Whiteboard live operations and saved-history still use their individual authoritative implementations, not a new universal document-CRDT.
- **CD-11:** Detached occurrence rescheduling, per-occurrence resource reservations, editing this/future and other recurrence gaps from G21 remain open.
- **CD-02/CD-07/CD-08/CD-13/CD-15/CD-16:** Library distribution/media, Packages, large transfers, Help and Communications settings remain material unfinished work.
- **TD7 and certification:** Only after TD6 feature implementation. Keep physical deletion, unsafe storage garbage collection, and tier migration disabled pending actual storage/provider and platform acceptance.

**Next grouped priority G23:** Reconcile collaboration-safe comment mutation/audit and paging before attempting broad cross-tool drafts/Undo/Redo; alternatively tackle the Calendar/Scheduler occurrence reservation gap as a bounded complete workflow. Continue **grouped feature implementation**, not tiny cosmetic patches.
