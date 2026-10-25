# TD6 G26 Workstream 2 | Version-bound Media Review, explicit follow-up work

**Checkpoint:** Cluster v0.546.0 · TD6 G26 WS2. Parent G26 WS1. G26 remains **source open**; G25 remains source-closed. No live runtime certification claim.

## Implemented

### Media approval and audit

- `apps/server/src/domains/media/review-decision.ts`: version/revision/actor eligibility and optimistic compare-and-swap guards. A request requires an exact `reviewAssetId` from the URL, integer version number and observed `updatedAt` timestamp; unauthorized/unassigned, old/superseded, changed and archived versions are refused. Changes-requested requires a nonblank reason.
- `review-routes.ts`: `POST /api/review-assets/:assetId/decision` commits `approvalState` and a durable `ReviewAssetDecision` row in one serializable transaction. Actor, committed timestamp and source checksum are taken from the server, not the client. Database CAS includes current assigned reviewer, version number, revision, supersession and live status. Distinct `GET /decisions` is view-authorized and returns bounded version-specific evidence (no direct source media access). Concurrent updates/serialization conflicts return 409.
- Metadata PATCH is strict and cannot assign approval/approval author/time nor rewrite version group, version number or supersession. New uploads begin `pending`, including uploads that ask to start in an approved state. Existing automatic version supersession remains a server-owned operation. Review assignments still use the managed metadata path and notify assigned reviewers. Outcome decisions notify the uploader through existing `videoReviewUpdateNotification`; a failed notification does not falsely invalidate a committed decision.
- Prisma migration `20261028000000_td6_g26_review_decision_evidence` adds indexed, per-asset immutable decision evidence with a **restrictive** FK. The destructive ReviewAsset delete route blocks deletion of retained decisions, with FK conflict handling for concurrent arrivals. Archive preserves the source/evidence and is the default Project Video UI action.

### Deliberate Review → Project work

- `POST /api/review-comments/:commentId/materialize` now requires `destinationBoardId` and `destinationListId`; both must be active in the correct Project and pass Board contribute authorization. No implicit Board/List creation; no fallback path.
- Serializable database transaction verifies destination remains active, creates the correct `Card` or Ticket (`ticketStage = new`), atomically claims the review note, and saves both `materializes_as` and `originates_from` relations against exact media version. A competing note claim or failed relationship creation rolls back the Card. Existing linked work is returned idempotently. The G25 List admission trigger remains authoritative during concurrent archival; PostgreSQL concurrency still needs live testing.
- The existing Project Video Ticket destination picker now applies to **both** review-note follow-ups and production-session follow-ups, so no new picker or background discovery path was added.

### UI/UX (CL-DS-001 v1.3 external reference)

- Viewer Review inspector shows exact asset/version decision status, reason input (required for changes), an on-demand bounded decision history, committed actor and timestamp, and reload-on-CAS-conflict guidance. Inspectors use their existing theme tokens and a flex layout to retain actual note-scrolling room at desktop and narrow widths.
- Project Video workbench uses the same version-bound endpoint and explicit source status feedback, and archives media rather than hard-deleting reviewed evidence. Approval does not occur through ordinary metadata editing.
- UI data uses server responses, not fabricated local success. Cross-viewport/browser/Qt rendering was **not** executed.

## Verification actually executed

- New `node tools/scripts/cluster-td6-g26-review-decision-destination-tests.mjs`: **26/26** tests. Includes authorized/denied managers and assigned reviewers, stale version/revision, supersession, reason requirement, server-owned actor/checksum, decision rollback and competing CAS, evidence-retaining delete, authorized decision-history projection, missing/archived Board and List, project authorization, transaction rollback on provenance error, double materialize, explicit Ticket stage, and both UI request contracts.
- Inherited `npm run cluster:td6:g26:ws1`: **24/24** new WS1 cases and source scan.
- `npm run cluster:0533:library-closeout`: **30/30**; `npm run cluster:0529:library-admin`: **13/13**; Packet delivery **14/14** and watermark/transfer **9/9** (media encoder mocked); source review workflow **17/17**.
- `npm run cluster:td6:g25:ws17`: pass; `npm run cluster:td6:g25:ws14`, `:ws15`, `:ws16`, `:ws17`: individually passed. `npm run techdebt:td5:source-closeout`: **14 suites, 167/167 cases**.
- Full `npm run cluster:td6:g25` exceeded 180 seconds after reaching WS13. Its finished checks to that point were green, but **the full uninterrupted aggregate is not claimed passed**.
- `node tools/scripts/cluster-td6-source-scan.mjs`: **1,083** TS/TSX files, **3,210** relative renderer imports, **110** CSS, **0** syntax/import/brace errors.

## Open G26 / runtime risks

1. Ensure generated Prisma client and full Node 24 build accept the new relation/SQL and route signatures; migration has **not** been applied to PostgreSQL. Verify real transaction timing, racing versions, List archival and FK `RESTRICT` under load.
2. Media review currently has a single assigned reviewer, not a full invite/acknowledge multi-reviewer quorum or reviewed/seen receipt system. In-app assignment notifications exist; opening/viewing is **not** a recorded completion or approval. Version family creation authorization and history retention/erasure remain a G26 audit item.
3. Packet recipients, signed/watermarked publication, Library bulk/retention, streamed transfer resume, Packages/Inventory/Vault and native distribution remain G26 work. No source-complete or release-ready declaration.
4. Media encoding, actual browser download completion, desktop/Qt native, multiple authenticated clients, accessibility viewports, deep-link destination restoration and permissions changing mid-transaction are **NOT certified** here.
