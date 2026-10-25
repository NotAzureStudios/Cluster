# TD6 G25 Workstream 12: concurrent Card set merge and private Whiteboard recovery

**Source baseline:** `Cluster-v0.546.0-TD6-G25-Workstream11-Review-Provenance-Offline-History-Source.zip`. G25 is still source-open; do not label this a final source/runtime certification.

## Connected fixes

1. **Card collaboration:** `board-card-conflict-resolution.ts` now reconciles label and member membership independently against the exact opened Card baseline. Disjoint additions survive both directions, one editor's deliberate removal is not overridden by the other's unchanged copy, set-order/spacing does not create false conflicts, and server list order is retained before local additions. The UI explains the semantics. Other changed scalar fields still require explicit per-field Keep mine/Use server choices; the merge stays local until a revision-guarded save succeeds. No new server write route was introduced.
2. **Whiteboard privacy + offline recovery:** The previous browser-wide `cluster-whiteboard-recovery-<whiteboard>-v196` key could surface another account's local canvas recovery in a shared workstation/browser profile. `whiteboard-recovery-identity.ts` now creates a namespace from **both the authenticated user ID and Whiteboard ID**, with no anonymous or legacy shared-key fallback. Reads are deferred until user identity exists; stored record identity is checked, and save/recover/delete paths use the same helper. The UI never claims the private copy was stored when no identity is available. Historic unscoped browser data remains unread by this updated UI, but is not physically erased by this workstream.
3. **Source trust and UI:** No optimistic server-overwrite, stored-draft cross-account fallback or new content-history engine. Account scoping is browser UI isolation, **not** encryption or protection against someone with direct access to browser storage. Existing permission checks and server sequence/revision guards remain authoritative.

## Tests

- `npm run cluster:td6:g25:ws12`: new 11-case focused suite, inherited Card conflict cases, Whiteboard series/recovery and source scan.
- `npm run cluster:td6:g25`: G25 inherited suite, with WS12 integration.
- `npm run techdebt:td5:source-closeout`: TD5 14 scripts / 167 cases.
- Source scan: TypeScript/TSX syntax, renderer imports, CSS bracket balance. These are **not** dependency-backed TypeScript builds or real browsers.

## G25 closeout work still open

Audit server-backed Card/Board/Whiteboard history **across accounts and restarts**, including interruption between operation commit and acknowledgment, retargeted permissions, conflicting queued replays, stale WebSocket/SSE revisions, and bulk/reorder reversibility. Review Project/QA/Source/Form evidence transitions together rather than trusting individual endpoint tests. Once these are source-satisfied, authorize G25 closeout, then start G26 Library/Distribution. G28 is feature-ledger reconciliation, TD7 is final technical cleanup; live PostgreSQL/Node24/Windows Qt and multiuser certification remain separate.
