# G25 WS14 → next closeout handoff

**Canonical source:** `Cluster-v0.546.0-TD6-G25-Workstream14-Feed-Integrity-Online-History-Source.zip`. Direct parent WS13. **G25 is OPEN**, not silently promoted to G26.

Changed canonical files: `apps/server/src/domains/collaboration/whiteboard-operation-routes.ts`; renderer Whiteboard `whiteboard-operations.ts` / `WhiteboardWorkspacePage.tsx`; offline `offline-conflicts.ts`; Board `board-card-move-history.ts` / `BoardWorkspacePage.tsx`; 3 focused/inherited tests; npm G25 script; docs, manifest. No Prisma schema or native binary changes. Read `TD6_G25_WORKSTREAM14_FEED_HISTORY_CLOSEOUT.md`.

Keep: apply Whiteboard deltas only when gap-free through the advertised watermark; on incomplete feed, fetch authoritative full board and preserve local dirty work. Do not auto-discard conflict queues; registered actions require server acceptance; do not queue Board saved history Undo/Redo while unsafe. Do not describe best-effort conflict preflight as atomic.

Next grouped work: close Board/List server-owned reversible history or approve a specifically documented deferment; integrate offline queue two-tab CAS and authenticated replay tests; perform final G25 feature ledger audit. If source scope meets acceptance, move to G26 without inventing new development phases. Node24/PostgreSQL/Qt/browser runtime certification remains deferred, and irreversible native/storage operations stay gated.

Verification commands: `npm run cluster:td6:g25:ws14`, `npm run cluster:td6:g25`, `npm run techdebt:td5:source-closeout`.
