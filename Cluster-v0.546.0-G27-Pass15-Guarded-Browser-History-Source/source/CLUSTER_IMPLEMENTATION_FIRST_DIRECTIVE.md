> **TD5 CLOSEOUT + TD6 G21 (October 19, 2026):** TD5 source implementation is reconciled as closed (14 source suites, 167 passing cases) without claiming platform certification; inherited P12 mock/count drift repaired. TD6 G21 implements per-occurrence recurring Meeting RSVP/attendance with per-row revision guards, safe API/UI, bounded queries, and recurrence-specific reminder eligibility. CD-11 remains source-partial. Source roadmap `IMPLEMENTATION_ROADMAP_TD6_G21.md`; next G22 grouped feature work; TD7 then full certification.

> **TD6 G07 current checkpoint (October 18, 2026):** Cross-tool UX adds revision-protected Studio announcement content editing, advisory live audience count, safe draft duplication, and canonical Copy ID in Search/work actions. The updated `TD6_G07_CD01_CD20_FEATURE_LEDGER.md` keeps CD-01–CD-20 open where unfinished code remains. Continue grouped G08+ feature implementation, TD7 cleanup afterward, and runtime certification last.

> **TD6 G06 current checkpoint (October 18, 2026):** Grouped Admin/Calendar/Communications implementation adds scheduled and cancellable announcements, atomic durable Inbox activity publication, strict audience eligibility, owner-only Calendar reminders, and Operations schedule visibility. No broad Calendar attendees fanout or full OOBE/config completion is claimed. Continue G07 cross-tool usability and CD-01–CD-20 source feature closeout; code first, TD7 next, full runtime certification last. See `IMPLEMENTATION_ROADMAP_TD6_G06.md` and `TD6_G06_TO_G07_HANDOFF.md`.

> **TD6 G05 current continuation (October 18, 2026):** grouped Package/Desktop/native dependency work is source-implemented. Signed exact-version prerequisite manifests, graph-wide live recipient entitlement filtering, native selected-content preflight, Desktop and admin requirements visibility, and read-only blockers are in G05. Do not describe this as actual OS software installation or completed CD-08: supervised installers, elevation/uninstall and verified OS activation remain open. G06 Admin/Calendar/Communications/OOBE is next. Feature code first, full runtime certification last. See `IMPLEMENTATION_ROADMAP_TD6_G05.md` and `TD6_G05_TO_G06_HANDOFF.md`.

> **TD6 G03 grouped checkpoint (October 18, 2026):** Packet recipient delivery was separated from Library source authoring. Immutable detached downloads now have durable issuance receipts with permission-scoped, paginated admin evidence. Recipient view does not load Library source records, while authors retain existing editors, version controls, bulk operations, retention and media. G03 supersedes G02; advance to G04 (Projects/Boards/Whiteboards/Builds/QA) as a grouped implementation. Focused regressions remain mandatory and full release/runtime certification remains deferred. See `IMPLEMENTATION_ROADMAP_TD6_G03.md` and `TD6_G03_TO_G04_HANDOFF.md`.

> **TD6 G02 grouped checkpoint (October 18, 2026):** Digital seat issuance/renewals and commercial key assignment now use independent review, transactional Inventory authority, and Inbox notifications. Admins can reconcile a person’s Inventory, Package and direct Project access plus offboarding custody without merging their permission systems. G02 supersedes G01. Continue with G03 Library/Packet/distribution as a substantial grouped implementation. Focused source tests mandatory; full runtime certification remains deferred. See `IMPLEMENTATION_ROADMAP_TD6_G02.md` and `TD6_G02_TO_G03_HANDOFF.md`.

> **Current grouped development instruction (October 18, 2026):** Combine related unfinished workflows into major implementation batches. TD6 G01 groups Inventory digital seat expiration/renewal, key leases and disclosure evidence, People offboarding physical custody, and admin/recipient UX. G01 source is the successor to F11. Start G02 as a multi-workflow batch, not a micro-pass. Full runtime certification remains deferred; see `IMPLEMENTATION_ROADMAP_TD6_G01.md` and `TD6_G01_TO_G02_HANDOFF.md`.

> **TD6 F11 added (October 18, 2026):** Implemented separately governed per-person Package recipient entitlements. A signed rollout/device pin no longer authorizes recipients without an approved, unexpired individual grant. Two-admin review, revision-qualified extension, revocation and audit are source-implemented; Inventory custody/seat/key workflows continue in F12. Focused tests mandatory; full runtime certification still deferred.

> **TD6 F10 added (October 18, 2026):** Governed Project-level personal Access Rule grants and extensions, independently approved in Studio Settings, with finite expiry, denial/ceiling protection, confidential evidence and no direct profile/rule elevation bypass. Inventory, Package and Library source entitlements remain separate F11+ work. Focused development tests remain mandatory; full runtime certification deferred.

