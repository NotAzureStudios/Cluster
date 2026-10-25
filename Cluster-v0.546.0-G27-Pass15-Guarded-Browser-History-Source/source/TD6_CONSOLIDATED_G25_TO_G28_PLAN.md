> **Latest G27 Batch 7:** Durable Communications creation. Announcement Create/Duplicate uses persisted actor-scoped idempotency identities and content digests to recover ambiguous retries; admin listing does fresh authorized reads, no renderer caching. See `TD6_G27_BATCH7_DURABLE_ANNOUNCEMENT_CREATION_CLOSEOUT.md`. Migration required; G27 still active, runtime certification deferred.

> **Latest G27 Batch 6:** Canonical Communications authoring/discovery and cross-surface navigation. Admin announcement list is paginated/searchable with exact-record access; Command Palette and Global Create open canonical Studio authoring, Inbox recipient notices stay recipient-scoped. Details: `TD6_G27_BATCH6_SEARCH_CREATE_ANNOUNCEMENT_CLOSEOUT.md`. Source-level implementation only; G27 remains active and certification is still deferred.

> **Latest G27 feature checkpoint: Batch 4 (2026-10-22).** Member-facing onboarding now handles unavailable resources without stale ID/name disclosure, truthful error states, notification/Attention exact-assignment navigation, and on-demand self effective Tool access explanation. No parallel completion or authorization store. See `TD6_G27_BATCH4_MEMBER_ONBOARDING_ACCESS_CLOSEOUT.md`. G27 remains active; full real-runtime certification deferred.

> **Latest G27 feature checkpoint:** Batch 1 (Studio Configuration Recovery) implements reviewed revision rollback including removal of originally absent overrides, atomic import/rollback audit evidence, and connected Admin UI. Full real-runtime certification remains postponed, **not passed**. See `TD6_G27_BATCH1_CONFIGURATION_RECOVERY_CLOSEOUT.md`.

**Current grouped G26 source checkpoint (2026-10-22): Batch E.** Native Package destination ownership now globally serializes and blocks parent/child root overlaps; Inventory/Vault admin custody shows near-expiry evidence and Vault summary counts. **G26 remains OPEN, runtime certification NOT RUN.** See `TD6_G26_BATCH_E_ROOT_ISOLATION_EXPIRY_CLOSEOUT.md`, `TD6_G26_BATCH_E_TO_G26_CLOSEOUT_HANDOFF.md` and the `TD6_G26_IMPLEMENTATION_STATUS_LEDGER.md`.

**Current grouped G26 source checkpoint (2026-10-22): Batch D** implements native signed Package managed-file destination-wide locking, exact-folder cross-Package ownership refusal, full rollback-journal preflight, Desktop conflict UX, and bounded read-only Inventory/Vault key-custody inspection. **Not** a full Windows installer/repair/rollback rollout or provider-disposal certification; **G26 OPEN**, live tests outstanding. See `TD6_G26_BATCH_D_NATIVE_CUSTODY_CLOSEOUT.md` and `TD6_G26_BATCH_D_TO_G26_CLOSEOUT_HANDOFF.md`.

**Current G26 grouped source checkpoint (2026-10-22):** **Batch C** adds explicitly reviewed, additive hierarchy-wide legal holds and retention extensions (max 8 roots / 160 current items), revision-fenced Serializable all-or-nothing audit, and operator-only stale/conflicting provider-recovery assessments. It does NOT implement dynamic retention inheritance for future descendants, physical disposal, independent destructive approval or generation-fenced reconciliation. G26 remains OPEN, live certification NOT RUN. See `TD6_G26_BATCH_C_LIBRARY_RECOVERY_CLOSEOUT.md` and `TD6_G26_BATCH_C_TO_BATCH_D_HANDOFF.md`. Batch D priority: real native Package install/repair/rollback, Inventory/Vault authority join and remaining G26 source ledger closure.

**Previous G26 Batch B:** Package grants optionally require current Inventory license seat; effective recipient/device signed-release readiness inspection remains advisory. The migration `20261101000000_td6_g26_package_inventory_seat_binding` requires PostgreSQL application and Prisma generation. See `TD6_G26_BATCH_B_PACKAGE_INVENTORY_READINESS_CLOSEOUT.md`.

**Latest source checkpoint (2026-10-21):** G26 Grouped Batch A completes connected Packet author compliance operations: complete-release acknowledgment/overdue reporting, filtered bounded evidence, manifest-integrity exceptions, and paginated eligible-recipient selection beyond 500 accounts. Source implemented; **G26 OPEN; live certification NOT RUN**. See `TD6_G26_BATCH_A_PACKET_OPERATIONS_CLOSEOUT.md`. Remaining G26 scope is organized into grouped managed Package/Inventory/Vault/native and retention/provider-recovery batches.

**Latest source checkpoint (2026-10-21):** G26 Workstream 9 adds administrator-only additive bulk Library retention/hold governance, digest-fenced impact preview and atomic audit. G26 OPEN; see `TD6_G26_WORKSTREAM9_BULK_GOVERNANCE_CLOSEOUT.md`. No database migration or runtime certification.

**Progress update: G26 WS7** Source implemented explicit required Packet reminders, recipient-owned inbox delivery and privacy export v11. G26 remains OPEN for provider reconciliation, retention, Packages, Inventory/Vault and native distribution. Certification remains separate. See `TD6_G26_WORKSTREAM7_PACKET_REMINDER_PRIVACY_CLOSEOUT.md`.

