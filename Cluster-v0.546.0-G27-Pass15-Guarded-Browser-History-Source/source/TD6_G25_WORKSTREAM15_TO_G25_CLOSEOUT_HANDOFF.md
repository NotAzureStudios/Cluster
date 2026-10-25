# G25 WS15 continuation handoff

**Canonical complete-source ZIP:** `Cluster-v0.546.0-TD6-G25-Workstream15-Board-Column-History-Sync-Leadership-Source.zip`.
**Direct parent:** `Cluster-v0.546.0-TD6-G25-Workstream14-Feed-Integrity-Online-History-Source.zip`.
**G25:** source still open. Do not promote to G26 without auditing specific remaining requirements.

Read `TD6_G25_WORKSTREAM15_COLUMN_HISTORY_SYNC_LEADERSHIP.md` and its verification JSON first. New migration is unapplied to PostgreSQL. Current `npm run cluster:td6:g25` includes focused WS15 tests.

New history behavior: `BoardListSavedOperation` tracks safe column metadata plus pair-guarded order changes. No reversible List deletion, no automatic isDone reversal, no async/queued history inversion. Server-only durable snapshots and actor-specific revision checking. UI fetches history on click; no background polling per List. Sync fallback fail-closed on storage-write failure and foreign/expired lease, but fallback still lacks an atomic compare-and-swap guarantee. Test live browsers before trusting fallback cross-tab replay.

Next group: finish/archive-and-restore strategy for Lists vs linked Tickets, reconcile Project/QA/Review provenance and finalize source acceptance matrix; then either document exact missing blockers or close G25 *source only*. Reserve G26 for Library/media/transfer/package implementation per consolidated plan. Keep TD5 source-closed and destructive physical deletion gated; TD7 and full runtime certification remain subsequent.
