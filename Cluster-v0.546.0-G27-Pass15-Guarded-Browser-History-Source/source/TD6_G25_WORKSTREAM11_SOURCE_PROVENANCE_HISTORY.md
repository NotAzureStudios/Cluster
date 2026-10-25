# Cluster TD6 G25 · Workstream 11: exact source provenance, QA evidence and collaborative history ownership

**Direct parent:** `Cluster-v0.546.0-TD6-G25-Workstream10-Whiteboard-Merge-Release-Gates-Source.zip`.  **G25 remains OPEN**. This is an additional source implementation checkpoint, not a production release or a live multiuser acceptance result.

## Shipped source behavior

1. **Release source review provenance gate (CD-10 / CD-18).** A Build that references a Source review cannot be released until the *live* matching project/repository review is `merged`, and its `mergedRevision` matches the Build's `sourceRevision` exactly. `status: open`, an unmerged approval/comment, an unrelated repository, a changed commit, or missing review fails closed. The gate is a mandatory core release gate for such Builds. It cannot be waived by optional policies/exceptions, and reaches Project status, Project closeout, and release publication through the existing lifecycle snapshot. Builds without a Source review retain their former release gate set.
2. **Historical deletion protection.** `DeliveryBuild.sourceReviewId` has a nullable FK with `SetNull` on deletion. The already captured `DeliveryBuild.sourceSnapshot.reviewId` is checked as additional binding evidence; deletion cannot silently erase the review gate. Mismatched live/captured IDs block release. No schema migration is needed.
3. **QA contradictory evidence fails closed.** Read-side source snapshots no longer regard `passed`/`go` as passing when there are positive failed or blocked case counts or a no-go decision. Build QA roll-up includes the case counts, and release publication independently queries for failed/blocked cases before it writes. Existing QA session validation still rejects contradictory new writes. This defends against historical inconsistent rows and alternate writers.
4. **Accurate release UI.** Project Delivery header now prioritizes the **number of blocking gates** instead of saying `0 open fixes` when the actual blocker is missing provenance, QA, a review or a hold. Existing detail controls reveal the specific gate and navigate to permitted resources.
5. **Shared Undo ownership and offline guard (CD-03 / CD-19).** Card-editor window shortcuts are only active when the Card editor owns focus. Whiteboard shortcuts only act inside the Whiteboard workspace, never an unrelated modal; browser text editing retains Ctrl/Cmd+Z. Server-backed Card saved Undo/Redo is disabled during queued, failed, paused, syncing or conflicted Card mutations or while offline, with an explicit explanation; all commands still obey the existing server-side revision/permission guard. No universal Undo is claimed and irreversible work remains out of scope.

## Exact source changes

- `apps/server/src/domains/projects/project-delivery-lifecycle-service.ts`
- `apps/server/src/domains/projects/project-delivery-service.ts`
- `packages/renderer/src/features/projects/ProjectDeliveryLifecycle.tsx`
- `packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx`
- `packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx`
- `packages/renderer/src/features/whiteboards/whiteboard-history-shortcuts.ts`
- Tests: new `tools/scripts/cluster-td6-g25-ws11-release-provenance-tests.mjs` and updated historic keyboard expectations.

## Verification and nonclaims

The WS11 checks exercise **actual transpiled lifecycle snapshots**, including missing/wrong-revision/foreign/unmerged/deleted reviews, inconsistent QA evidence, and publication preflight, plus source-level renderer guard checks. Inherited G25 and TD5 source suites continue passing. Existing Windows/Node24 PostgreSQL / Qt runtime certification remains **not executed**. No Prisma migration or native executable changes in WS11. Source scans are static, not a substitute for authenticated browser/real-db tests. Build and release queries are still vulnerable to *real* concurrent changes between read preflight and commit and must be exercised in the final transaction/DB certification, not asserted atomic here.

## Remaining before G25 source closeout

- Cross-editor durable history beyond current supported operation families, conflict/resumption proof across actual multiuser browsers, and verification of cross-editor object life cycle. Keep a strict supported/unsupported Undo list rather than implying universal Undo.
- Audit project source/QA/review link validity and approval gates end to end using live PostgreSQL and real permission changes (runtime acceptance remains deferred by roadmap).
- G25 CD reconciliation to determine if any high-impact feature gaps remain. G26 focuses Library/Review/Transfers/Packages; G27 Studio Operations and interface; G28 final feature reconciliation, then TD7 and separate runtime certification.