> **Latest source checkpoint (2026-10-21):** G26 Workstream 6 adds explicit version-bound required Packet delivery assignments, privacy export/erasure evidence v10, and admin-only read-only upload recovery inspection. G26 remains OPEN; actual provider reconciliation, required-ack reminders, large-roster pagination, Packages/Inventory/Vault and native distribution are still outstanding. See `TD6_G26_WORKSTREAM6_REQUIRED_DELIVERY_RECOVERY.md`.

> **Latest execution update, 2026-10-21:** G26 Workstream 5 implements direct-object multipart DB claims, acknowledged-part row locks, non-destructive provider reconciliation states, manual/expiry disposition fencing and recovery quota accounting. G26 remains OPEN; see `TD6_G26_WORKSTREAM5_PROVIDER_FINALIZATION_RETENTION_FENCING.md`. This is source-tested and not live PostgreSQL/object-storage certification.

> **Latest execution update, 2026-10-21:** G26 Workstream 4 source implemented local streamed upload commit and state fencing, complete-file SHA-256 checked Library staging, paused/reviewable conflicts and preserved local/server upload evidence. G26 still OPEN; cross-node leases, direct-object multipart and cleanup contention, native package delivery and required Packet invitations remain outstanding. `TD6_G26_WORKSTREAM4_UPLOAD_COMMIT_RECOVERY.md` is the primary evidence.

> **Current execution update, 2026-10-21:** G25 SOURCE-CLOSED at WS17. G26 WS1 derivative/version and transfer summaries, WS2 review-decision version/provenance, WS3 recipient-attested Packet acknowledgments + privacy export v9 are implemented source checkpoints. **G26 still OPEN.** Older dates, checkpoint paths and "not implemented" notes below document the original plan, not the current runtime status. For newest implementation evidence see `TD6_G26_WORKSTREAM3_PACKET_RELEASE_ACK_PRIVACY.md` and `TD6_G26_CONTINUATION_HANDOFF.md`.

# Cluster v0.546.0 — TD6 Consolidated Closeout Plan (G25–G28) · v4

**Prepared:** 2026-10-20  
**Canonical current source for continued execution:** `Cluster-v0.546.0-TD6-G25-Workstream3-Project-Build-QA-Closeout-Source.zip` (G24 remains the original consolidated planning baseline)  
**Status:** Active TD6 scope baseline. G25 Workstreams 1–3 are implemented as separate source checkpoints; Ticket parity below is **required but not implemented** by this roadmap revision.  
**Priority:** Complete TD6 source implementation in three substantial workflow-aligned batches, reconcile the CD-01–CD-20 ledger in a fourth checkpoint, then TD7. Full Node24/PostgreSQL/Windows/Qt/provider certification remains subsequent to TD7.

## Outcome and working rules

The former estimate of 6–10 separate implementation passes is superseded **as a batching target**, not an engineering-effort estimate, by **G25, G26, G27 + G28 closeout**. A G-batch is a durable integration milestone, potentially spanning multiple work sessions. Do not manufacture new G-numbers for isolated fixes. A batch is closed when its committed source paths (data model, API/auth, UI, lifecycle, targeted regressions) are implemented, or each item has an **explicit, approved scope disposition**. Run relevant inherited checks before packaging. Do not treat static scans/mocked route tests as live runtime certification.

No rewriting older source history or wholesale architecture refactors. Reuse canonical permissions, revision/command, collaboration, resource-action/search, settings, storage/transfer and background-job services. Zero deployed production instances means compatibility shims are not a reason to retain obsolete routes. Preserve G01–G24 capabilities, including G23 atomic discussion history and G24 private revision-guarded drafts/read state/limited metadata Undo/Redo. Preserve TD5 source closeout, even though runtime acceptance remains deferred.

## G25 — Workflows, Collaboration & Scheduling

**Primary ledger owners:** CD-01 Forms; CD-03 Boards/Whiteboards/Work; CD-10 Projects; CD-11 Calendar/Scheduler; CD-18 Builds/QA.

Deliver as connected user journeys:

1. **Shared editing + review.** Expand operation-based, permission-aware undo/redo and conflict resolution from G24 discussion metadata into actual saved work mutations where safely reversible. Include offline/reconnect handling, approval/review transitions, per-thread unread/notification navigation, project discussion/Board/Whiteboard history and audited revision conflicts. Do not offer a universal Undo button for inherently irreversible actions.
2. **Work-to-Project lifecycle.** Connect Project identity and external-safe aliases, Cards and Whiteboards, dependencies, release/Build provenance, QA triage and Project closeout readiness; preserve standalone Boards/Whiteboards and actual Project-scope authorization. Advance Forms assignment/review/due-date journeys rather than merely revisiting form parsing.
3. **Calendar-to-Scheduler authority.** Complete individual recurrence occurrence move/reschedule and response semantics using canonical original-occurrence identity; atomically release/rebook rooms/resources and detect conflicts. Reconcile attendee notification/reminder changes and timezone/DST scenarios without creating a second Calendar store. Keep bounded recurrence queries and per-occurrence privacy rules.

