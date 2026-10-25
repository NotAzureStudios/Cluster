# G25 Workstream 9 → continuation

Canonical archive: `Cluster-v0.546.0-TD6-G25-Workstream9-Series-Horizon-Collaboration-Recovery-Source.zip`.
Direct parent: G25 WS8 Virtual Scheduler Capacity. Do **not** reopen TD5, promote G26 or claim TD7 entry yet.

Preserve: new `recurrenceEndDate` schema/migration, local-date DST matching in Calendar projector, `calendar-series-horizon.ts` full occurrence verification in create/update under advisory locks, `calendar-virtual:incomplete` fail-closed; candidate pruning with legacy-null and moved-exception handling; Whiteboard pendingRemote recovery barrier. Tests: `cluster-td6-g25-series-horizon-history-tests.mjs` + all inherited G25/TD5.

Next high-value group: reconcile remaining Board/Whiteboard saved content history across multiple tabs/users and perform conflict-aware resolution with genuine server revision/sequence gates, then cross-tool review/QA/Project provenance and G25 closeout ledger. Use the existing saved Card and Whiteboard operation history; no competing history store. Tie visual polish to affected UX and test keyboard/density. Preserve per-tool permissions/privacy and edits/drafts while conflicts are unresolved.

Open limitations: 128-slot sequential availability verification needs Node24/live PostgreSQL latency and transaction-contention profiling. No automated recurring renewal, no unlimited future guarantee. Runtime certification remains deferred until after TD7. Library/Review/Transfers/Packages belong to G26, Admin/People/Widgets to G27 and CD reconciliation to G28.