> **TD6 F09 added:** access renewals and automatic expiry notices are source-implemented; implement F10 grants/entitlements next. Do not pivot to full runtime certification before required feature code.

# Cluster standing development directive — October 17, 2026

**User priority (authoritative for subsequent source-development passes):** Finish the unfinished Cluster 1.0 feature and integration code **before** spending time on live runtime/release certification. The user explicitly requested to defer comprehensive runtime testing and prioritize incomplete work.

## Execution order

1. **TD6 first: source-implement unfinished user workflows.** Select coherent slices from CD-01 through CD-20, preserve the complete Feature Ledger, and connect backend, permissions, renderer, background jobs, Desktop code, and user-visible actions where relevant. Do not substitute an audit/checklist for actual implementation.
2. **TD5 selectively:** Make required infrastructure/native source changes when TD6 depends on them or when a definite source defect blocks progress; do not consume passes on test-environment setup as a default next step.
3. **TD7:** Once the required source destinations are implemented, retire genuine obsolete contracts, simplify conflicting code, and freeze the source tree.
4. **Certification after implementation:** Defer full Node 24 dependency-backed compilation, disposable PostgreSQL migration and multi-process verification, Windows/Qt/native execution, SMB/NAS/S3/provider testing, performance soak and release acceptance. They remain tracked in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` and **are NOT claimed complete**. Focused automated source/unit/regression checks continue for each code slice.

## Hard safety boundaries, even while certification is deferred

- Do **not** enable physical Library destruction, automatic managed-blob garbage collection, quarantine execution, or tier migration without independently verified storage fencing, provider evidence and rollback/recovery. Do not claim Windows/native/package installation is certified.
- Preserve canonical permission/identity checks, data privacy, Studio/Project/Library boundaries, idempotency and background-work ownership. Avoid compatibility scaffolding: Cluster has no active production instances.
- Do not drop committed features or call a phase complete from a few green source tests. Source-complete and runtime-certified remain separate states.

## Current start point

- Parent archive: `Cluster-v0.546.0-TD5-P13-Committed-Job-Outcomes-Source.zip`.
- First implementation-first slice: **TD6 F01 — Forms conditional branching**, including author UI, published schema constraints, shared evaluator, respondent UI and private/public server submission projection.
- Remaining priority candidates: CD-01 Forms assignment due dates/reminders and deeper authoring; CD-03 persisted collaboration-safe undo/review; CD-07 original media derivatives; CD-08 native managed Package activation/rollback; CD-04 People/Access lifecycle; CD-10/11/14/15/16/17/18/19/20 feature integration. Pick by coherent end-to-end payoff, not by arbitrary pass count.

**Next-chat reminder:** Start with source changes for unfinished TD6 work. Do NOT automatically return to TD5 P14's historical 'provision PostgreSQL/Windows test environment first' instruction. That sequencing was superseded by the user's October 17, 2026 directive.

## Continuation after TD6 F02 (October 17, 2026)

- **TD6 F02:** Published Form deadline controls (advisory local-time editor → stored UTC instant), due-soon/overdue reminder opt-in, durable recipient/stage/version claims, periodic job integration, permission/active-account/completion rechecks, respondent deadline status, and admin delivery-summary projection are implemented in source.
- The Form recipient model remains **published audience membership**, not a new per-person assignment engine. Public applications are explicitly excluded from deadline delivery.
- F01 conditional branching and respondent drafts remain preserved. CD-01 is substantially source-implemented but is not runtime-certified or declared completely finished.
- Next feature implementation should move to substantive TD6 remaining work, especially CD-03 collaborative operation history/reviews, CD-07 protected media derivatives, CD-08 native managed Packages, or CD-04 People lifecycle. **Do not automatically jump back to TD5 runtime preflight.**
- Reminder event-to-Inbox dispatch is retry-safe at source level with stable group keys; an abrupt crash between publishing activity and marking the claim sent can still produce another activity event. Full message-level exactly-once certification is not claimed.

## Continuation after TD6 F03 (October 17, 2026)

- **F03:** Board Cards now have atomic per-Card saved metadata operation history, an actor-and-revision-guarded server Undo/Redo, and integrated saved-edit controls/history in the Card editor. Previous unsaved draft Undo and conflict review remain intact.
- It does **not** magically create universal Undo: Card movement, checklist/comment changes, deletion, Whiteboard inverse operations, and oversized cover-image revisions are not reversible through the new endpoint. CD-03 remains **in progress**, not source-closed.
- F03 tests and source scans passed. Dependency-backed compilation, Prisma migration on a live DB, authenticated multi-editor browser/Qt behavior, and Windows runtime remain **deferred**, not certified.
- **Next priority:** Continue TD6 feature implementation, preferably persisted safe Whiteboard Undo/Redo (F04) or next highest-impact unfinished CD destination. Do not fall back to endless TD5 setup passes.

## Continuation after TD6 F04 (October 17, 2026)

- **F04 source-implemented:** Author-scoped saved Whiteboard Undo/Redo for a bounded reversible element-operation subset. Canonical server history snapshots and sequenced internal reversal operations replace offline-queued client-constructed inverse replay; current authorization, same-target conflict, history gap/compaction and revision guards remain mandatory.
- **CD-03 is still open**, not universally complete: delete/create/settings/snapshot restoration, richer collaboration review, multi-step overlapping history, Card movement/checklists and approvals remain in the Feature Ledger.
- **Next default priority is TD6 F05 / CD-07 protected Packet PDF/image/media derivatives**, followed by CD-08 managed Package deployment and CD-04 People access/lifecycle. Do not return to TD5 live runtime setup by default; certification stays explicitly deferred.

## Continuation after TD6 F05 (October 17, 2026)

- **F05 source-implemented:** Protected PCM WAV audio previews added to Packet derived delivery using the original immutable source manifest/Library authorization, pure-TS bounded parser and decoder, 8-second metadata-free preview, and frozen-audience recipient download and ZIP integration. Existing PDF/image/text adapters remain unchanged in scope. No direct source file grants.
- **CD-07 remains open:** MP3/AAC/FLAC/video/full-fidelity audio delivery, background conversion policy and retention require substantial feature development. F05 is a coherent source slice, not full CD-07 completion.
- **Next preferred TD6 F06:** CD-08 managed Package deployment/update/rollback integration, then CD-04 People/Access lifecycle. Keep substantive unfinished code ahead of comprehensive runtime certification.

## Continuation after TD6 F06 (October 17, 2026)

- **F06 source-implemented:** Managed Package read-only native update plans classify additions, existing exact matches, tracked upgrades, untracked collisions, local modifications and interrupted operations, with Desktop conflict details. Guarded native sync rejects normal conflicts before opening a backup journal; tracking/journal symlinks are rejected.
- **CD-08 still open:** This is an unprivileged, verified file-content deployment/rollback foundation. It is **not** supervised OS installation or attestation. Full native installer work, dependencies, system-level rollback, and proper install-state verification remain.
- **Next default priority is TD6 F07:** Continue CD-08 Package install/update/rollback source if safe, otherwise CD-04 People lifecycle. Do not switch back to TD5 live platform certification by default.

## Continuation after TD6 F07 (October 18, 2026)

- **F07 source-implemented:** Explicit read-only `audit-files` checks signed and currently selected managed Package releases against tracked destination ownership, identifies missing/modified/current/untracked/retired files, and publishes bounded results through Qt to a new Desktop UI action. A saved `lastUpdated` preference is not silently treated as integrity or install evidence.
- **CD-08 remains open:** These are content-file checks, not system software installation, version/dependency enforcement or OS attestation. No native executable execution or unattended updates were enabled.
- **Next default priority is TD6 F08 / CD-04 People and access lifecycle source completion.** Do not return to TD5 runtime certification as the default next task.

## Continuation after TD6 F08 (October 18, 2026)

- **F08 source-implemented:** Completed offboarding cases can be returned to active People directory through an explicit authorized review, a revision-guarded transaction and confidential return Personnel Record. The account remains `DISABLED` until separately provisioned; old credentials, sessions and scoped grants never reactivate automatically. The original Person/user ID and offboarding evidence remain intact.
- Account/profile shortcuts that could bypass offboarding/return are now blocked, including archived/expired admin credential issuance and Discord callback checks. The People UI directs admins to governed return instead of toggling `archived`.
- **CD-04 is still open** for engagement expiry, renewal, time-boxed grants, comprehensive onboarding/offboarding and entitlement transitions. Do not count return-to-studio as completing People lifecycle.
- **Next TD6 F09:** Implement a coherent expiry/renewal workflow or the next highest-value open source feature; comprehensive runtime/platform certification stays deferred.

## Grouped development checkpoint G04 (October 18, 2026)

Project release publication now uses canonical Delivery Lifecycle readiness instead of relying on only QA/approval fields. Hard minimum gates preserve Board fix, QA/retest, and Project hold evidence, reviewer approval is independent and Build-revision-pinned, and bounded evidence fails closed. Continue grouped batches G05–G07 before TD7 and final runtime certification. See `IMPLEMENTATION_ROADMAP_TD6_G04.md`.

TD6 G08: keep grouped feature implementation-first. Calendar recipient/recurrence code shipped as a source checkpoint; Calendar/Communications requirements remain open until full workflow completion, not after a single pass. Next G09 OOBE/configuration/Help.

## TD6 G09 grouped checkpoint

Setup guidance, per-Owner recovery readiness, selective safe configuration previews and explicitly reviewed prior-value restoration are implemented in the source. Global Help, broader configuration templates and full guided OOBE remain open; proceed to G10 and CD feature closeout before runtime certification.