**Gate:** Two-editor and two-tab revision conflicts, review/authorization negatives, saved-history Undo/Redo without erasing collaborators, recurring-event change with Scheduler resource collision, reminders after reschedule, and connected Build→QA→Project navigation. If some aspects require native integration, finish source wiring but record live-proof deferral.


### G25 required addendum — Ticket/Board parity and real triage (2026-10-20)

**Priority: P0; required before closing G25.** The official Cluster Studio Style Guide CL-DS-001 v1.3.0 requires Trello-like blank Boards to stay blank and Jira/Linear-like Tickets to have meaningful explicit intake, triage, ownership and traceability. This is an **expansion of G25's completion criteria**, not a new phase number. Owner explicitly accepts some schedule slip rather than shipping broken foundational behavior.

1. **Blank Board is genuinely blank:** creating a Board without an opt-in template creates no lists or Cards. Explicit Project/kanban/production templates can still prepopulate chosen lists. Both Board-creation surfaces, server API, and restored/reset flows must agree.
2. **Separate Ticket destination authority:** a new Ticket must not implicitly select the first/recent Project Board or create generic Board Lists. Exact user-selected Board/List, an explicitly configured per-Project Ticket inbox, or the clearly identified Studio Tickets queue are permissible destinations. Missing or ambiguous destinations return actionable errors; no opportunistic Board creation during failed ticket requests.
3. **Explicit Project/Board/List consistency:** a selected List must belong to the selected Board and Project; project scope cannot be silently switched by the server. Reject archived, inaccessible, disabled or done-only destinations appropriately, with fresh server authorization. Don't assume Ticket-create authorization permits Board administration.
4. **First-class triage outcome:** actionable New/Untriaged → Accepted/Working → Review/Resolved or equivalent *configurable* state model, with assignee/owner, priority/severity, Project scope, due date and clear next action. Ticket status is not inferred solely from arbitrary user-defined Board List names. Preserve basic/lightweight Boards without forcing ticket fields onto ordinary Cards.
5. **Safe interoperability and provenance:** Ticket links to the originating Card, Project, QA report, Build, source revision and related discussion where actual relationships exist; explicit linked Board projection, no clone or automatic unrelated Board mutation. QA evidence and Build blockers remain authoritative and feed Project closeout/readiness (Workstream 3).
6. **Usable Ticket UI:** All/triage queues, clear default destination, board/list picker when appropriate, visible missing-destination guidance, fast inline reassignment/status, reliable keyboard/focus/saved views, durable draft and post-create Open Ticket navigation. Separate locally queued from server committed; duplicate submissions coalesce.
7. **Lifecycle and governance:** archive/restore before destructive removal, correctly retained cross-tool links, permission-scoped activity/audit, exact filter/bulk-operation scope, and no silent automation reinstatement after an intentionally saved empty rule set. The confirmed automation defect MD-17 shares this gate.

**Required negative/positive acceptance tests:**

- Create default Board: zero lists, zero Cards. Explicit selected template: precisely configured Lists; no unexpected Ticket Lists.
- Create Ticket inside Project A while Board B is blank: Board B remains byte-for-byte unchanged. No silent Lists or Cards appear there.
- Multiple Boards or no suitable List: explicit destination/triage guidance; no fallback to `visibleBoards[0]` or first non-done List.
- Cross-Project Board/List mismatch, archived destinations, revoked access and duplicate clicks: reject without side effects.
- Projectless Studio Tickets remains an explicitly labeled queue with its own controlled authority; obey `ticketsRequireProject` and Ticket/Project permissions.
- Ticket from QA/Build retains provenance, permission-safe deep links and Project readiness gate; ordinary Board Card stays a Card.
- Save automation rules `[]`: restart and read still yield `[]`; no default ticket-label, approval or routing rules reappear.
- Compare triage actions in narrow, full-HD and wide workspaces, plus keyboard and degraded/offline behavior; keep last selection, context, and unsaved inputs.

**Scope control:** Do not build a second work engine, permanently couple Ticket state to arbitrary Board List names, or declare parity based on menu appearance alone. Prefer reuse of the existing canonical Card `workItemKind` and authorization/Activity/revision engines unless a concrete source invariant justifies a model change. No independent Ticket mini-app.

**Gate for the next source package:** implement canonical routing + empty Board contract first; then status/triage and Build/QA linkage, with UI and focused tests. G25 stays open until all required items have source evidence or an explicit agreed disposition.

## G26 — Library, Distribution & Desktop Deployment

**Primary ledger owners:** CD-02 Library; CD-05 Inventory/licensing; CD-06 Vault; CD-07 Packets; CD-08 Packages/Desktop; CD-09 Git/Unreal/Discord integration code; CD-13 Transfer Center; CD-20 Data/privacy/backup/retention.

Deliver as connected content + entitlement + distribution journeys:

