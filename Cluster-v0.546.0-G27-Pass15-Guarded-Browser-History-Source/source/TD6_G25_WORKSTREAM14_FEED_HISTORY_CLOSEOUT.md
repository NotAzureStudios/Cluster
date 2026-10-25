# Cluster TD6 G25 Workstream 14: Whiteboard Feed Integrity + Reconnect/History Safety

**Source checkpoint:** v0.546.0 G25 WS14; direct parent WS13. **G25 remains source-open.** No migration or native executable was changed. This is a genuinely grouped source implementation with controlled tests, not a runtime/browser PostgreSQL acceptance claim.

## 1. Whiteboard page truncation was a state-loss hazard

The server serves at most 500 operations (`GET /api/whiteboards/:id/operations`). The renderer previously applied `feed.operations` with `feed.currentSequence`, even when the page contained only part of the intervening history. After a large collaboration burst, this could jump the local cursor over un-replayed operations. The operation feed route now reports `returnedThroughSequence` and `hasMore`. The existing Whiteboard operation contract adds `planWhiteboardFeedSync`: it accepts only a gap-free, strictly consecutive interval from the exact local sequence through the server watermark. Any gap, out-of-order row, truncated page, reset, metadata-only revision change, or racing watermark triggers a fresh authoritative Whiteboard GET. Dirty local work is never overwritten: the fresh server version becomes `pendingRemote` for the existing three-way review. Without a verified GET, the local copy remains untouched and the UI shows a recovery message. No second collaboration feed engine was introduced.

## 2. Cross-tab Sync Center resolution preflight

Before submitting a registered conflict resolution, the renderer re-reads the mutation store and confirms the queued item still has the original ID, conflict identity, `conflict` status and update marker. Missing/stale entries fail before server acknowledgment. `rebaseOfflineMutation` must return a real local record before UI claims that an edit was requeued; if it disappears after server confirmation, the UI reports an explicit ambiguous outcome rather than false success. This is a preflight safety improvement, **not an atomic two-phase commit across browser storage and server**. Race conditions occurring *between* this read and remote commit remain targets for actual multi-tab certification; never claim full atomicity or durable remote-local coordinated CAS.

## 3. Board move Undo/Redo online gate

Saved Board move session history is not equivalent to Card metadata's server-owned history. The existing revision-guarded Board move controls now pause during connecting/reconnecting/offline or whenever Board collaboration has pending/replaying/paused/failed/conflicted edits. Both keyboard and visible buttons honor the same gate, with explicit recovery copy. Normal Card move submission is unchanged. No compatibility alias, duplicate Undo engine or schema extension.

## Focused evidence

- `cluster-td6-g25-ws14-feed-integrity-tests.mjs`: 15/15 tests for contiguous replay, 500-operation truncation, racing cursors, metadata-only revisions, dirty-draft guard and route/UI wiring.
- `cluster-td6-g25-ws14-board-online-history-tests.mjs`: 6/6 tests for live/polling, offline, pending/failed/conflicted, and UI/keyboard controls.
- Inherited WS13 reconnect suite (extended with stale queue and lost rebase): 21/21.
- Inherited Whiteboard durable server history: 27/27; Board keyboard: 17/17.
- `npm run cluster:td6:g25`: PASS. `npm run techdebt:td5:source-closeout`: 14/14 scripts, 167/167 cases PASS.
- `cluster-td6-source-scan.mjs`: 1,076 TypeScript/TSX, 3,204 relative renderer imports, 110 CSS files, zero reported scan failures. These scans are *not* TypeScript compiler/runtime tests.

## G25 closeout decision

**Remain source-open**, but with specific final items, not a general “polish” bucket:

1. **Board/List durable operations**: Board move Undo is currently session-only, as the source explicitly documents; complete durable per-actor history and author/concurrency/compaction rules or formally scope it for post-1.0 with product approval. Card saved metadata and Whiteboard operations already have server-owned history. Do not create a redundant generic history engine.
2. **Replay concurrency**: replace the best-effort client preflight with a reliable queue/status transition protocol compatible with IndexedDB and the Qt native bridge; validate lost acknowledgements, revoked permissions, version-gate changes and two authenticated editors. Cross-boundary atomicity cannot be inferred from source mocks.
3. **Release and cross-tool task acceptance**: re-audit Project/Build/QA/Review provenance, deliberate Ticket/Board routing, and linked form follow-up with end-to-end authenticated flows. Source gates exist; runtime certification remains separately deferred.
4. **Runtime certification** (post-TD7): Node 24 generated Prisma, live PostgreSQL migrations, Windows/Qt, mobile browser, multiuser, real timing/load. These are not source-closeout failures but must not be presented as passed.

G26 Library/Viewer/Packets/Transfer/Package, G27 Operations/UI, G28 ledger, and TD7 final cleanup remain scheduled. No unverified native install or storage disposal was enabled.
