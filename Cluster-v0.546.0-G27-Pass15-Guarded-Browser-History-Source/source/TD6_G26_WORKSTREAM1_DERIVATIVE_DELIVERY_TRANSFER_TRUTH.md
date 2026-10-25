# TD6 G26 Workstream 1: Version-bound derivatives and transfer-state truth

**Source checkpoint:** Cluster v0.546.0, TD6 G26 WS1. Parent: G25 WS17 source-closed archive. **G26 remains open**. No live Node 24, Prisma-generation, PostgreSQL, browser, Windows or Qt certification is claimed.

## Source changes

### Library derivative authority (CD-02, CD-07, CD-20)

- Central helper `apps/server/src/domains/library/library-derivative-version.ts` gates a derivative on an identifiable, non-destroyed **current Library file source** and matching SHA-256; ready, uninvalidated and stored-byte conditions are additional requirements.
- `library-9e2-routes.ts`: derivative list marks prior-version output `stale` and removes its usable `fileUrl`. Direct derivative file delivery refuses an old version with explicit 409. Both list and file routes honor the existing copyright resource hold after Library ACL verification. Authorization-sensitive streaming now sends `Cache-Control: private, no-store` rather than year-long immutable caching on a URL whose access grants can change.
- `library-derivative-file-safety.ts`: existing derivative storage roots, parent folders and files must be regular managed paths with no symlink/junction traversal. The root and final file are resolved canonically before a stream is returned. **This does not prove race-free descriptor ownership against a privileged host filesystem adversary**; test native storage and mutable filesystem races separately.
- `media/viewable-resource.ts`: the unified Viewer uses the same derivative eligibility predicate as REST delivery. No old proxy is promoted to preferred playback.
- `library-9e2-jobs.ts`: guarded `previewText` updates cannot overwrite a newly published source revision; worker rechecks current source revision and checksum immediately before each derivative database publication and drops stale work. In-flight filesystem changes must still be assessed under real workers; delivery is independently version-gated.
- Library inspector displays 'Previous file version', counts current ready derivatives only and explains rebuild semantics. Source checksums and saved history are not mutated on a client-side preview state.

### Transfer Center (CD-13, CD-19)

- `packages/renderer/src/features/shell/transfer-progress-summary.ts` classifies only pending/uploading browser jobs and queued/running/verifying desktop jobs as active. Failed and manually paused transfers have separate counts.
- Aggregate progress is **unknown**, not guessed, if any active job lacks dependable byte totals (including browser uploads). For fully measurable desktop jobs, progress is byte weighted and clamped. Verification is distinguished from byte delivery and completed/cancelled jobs are excluded from the active denominator.
- The existing taskbar surface adopts these counts and descriptions; no new polling or duplicate state store is introduced. Browser downloads remain browser-controlled handoffs, not falsely attributed successful deliveries.

## Executed evidence

- `node tools/scripts/cluster-td6-g26-library-derivative-version-tests.mjs` — **16/16** checks, including delivery handler execution with an authenticated Library route harness, revoked ACL, copyright hold, wrong source checksum, symlinks and shared Viewer behavior.
- `node tools/scripts/cluster-td6-g26-transfer-summary-tests.mjs` — **8/8** weighted-progress and lifecycle-state checks.
- `npm run cluster:0533:library-closeout` — **30/30**; `npm run cluster:0529:library-admin` — **13/13**.
- `node tools/scripts/cluster-td6-g03-library-packet-delivery-tests.mjs` — **14/14**; `node tools/scripts/cluster-td6-g10-packet-watermark-transfer-tests.mjs` — **9/9** (mocked media encoder).
- `npm run cluster:td6:g25:ws17` — passed; `npm run techdebt:td5:source-closeout` — **14 suites/167 cases**.
- `node tools/scripts/cluster-td6-source-scan.mjs` — 1,082 TypeScript/TSX, 3,210 relative renderer imports, 110 CSS; no syntax/import/CSS brace errors.
- `npm run cluster:td6:g03` does not exist in package scripts. Its actual named test file was run directly and passed. This invocation issue is not a product regression.

## Design change record (CL-DS-001 reference)

Problem: prior-version previews looked ready, could be served through stable URLs, and Transfer Center treated paused/failed jobs as active or displayed misleading partial percentages. Existing owners remain the Library inspector, unified Viewer and taskbar Transfer Center. New UI uses existing styles and buttons rather than a separate component system. Ready vs stale and moving vs paused/error/unknown distinctions are visible without requiring users to inspect logs. File source identity remains authoritative server-side; no optimistic client signal confers review/download permission. Desktop/mobile layouts are not independently rendered in this source-only environment.

## G26 remaining work

1. Recipient-bound Packet and Library release evidence; version-specific review/approval and source-safe derivative distribution; privacy/minimal metadata; watermark settings and output integrity under real encoder.
2. Broader Library bulk selection/permissions/retention and scalable inspector/media stages, folders, collection operations, and import/download receipts.
3. Durable upload streaming, pause/resume/cancel and actual byte evidence, quota, offline/stalled recovery, idle request volume.
4. Packages, managed native staging, install/rollback and Library/Inventory/Vault distribution/entitlement controls.
5. Full browser, Node 24, PostgreSQL, Windows/Qt native, media rendering and permission-change load certification remains deferred separately.

Do not mark G26 complete from WS1. Do not reopen source-closed G25 for optional cosmetic rework.