1. **Authoritative assets and safe derived delivery.** Upgrade explorer, metadata, revisions, bulk lifecycle and select-all-matching UX; develop safe, permission-checked PDF/video/audio/media derivatives as the underlying adapters permit; watermark/metadata stripping and immutable delivery provenance. Published Packet recipients must never gain underlying Library-source access by entitlement alone. Keep legal holds, retention and source/recipient constraints authoritative.
2. **Durable high-volume transfers.** Unified streaming upload/download state, bounded memory/disk use, server/native checkpoints, pause/resume/cancel/retry, checksum verification, stale lease handling, multi-window progress, and recovery from interrupted sessions. Distinguish prepared/staged/installed states.
3. **Native installation lifecycle.** Package dependency planning; signed trusted archive verification; supervised authorized install/update/repair/uninstall; elevation and OS-level process supervision; crash recovery, receipts, staged application, policy and conflict-safe rollback across dependent Packages. Wire existing Go/Qt/native helper contracts without assuming an unchanged EXE provides capabilities its source doesn't build. Separate local attestation from server-issued trust.
4. **Entitlement and privacy closure.** Integrate Inventory seats, key reveal, scoped Vault references, offboarding/access expiry, key-reveal audit, Git/Unreal/Discord source-level contracts, privacy export/erasure and safe backup/retention state with those workflows.

**Gate:** Revoked recipient cannot get source or derivatives; expiry/revocation during transfer; malformed media isolation; interrupted large transfer resumes without duplicate/partial publication; signed package prerequisites + repair/rollback; no raw secrets in log/export; retention and legal hold block destruction. **Unsafe physical deletion and automatic storage cleanup remain disabled until real provider/concurrency/recovery certification.** Windows installer activation likewise remains gated by its own real-OS acceptance, even if source implementation is finished.

## G27 — Studio Operations & Unified UX

**Primary ledger owners:** CD-04 People lifecycle; CD-12 Shell/Appearance; CD-14 Search/navigation/actions; CD-15 Setup/config/recovery UX; CD-16 Notifications/communications; CD-17 Admin/Operations; CD-19 User-facing interaction quality.

Deliver as connected configure → onboard → work → operate → offboard journeys:

1. **People + operational access.** Finish application/approval/onboarding, multi-team engagement, temporary/delegated permissions and account expiry, recovery, offboarding custody and revocation, receipt/evidence workflows and accessible Admin views.
2. **First-run and studio administration.** Guided/quick/import/skip OOBE paths, a dismissible setup checklist, configuration diff/impact preview, nonsecret config bundles, revision rollback, Studio/Server/Tool settings ownership, inheritance and effective-permission explanations; useful operator diagnostics for jobs, services, resources and access failures.
3. **One shared interaction language.** Complete priority workspace coverage for resource actions, Command Palette, Search drawer, Copy Link/Path/ID where real, session navigation, favorites/recent, context-aware create-and-open, intent-idempotency, dirty/saving/error state, permission-denied explanations, Help and usable empty states. Preserve Comfortaa defaults, theme inheritance, user colors/presence, mobile layouts and UI identity.
4. **Communications.** Extend announcement and notification recipient/delivery authority, grouping/dedupe, per-tool preferences, quiet hours, deep-link access checks, schedules and severity overrides, while keeping Notifications/Actions/Announcements/System Alerts distinct.

**Gate:** Fresh account onboarding → configured workspace → invite/permissions → work → offboarding/revocation; double-click create once only; stale auth change immediately affects search/actions; config bundle contains no secrets; keyboard/focus/motion and 100/125/150% DPI source/UI review; notification replay and mute-policy tests. Release-grade native and E2E acceptance stay deferred.

## G28 — Mandatory TD6 Closeout and TD7 Entry

1. **Reconcile every CD-01 through CD-20** using the table below and the full small-wins ledger. For each: `Required for 1.0`, `Implemented source`, `Integrated UI`, `Focused regression`, `Deferred live certification`, `Explicitly deferred by user decision`, and source paths. A module cannot be called complete merely because one route or component exists.
2. **Resolve actual remaining code gaps and regressions** uncovered by end-to-end workflow reviews, including permission/notification/transfer/retention interactions across the three batches. This is legitimate source implementation, not a paperwork-only stage.
3. **Freeze 1.0 scope without silent omissions.** Optional third-party providers / advanced v1.1 features may be deferred only with an explicit documented decision, separate from required security and recoverability behavior. Preserve a list of any *unresolved* requirements rather than marking them completed.
4. **Prepare TD7 acceptance baseline:** source manifest, migration order, test commands, architectural fossil list, critical safety feature flags, unresolved runtime blockers and reproducible source archive. TD7 handles removal of confirmed dead scaffolding, consolidation and code hygiene, **not** abandoned TD6 features.
5. **Certification follows TD7:** pinned Node24 dependency-backed compilation and Prisma generation, fresh PostgreSQL migrations and rollback, multi-account browser tests, Windows native server/Qt/Go builds and process-tree shutdown, 100–150% DPI/mobile accessibility, real LFS/Unreal/Discord flows, NAS/NTFS/S3 recovery and load/latency/soak tests. Do not call any feature certified prematurely.

## Full CD-01–CD-20 primary ownership (no dropped categories)

| CD ID | Owner batch | Scope anchor |
|---|---|---|
| CD-01 | G25 | Forms assignment/review/drafts/reminders |
| CD-02 | G26 | Library collections/bulk/explorer/storage governance |
| CD-03 | G25 | Cross-workspace collaboration and reversible operations |
| CD-04 | G27 | People identity and lifecycle |
| CD-05 | G26 | Inventory/licensing/entitlement policies |
| CD-06 | G26 | Vault scoped secret use and safe rotation |
| CD-07 | G26 | Packet derivatives and distribution |
| CD-08 | G26 | Native managed Package install/rollback |
| CD-09 | G26 | Git/Unreal/Discord source integration; live proof later |
| CD-10 | G25 | Project planning/readiness/identity/closeout |
| CD-11 | G25 | Calendar recurrence/Scheduler coordination |
| CD-12 | G27 | Shell/appearance/UI parity |
| CD-13 | G26 | Transfer Center durable streaming lifecycle |
| CD-14 | G27 | Shared Search/Actions/navigation |
| CD-15 | G27 | Setup/config/recovery experience |
| CD-16 | G27 | Communications + notification policy |
| CD-17 | G27 | Admin/Operations actionable views |
| CD-18 | G25 | Builds/QA work pipelines |
| CD-19 | G27 | Interaction quality, Help and micro-behaviors |
| CD-20 | G26 | Privacy, retention, backup and storage safety |

