# Cluster TD6 G25 WS12 → remaining G25 source-closeout handoff

Canonical: `Cluster-v0.546.0-TD6-G25-Workstream12-Card-Set-Merge-Private-Whiteboard-Recovery-Source.zip`; parent WS11. **G25 OPEN**.

Preserve: Card set-membership 3-way merge of labels and member IDs (independent operations, deliberate removals, explicit scalar conflicts); account-specific Whiteboard recovery key and deferred auth-dependent read; no anonymous/unscoped fallback; online server-revision validation on any merged save. Preserve G25 WS1–11 Form, Calendar, Ticket, QA and Source review gate invariants, as documented in existing handoffs.

Tests: `npm run cluster:td6:g25:ws12`, `npm run cluster:td6:g25`, `npm run techdebt:td5:source-closeout`. No Node24 full dependency build, Windows/Qt launch, live DB migration or authenticated multiuser runtime testing was performed.

Next G25 objective: **one consolidated source closeout audit** of collaborative operation histories, queued/offline replay after conflicts and permission revocation, and Project/Build/QA/Review provenance. Repair confirmed gaps with tests; don't rewrite the durable history architecture. If source gaps remain, G25 stays open. Then G26 Library/Viewer/Packet/Transfer/Packages, G27 Operations/UI, G28 ledger reconciliation and TD7 cleanup, separate runtime certification.

Privacy limitation: account-scoped browser keys do not encrypt drafts and cannot delete obsolete old shared-key values reliably without an authorized migration. The new UI never reads them.