**Shared responsibilities:** CD-16 notifications and CD-19 feedback integrate with G25/G26 features as they are implemented, not deferred entirely to G27. CD-20 authorization, retention, secret masking and privacy are applied within every batch, not only G26. G28 performs final reconciliation across all owners.

## Risks and stop conditions

- **Do not equate fewer labels with less work.** G25/G26/G27 are intentionally very large; allow multiple sessions inside each without generating a misleading "complete" package after a cosmetic slice.
- **Security/irreversible operations must fail closed.** No cross-user history overwrite, hidden Library source leakage, unsupervised native execution, unstaged revocation bypass, or physical unlink under unverified ownership.
- **Preserve previous investments.** G20 recurrence, G21 occurrence RSVP, G22 project discussions, G23 pagination/atomic Activity, G24 private drafts/read state are integration baselines, not to be reimplemented in parallel.
- **No bogus completion percentages.** Completion requires per-CD evidence, not raw file count, passing syntax scans or optimistic timelines.

## Immediate next execution (updated 2026-10-20)

Start **G25 as one sustained grouped workstream**, inspect the current source and tests, map shared collaboration/Calendar/Project primitives, implement the missing cross-system flows together, then update the G25 source ZIP, focused tests, migration(s), evidence and remaining ledger. Continue into G26 in the same conversation where feasible rather than requesting a new prompt at each micro-change. Keep this roadmap document alongside the canonical G24 archive for handoffs.

**Revision 2026-10-20:** Ticket workflow/Board parity added as mandatory G25 source closeout based on owner request and official style guide v1.3.0; current baseline is Workstream 3. No Ticket source changes are claimed by this revision.


---

## v3 addendum (2026-10-20): final selective CL-DS-001 v1.3.0 integration gates

**Source policy:** Official `CLUSTER_STUDIO_STYLE_GUIDE.md` version 1.3.0, retrieved from the user's Library. This addendum identifies product acceptance gaps **not sufficiently explicit in v2**. It does **not** claim that a source defect exists unless independently verified, that these features were implemented, or that an uncited external competitor behavior is authoritative. **No additional G-batch is created.** Existing G25 Workstream 3 remains the current source baseline until a verified replacement is packaged.

### G25 | Workflow correctness, capacity and context

1. **[Required, source-audit first] Allocation is explicit, not inferred from membership.** A person appearing on a Project/Team must not imply 100% allocation or filled capacity. Scheduler/Project/People views show real recorded availability and assignments, including unknown/unspecified allocation. Test a multi-Project person with zero recorded allocation, a partial allocation, and changing availability; do not fabricate utilization.
2. **[Required where workflow exists] One source-to-action handoff.** In supported Board, Whiteboard, Review, Ticket and Build/QA flows, a deliberate `Create Ticket/Action` or `Link to Work` operation carries the precise originating object, Project, permissions and relevant version or locator. It must not mutate the source object, invent Lists, or create unrelated work automatically. Audit existing cross-tool conversion before adding new UI. Test permission revocation, duplicate-click coalescing, deep-link accuracy and source context restoration.
3. **[Required] Real review/blocker semantics.** A comment, view or RSVP is not approval. A recorded `Changes requested`/failed-QA decision against a specific version remains visible to the release/Project readiness path. A new revision must not silently inherit approval. Preserve existing authoritative gates implemented in G25 Workstream 3; add only demonstrated missing transitions/tests.
4. **[Required] Intentionally empty means empty.** Extend the known MD-17 fix pattern beyond automation's persisted `[]` only when an audit identifies the same broken read/default semantics. Distinguish *unconfigured* from *configured but empty* for templates, rules, optional defaults and user-made structures. Tests must show that restart, refresh or new sessions do not recreate dismissed/default content. Do not assume an empty security-sensitive policy means unrestricted access.

### G26 | Review and delivery outcome

5. **[Required] Explicit media-review invitation and outcome.** An authorized reviewer must know what exact asset/version/time/page/region is under review, whether they have acknowledged/opened it, which decision was submitted, and whether that version is approved or changes-requested. Annotation alone is never a decision; subsequent revisions retain provenance without automatically inheriting approval. Confirm existing viewer capabilities before filling gaps. Test denied/revoked reviewer, revised asset after approval, offline draft versus committed decision, and recipient-safe derivative access.

### G27 | Reliable desktop work experience

6. **[Required, scoped] Offline typography and full-value access.** Audit licensed font distribution/fallback for disconnected web/Qt launches; Comfortaa identity is optional where it damages readability in logs/tables. Long paths, IDs, filenames and version identifiers must remain fully retrievable by copy, tooltip or inspector despite ellipsis. Verify native Back/Forward, project tabs and current filter/scroll/inspector state survive navigation without inventing parallel state stores. Test readable high-density modes and 100/125/150/200% Windows DPI in certification fixtures.
7. **[Required] Data scope and authority visible.** Where it changes user decisions, workspaces distinguish current/live, cached, offline-queued, read-only, unauthorized and partial-result states, using existing interaction contracts rather than a new status vocabulary. Security-sensitive mutation availability remains server-authoritative; a local optimistic acknowledgement is not a committed result.

### G28 | Evidence, not checkbox theater

8. **[Required] Add these precise user journeys** to the existing positive-parity matrix: a Project member with no implied capacity, empty Board and intentionally empty automations after restart, Whiteboard idea converted deliberately to a Ticket/Action, QA changes-requested blocking a Project release, reviewer decision retained against the exact media version, and offline large-font desktop navigation. Record separately `Source-Implemented`, `UI-Integrated`, `Runtime-Validated`, `User-Accepted` and link the code/tests. Do not mark latter two as complete until genuinely exercised.

**Already covered by v2 (not added again):** blank Boards and explicit Ticket destinations, archive/restore versus destructive deletion, resizable heavy-use panes, real tables/bulk scope, truthful drafts/save/Undo, Library preview utilization, Widget 2.0, compact Create, color/contrast/icon clipping, native testing, quiet notifications, and full CD-01–CD-20 reconciliation. **Keep chat/DMs, external portal and ornamental restyling out of the 1.0 critical path.**


---

## v4 addendum (2026-10-20): Visual improvement is part of implementation, not a separate cosmetic phase

**Owner decision:** During G25–G28, deliberately improve visual hierarchy, workspace density, typography, spacing, alignment, content-area usage, color semantics and interaction polish **while** finishing bugs and feature flows. Do not reserve all visual work for TD7, and do not avoid meaningful visual changes simply because they're not required to fix a backend bug. Retain the current G25 Workstream 3 archive as the implementation baseline; this addendum makes **no claim of completed source changes**. CL-DS-001 v1.3.0 is the design authority and must be installed at `source/docs/design/CLUSTER_STUDIO_STYLE_GUIDE.md` before adopting substantial design changes.

### Integrated scope by batch

| Batch | Pair functional work with these UI improvements | Avoid |
|---|---|---|
| **G25: Tickets, Boards, Forms, Projects, QA, Calendar, collaboration** | Simplify Ticket creation and explicit destination selection; genuinely empty Board state; dense triage with legible columns and useful quick actions; compact headers; clear priority/status/assignee styling; keyboard-accessible Board/Whiteboard controls; readable conflict/queued/saved/Undo feedback; Project/Build/QA gate explanation; occurrence edit clarity and Scheduler collision details | Redesigning a workspace without preserving its existing operations, forcing Ticket fields on ordinary Cards, inventing new color systems or hiding primary actions |
| **G26: Library, Viewer, Review, Packets, Transfer, Packages** | Let preview/media canvas use available width and height; purposeful resizable inspector; persistent selection and media position; visible source-vs-recipient and version/approval states; dense file tables and safe bulk-operation preview; understandable staged/queued/install progress and recovery | Card grids for evidence tables; huge empty gutters; fake percent completion; ornamental blur over media or source access cues |
| **G27: Shell, Home, People, Settings, Admin, notifications** | Compact Create and Settings controls; readable preference/Studio/server scope; purposeful Home widget states at every size; neutral chrome and active context; icon clipping/alignment and sensible typography; dense Operations tables; cross-device, native and mobile adaptation with no essential actions lost | A second design-system layer, global `!important` overrides, arbitrary wide-card inflation or separate mobile feature behavior |
| **G28: Reconciliation** | Review actual modified surfaces for hierarchy, viewport use, density, state truthfulness, visual consistency, keyboard/touch accessibility, and focus/scroll persistence. Record cosmetic and usability bugs with the same seriousness as functional regressions. | Calling static CSS fixtures runtime acceptance or treating screenshots alone as proof of completion |

### Every material UI change ships with its feature

1. **Use the canonical source owner.** Reuse `--ds-*` tokens, CSS architecture, theme ownership, `ClusterButton`, interaction states, shared menus, inspectors, resizable panes, DataTable and icon registry before adding local styling. No parallel visual system or new source of truth.
2. **Treat useful workspace area as a concrete outcome.** Task canvases, triage tables, QA/Build evidence, Library previews and operational dashboards expand naturally into available desktop width/height; ultrawide views reveal useful columns/context rather than enlarging padding and boxes. Long-form documents may retain reading measures.
3. **Make visual feedback authoritative.** Distinguish locally edited, saving, queued offline, saved server-side, conflict, permission denial, read-only, staged and committed. A spinner, toast or optimistic transition must not imply unconfirmed server success.
4. **Keep visual density flexible.** Comfortable/Compact/Dense adjust presentation without illegible text, hidden primary actions or keyboard/focus regressions. Prefer tables for comparative data and spacious stages for actual creative media.
5. **Preserve task continuity.** Changing one record, resizing an inspector, applying an inline edit, navigating to related source, or undoing work should not unnecessarily reset selection, scroll, zoom, current media locator, filters or Project tabs.
6. **Maintain explicit design change evidence.** For a substantially redesigned surface, add a CL-DS-001 change record: problem, existing owner, task goal, permissions/states, before/after or measurements, viewport/density behavior, preserved functionality, and validation. Historical look-and-feel choices are revisable, but accessibility and security are not.
7. **Check actual rendered behavior.** Use the guide's viewport acceptance fixtures (phone/tablet/snapped desktop/full-HD/ultrawide), keyboard focus, themes, reduced motion, long identifiers, and common Windows 100/125/150/200% scaling when running real builds. At source-only checkpoints, mark these as **unverified live tests** rather than passed.

### Completion interpretation

Visual work is **included in each relevant implementation checkpoint** and must not be deferred wholesale, but there is **no additional G-number** and no permission to stall functional G25–G28 work for an open-ended aesthetic rewrite. A UI fix is complete only if its real task and usability regression evidence are reported; visual prototypes/fixtures may help design but do not equal app screenshots. TD7 remains final cleanup. Platform certification remains a separate live-runtime gate.

### Workstream 5 integration checkpoint

Completed inside G25, not a new G milestone: Project Automation Ticket actions now honor explicit Board/List destinations, including nested branch actions. Linked Project Control status/progress and event triggering now use Ticket triage authority; rejected is not successful delivery. Project Control editor destination selection and regression tests are integrated. Reference `TD6_G25_WORKSTREAM5_TICKET_AUTOMATION_PROJECT_PROVENANCE.md`. G25 remains source-open for the remaining cross-tool workflows; no change to G26–G28 ownership.

## G25 Workstream 6 checkpoint

Form reviewer follow-up is source-implemented with a private mapping and neutral Project issue, plus Whiteboard native text Undo/Redo protection and replay state guards. G25 **not closed**: broad collaborative content history, delegated reviewer scope, and Calendar/Scheduler edge contracts remain. See `TD6_G25_WORKSTREAM6_FORM_PROJECT_WHITEBOARD_CONTINUATION.md`.

### G25 Workstream 7 delivery against official UI/UX style guide (2026-10-20)

Completed as source checkpoint: scoped delegated Forms review and admin CAS lifecycle; privacy-minimal Form response list with an authorized on-demand details pane; density-aware Settings master/detail; Board/Card native text Undo ownership. Updated export privacy schema (8) and erasure coverage. G25 **still open** for full collaborative content-history/conflict recovery, Scheduler virtual recurring resource capacity and remaining cross-tool review/provenance. Workstream 7 did **not** authorize G26/TD7 entry. See `TD6_G25_WORKSTREAM7_DELEGATED_FORM_REVIEW_BOARD_HISTORY.md`.


## G25 Workstream 8 implementation note (2026-10-20)

Shared Calendar/Scheduler virtual meeting capacity and Planner incomplete-availability UX are source-implemented. Scheduling now checks real quantity under physical + unmaterialized future Calendar occurrences rather than binary occupancy. Remaining G25 Calendar requirement: decide and enforce a finite placement horizon/expiry for indefinite series when creating/editing long-lived recurrence, then test at scale. Do not mark G25 complete solely because detached occurrence capacity now passes. Other collaborative history gaps remain. See `TD6_G25_WORKSTREAM8_VIRTUAL_CALENDAR_SCHEDULER.md`.

## G25 Workstream 9 implementation checkpoint
New/edited reservable recurring meetings have a finite local-civil-date expiry and verify every future occurrence up to 366 days/128 occurrences. Existing legacy indefinite series persist untouched, but editing requires explicit end. Scheduler virtual search/Calendar windows/reminders prune expired series with moved-exception allowance. Whiteboard conflict 'preserve local recovery copy' retains unsynced draft and blocks stale Save. Refer to WS9 implementation and UX change record. **G25 remains OPEN for wider cross-editor durable content reversals, reconnect resolution and CD-ledger workflow reconciliation.** Source tests are not runtime certification.

### WS15 source integration (not a new G-number)

Board List metadata and pair-scoped column ordering now have durable, permissioned, server revision-checked Undo/Redo (with completion-state barrier). Sync fallback storage/lease failure pauses replay instead of running unlocked. Exact G25 source closeout remains pending final List/archive/Ticket links and cross-tool state audit; G26–G28 and TD7 are unchanged.

## G25 WS16 integration addendum (2026-10-21)

New source is G25 WS16, not WS15. Non-destructive Board List lifecycle with revisioned archive/restore and protected permanent deletion, archived destination checks, explicit Project Control Ticket materialization and unified Admin/Search Ticket stage were implemented together. See `TD6_G25_WORKSTREAM16_LIST_LIFECYCLE_CROSS_TOOL_AUTHORITY.md` for source evidence and exact open runtime limits. No G26 promotion yet.

## G25 WS17 source closeout decision (2026-10-21)

G25 is **source-closed**, not fully runtime certified. Canonical source is `Cluster-v0.546.0-TD6-G25-Workstream17-Source-Closeout-Source.zip`; new migration and actual Ticket-stage/analytics/closeout integration documented in `TD6_G25_WORKSTREAM17_SOURCE_CLOSEOUT.md`. G26 Library/Viewer/Packets/Transfer/Packages is **NEXT**. All G25 live Windows/Qt/Node24/PostgreSQL/typed-client/authenticated multiuser and media-accessibility acceptance is explicitly deferred to the final certification program; do not infer it from source test counts.


## G26 Workstream 1 (2026-10-21)

G26 **OPEN**. First grouped source implementation completed for CD-02/CD-07/CD-13/CD-19/CD-20: version-bound derivative/Viewer authorization and copyright policy, guarded worker publishing, symlink refusal, no-store cached streaming, Library stale-preview visibility and true Transfer Center moving/paused/failed/unknown-byte progress. Focused tests: 24/24. Reuse canonical G25 WS17 baseline and continue G26 Library/Packets/Transfers/Packages/Inventory/Vault work before advancing G27. See `TD6_G26_WORKSTREAM1_DERIVATIVE_DELIVERY_TRANSFER_TRUTH.md`.

## G26 Workstream 2 source integration (2026-10-21)

Dedicated exact-version Media Review decision and durable evidence (`ReviewAssetDecision`, migration `20261028000000_td6_g26_review_decision_evidence`), reviewer/manager authority with server-owned actor/time, CAS and required explanation for changes. Client metadata patches cannot forge review decisions or reassign version identity; the Viewer and Project Video interface use the dedicated route, show review history and prefer archive. Review-note follow-up creates Ticket/Card only in an explicitly selected, authorized active Board/List, transactionally linking both version provenance and note. No implicit Board creation. Tests **26/26** focused plus inherited G26 WS1 and Library, Packet, G25 WS14–17 and TD5 selected suites. G26 remains **OPEN** for recipient-specific delivery/acknowledgment, Library bulk/transfer durability and Package/Inventory/Vault native distribution. Node24/PostgreSQL/Qt/browser production certification not performed. See `TD6_G26_WORKSTREAM2_MEDIA_REVIEW_DECISION_AND_WORK.md`.


### G26 grouped Batch B update (source only; G26 OPEN)

- Batch A Packet author compliance and candidate discovery remains source implemented.
- Batch B adds canonical Package→Inventory digital/license seat requirement with preview fingerprint, irreversible-by-this-route reviewed restriction, current-seat target and download authorization checks, admin effective-readiness inspection and source regressions. Vault secret values are **not** embedded or distributed.
- CD-05 Inventory, CD-06 Vault, CD-08 Packages remain incomplete at full native/secret-provisioning certification and broader lifecycle level; explicitly preserve remaining native installer, OS attestation, secret-use and large transfer items in next grouped handoff. New additive migration `20261101000000_td6_g26_package_inventory_seat_binding` requires PostgreSQL apply before running.
- See `TD6_G26_BATCH_B_PACKAGE_INVENTORY_READINESS_CLOSEOUT.md` and `TD6_G26_BATCH_B_TO_BATCH_C_HANDOFF.md` for exact implemented source and outstanding gates.


## G27 Batch 2 implementation (2026-10-22)

Source-implemented People account-expiry keyset worker, searchable/paginated Access Renewals management, transactional pending-review cancellation on offboarding, and obsolete access-expiration Inbox action resolution upon renewal/offboarding. 13 focused tests and adjacent People/configuration suites passed; full TD5 recheck exceeded execution window and is not newly certified. G27 remains active. See `TD6_G27_BATCH2_PEOPLE_ACCESS_LIFECYCLE_CLOSEOUT.md`; defer dangerous G26 MSI/credential-provider/storage actions. Next G27 Batch 3: applications→People onboarding + effective-access explanations + integrated Admin/Home attention.

## G27 Batch 3 implementation (2026-10-22)

Completed application-review/account-conversion transaction and security-audit convergence, explicitly selected safe profile mapping, strict onboarding audience/version checks, first-login Inbox assignment, app notification deep-link + direct authorized detail, Person follow-through and expanded Admin application attention counts. **21 focused checks**, old People/Admin + G06/G07 regressions, G27 People/Configuration suites and source scan passed. No schema migration. This is not entire G27 closeout. Continue with member-facing onboarding completion UX, Access Explorer/People effective permission explanations, Home admin attention, shared Search/Create/navigation and Communications. See `TD6_G27_BATCH3_APPLICATION_ONBOARDING_CLOSEOUT.md`.

## G27 Batch 5 (2026-10-22)

Operations onboarding totals now reflect completed *required* Packet, Policy and Form steps, with overdue/due-soon/complete breakdown and oldest-12 person deep links. Packet/Policy metrics use full-population database aggregates instead of the previous capped 5,000-row list. People Access uses the canonical per-subject effective Tool authorization explanation on demand. G27 remains OPEN for shared Search/Create, Communications and deeper Home/Admin navigation. G26 dangerous recovery/disposal remains blocked, certification deferred. See `TD6_G27_BATCH5_ATTENTION_ACCESS_CLOSEOUT.md`.

## G27 Batch 8 (2026-10-22)

Author-owned, permission-rechecked read-only announcement create-intent inspection now permits post-reload recovery of uncertain Create/Duplicate requests. Session-tab recovery keeps only opaque UUID, request SHA-256 and TTL; no announcement contents. Creation still requires matching payload digest and server-authorized per-admin uniqueness. 19 route/durable-intent checks and 9 new marker checks passed, alongside G27 configuration/application/People/attention and source scans. No new migration, no new polling. **G27 remains open** for cross-resource/Inbox/Help reconciliation; G26 native/provider safety gates and production certification stay separate. See `TD6_G27_BATCH8_ANNOUNCEMENT_RELOAD_RECOVERY_CLOSEOUT.md`.
