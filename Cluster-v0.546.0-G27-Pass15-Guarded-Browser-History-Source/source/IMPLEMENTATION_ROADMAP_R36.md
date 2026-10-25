# Cluster implementation roadmap | active summary | revision 36

**Baseline:** v0.546.0 TD4 R36 Bounded Background Library Archive/Unarchive, following R35 Collection-aware Durable Library Metadata Jobs, following R34 durable workspace metadata, following R33 Collection selection, R32 workspace matching and R31 collection sharing on top of TD3 R30 source-level closeout after R29, with confirmed Desktop Native Services and Workstation negative-result fixes, synchronous action gating, partial-commit feedback, and computed People/Select CSS cascade correction. Earlier TD6/CD-01 Forms draft source remains unchanged. **TD3 implementation CLOSED at source level**, pending separate runtime release certification. The comprehensive historical/source ledger is `TECH_DEBT_MASTER_ROADMAP.md`. This file is the shorter, current execution view. All release acceptance lives in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## Phase execution

| Phase | Implementation status | Exit scope |
| --- | --- | --- |
| TD0 | Core complete | Fix new confirmed defects only |
| TD1 | Closed | Settings Authority source contracts preserved |
| TD2 | Core closed | Six configurable tools and registered job/event ownership preserved |
| TD3 | **Source implementation CLOSED (R30)** | Shared action negative-result owners, remaining Native Services/Workstation paths, CSS candidates, and native source-contract audit dispositioned with executable evidence. Reopen only for a demonstrated source defect; installed Qt/Windows behavior remains in release certification. |
| TD4 | **Active: collection-aware durable metadata and file-only archive/unarchive jobs (R36)** | Larger bulk lifecycle operations, shared resource/action/search adapters, provider lifecycles and typed events remain |
| TD5 | Partly built | Missing native/diagnostic/background **implementation**, not runtime proof |
| TD6 | Partly built; authenticated Forms drafts preserved | Required CD-01 to CD-20 workflows, with optional provider extensions deferred explicitly |
| TD7 | Not started | Delete obsolete implementations after canonical replacements; code freeze |

## TD6 implementation backlog (not certification)

| Work group | CD owners | Next substantive code slice |
| --- | --- | --- |
| Workflow authoring and collaboration | 01, 03, 18 | Authenticated Forms respondent drafts implemented; public application draft strategy explicitly deferred; collaboration-safe Board/Whiteboard history and type-aware QA/build context still open |
| Library, files and delivery | 02, 07, 13 | **Collection sharing, up-to-200 interactive selection, and up-to-1,000-item durable metadata/file-only archive and restore-from-archive implemented**; bulk folder trees, Trash/destruction, moves, media derivatives, and unified transfers remain |
| People and permissions | 04, 06, 17 | Timed access delegation, identity lifecycle, safe Vault scopes, Access Explorer |
| Packages and integrations | 05, 08, 09 | Native managed Package apply/rollback authority, entitlement reconciliation, required Git/UE/Discord integration code; vendor/provider extras may be deferred |
| Project and schedule | 10, 11 | External-safe identity and closeout, Calendar layer/recurrence integration |
| Shared studio UX and communications | 12, 14, 16, 19 | Shared commands and navigation, notification grouping/preferences, actionable error/empty states |
| Setup, operations and governance | 15, 20 | Safe config import/diff, setup recovery, cross-domain archive and privacy boundaries |

**CD-21 is NOT in this table.** Live target build, device, performance, external provider and production acceptance tests belong only to the separate release-certification roadmap. Some existing CD prose still carries historical runtime acceptance examples; those examples are not implementation gates.

## Deep, methodical subsystem execution discipline

- **Inventory the whole subsystem before coding:** identify code owners, data flow, dependencies, all user entry points, and regression-sensitive details. Record evidence and reproducible defects; avoid mechanical migrations for their own sake.
- **Define finite completion gates:** every required path is present and wired, duplicate authorities are removed, error/permission/disabled/offline states are handled, and source-level regression checks cover important contracts.
- **Implement end to end:** keep working through connected codepaths until the subsystem's defined scope is complete. Never split a cohesive workflow to reach an arbitrary pass count; do not expand scope just to keep a phase open.
- **Validate development continuously:** executable targeted tests, inherited regressions, static/source checks, code/package integrity. Track failing and unavailable checks separately; no optimistic checkmarks.
- **Track outcomes, not milestones:** record fixed issues, uncovered issues, deferred optional features with explicit reasons, and remaining work owners. Close a phase only after a source implementation closeout audit; reopen only for a demonstrable defect.
- **Keep release certification on its own roadmap:** Windows/Qt installed build, live PostgreSQL, multi-user and production acceptance testing are separate gates, never reasons to label source implementation unfinished.
- **Preserve Cluster identity:** floating shell options, Project Tabs search replacement, My Work/Tickets/Transfer Center, People avatar accents/presence, layered textures and accessibility. No appearance flattening during consolidation.
- **Prioritize completed user journeys over abstraction counts.** TD4/TD5 work should be integrated with the TD6 workflows that consume it. CD-01–CD-20 are complete only when mandatory server/UI interactions exist or optional work is explicitly deferred.

## Current deep-pass execution order and implementation exit checks

1. **TD3 source complete:** preserve R30 closeout outcomes and reopen only on a demonstrated regression; actual QML/Windows runtime acceptance is separately gated.
2. **TD4 + TD6 resource workflows:** pick a complete user journey (starting with Library selection/collections or Forms draft recovery), trace server authorization → contracts → renderer actions → status/rollback; deliver a usable workflow, not detached helpers.
3. **TD5 implementation alongside consumers:** native transfers, background ownership, diagnostics and durability are completed as needed for the above workflows, not as vague standalone cleanups.
4. **TD7 fossil removal:** remove obsolete code only after canonical implementations exist; preserve the original preservation matrix and ensure no required controls disappear.

### TD3 native UI issues found in the source review

- `ClusterComboBox.qml` referenced an unregistered `ClusterGlyph` in a module whose CMake list did not contain that type. Use a registered native chevron instead.
- Native Qt pages still used 9–11 px hard-coded caption text, bypassing the desktop text-scale preference. Route page labels through one shared scaled native type resolver.
- `Surface.qml` suppressed gradients for high contrast but retained a translucent background, weakening legibility. Force opaque materials when contrast or transparency settings demand it.
- Full installed Qt build and Windows behavior remain on the separate release-certification roadmap. A missing `qmllint` in the source runtime is not an implementation failure or proof of QML build success.

### Current deep subsystem work: action outcomes + Appearance backgrounds

- Added a pure three-stage optimistic/server/commit transaction executor. A local commit failure after server success is an uncertain outcome, not a green light for a duplicate create/update. Rollback exceptions no longer strand the feedback control.
- Taskbar Search commands, clipboard copy, and Desktop detached-window actions now share immediate execution, confirmed-outcome feedback, and no premature search dismissal.
- Fixed false-positive Project share URL clipboard success.
- Removed six demonstrated competing background declarations from the original CSS owners; the Light background presets now have independent output again. Appearance 3.2 surfaces and People/taskbar identity preserved.
- Executable focused, inherited, source/strict-type, and computed-style CSS checks are recorded in `TD3_DEEP_SHARED_ACTION_CSS_AUDIT.md`; these are development evidence, not release certification.

**TD3 R30 source exit:** Finite negative-outcome and CSS ownership inventory dispositioned with tests. See `TD3_R30_SOURCE_IMPLEMENTATION_CLOSEOUT.md`; release certification remains separate. TD4/TD6 source workflows are next.

## October 14 source continuation: Forms respondent drafts

- **Delivered:** respondent-private persisted drafts, server authorization, published-version guard, compare-and-swap revision conflict safety, autosave and reload/discard UI in the shared Form runner, post-submit transactional draft cleanup and My Forms draft discovery. Also repaired under-review duplicate submission and required-checkbox final validation.
- **Scope:** authenticated studio member Forms only. Public applicant recovery is deferred because arbitrary local persistence of application PII would violate the privacy boundary. The rest of CD-01 stays open until other mandatory workflows are implemented.
- **Source evidence:** `TD6_CD01_FORM_RESPONDENT_DRAFT_IMPLEMENTATION.md`, `TD6_CD01_VALIDATION_RESULTS.md`, `TD6_CD01_SOURCE_SCAN.json`, `tools/scripts/cluster-td6-respondent-drafts-tests.mjs`.
- **Next cohesive implementation:** TD4/TD6 Library collection and permission-aware cross-page selection, or CD-03 Board/Whiteboard collaboration-safe history. Do not reopen TD1/TD2. TD3's finite unverified CSS/action-owner audit remains open; no UI flattening permitted.
- **Separate certification:** PostgreSQL bootstrap/migration, full dependency-backed React/Qt builds, multiple real users/tabs, and Windows behavior remain only on `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## October 14: TD3 active again (correction after premature TD6 execution)

- The immediately previous authenticated Forms draft recovery remains in source and in its own migration/tests. It was real TD6 implementation but **is not the active phase**. No history or feature is discarded.
- **Taskbar account menu:** clipboard and desktop workspace detach now invoke the existing `createClusterCommandInvocation` synchronously under a single-flight gate. A `false` result, throw or rejection keeps the menu open and reports a visible error. Success alone dismisses. Pending actions prevent outside/Escape dismissal.
- **Detached resource toolbar:** `Copy link` now uses `ClusterActionButton`; clipboard denial raises an error rather than displaying a false success.
- **Native server manager:** mouse-only profile rows replaced with focusable `ItemDelegate` rows, accessible selection and focus contrast. Local data reset and profile removal now require separate explicit confirmations. A successfully saved server whose activation fails is surfaced in its details without inviting a repeat add.
- **Native reduced transparency:** an opaque surface now applies to both high-contrast and system/user reduced-transparency preference; material gradients remain disabled for those modes.
- Regression source contract updated to reflect stricter pending-dismissal conditions; no native binary rebuilt, no database changes made in this TD3 return.
- Source tests: `tools/scripts/cluster-td3-return-action-native-profile-tests.mjs`, `tools/scripts/cluster-td3-return-source-scan.cjs`, Qt audit, inherited TD3 regression suite, Appearance computed-CSS fixture. Detailed evidence: `TD3_RETURN_ACTION_NATIVE_CLOSEOUT.md`.

**Historical status (R27): TD3 was open then.** R30 now closes the identified remaining source issues. Installed Qt/Windows runs remain certification-only.

## October 14: TD3 R28 viewer/native/sidebar ownership

**Active implementation remains TD3.** Parent: TD3 Return source (R27), itself retaining the intervening CD-01 Forms work.

- **Viewer shared commands:** `runSystemAction` previously swallowed errors, causing the `ViewerCommandBar`/`useClusterMenuExecution` wrapper to dismiss the overflow menu after failed clipboard/download/export/detach commands. Failures now update visible ARIA alert status **and rethrow** to the menu execution owner; pending commands retain single-flight behavior. All header/inspector action entry points route through handled `ViewerCommandRegistry` outcomes instead of unhandled fire-and-forget promises.
- **PDF adapter:** selection copy uses `copyClusterText` (native/browser fallback), rejects empty or denied clipboard writes; missing source/HTTP-denied PDF printing and missing download source now reject rather than silently returning success.
- **Native Qt settings:** C++ log/app-data folder invokables expose the `QDesktopServices::openUrl` boolean result. Qt App Settings displays registered-link/open-folder failure and has responsive diagnostic action layout. Server Profiles now reports errors for rename, switch, open local folder and sign-out actions.
- **CSS demonstrated conflict:** `#cluster-sidebar .cluster-sidebar__link` had root `!important` 36px and 38px minima in different CSS owners, both defeating the mobile 44px rule. Two source stylesheet orders produced different desktop min heights and both produced 36/38px on mobile. Row-height ownership is now in `sidebar.css`: Chromium confirms 38px desktop and 44px mobile across both load orders. Shell's independent icon/color/padding/collapsed layout rules remain intact.
- **Evidence:** `TD3_R28_IMPLEMENTATION_AUDIT.md`, `TD3_R28_REGRESSION_RESULTS.json`, `TD3_R28_SIDEBAR_CSS_EVIDENCE.json`, `TD3_R28_SOURCE_SCAN.json`, regression script and Chromium probe. 27 inherited/new suites executed after temporarily resolving the global TypeScript test dependency.

**Historical status (R28): TD3 was still open then.** The bounded inventory was completed in R29–R30. Qt/Windows build remains in release certification.

## October 14: TD3 R29 source outcomes, Work/Palette/Desktop + Create search

- **Confirmed action-outcome failure:** `useClusterMenuExecution` treated resolved `false` as success. The menu could dismiss when a bridge explicitly denied clipboard/window actions. Shared boolean-aware action contracts now reject `false` while preserving void callbacks, synchronous browser gesture execution, immediate single-flight, and visible retry feedback. Context menu, split button and resource registry share this typed contract.
- **Work actions:** `WorkActionMenu` now returns `copyWorkLink` and Desktop window results to its menu executor; denied mention-clipboard copies now throw instead of silently resolving. `ProjectResourceSwitcher`, Board and Whiteboard window callbacks return actual completion, keeping their existing status explanations.
- **Global command palette:** Desktop window, app settings, server profiles and renderer reload actions return native promises to the existing command gate (previously `void`-discarded); false/rejected operations no longer dismiss search as successful.
- **Proven CSS conflict:** shared Create picker search and input were compressed from the Create owner's 44px / 46px desktop/mobile target to 32px/30px by late `production-ui.css` declarations. Chromium fixtures independently reproduced layout-order instability and now measure 44px desktop / 46px mobile with 42px input in both import orders, preserving the existing production surface appearance and 4-column Create search slot.
- **Executed development evidence:** 28/28 inherited and added executable script suites; 12/12 new R29 outcome assertions; 4/4 Chromium Create CSS scenarios; 89/89 native QML source contracts; 8/8 Appearance background scenarios. 1,061 TS/TSX with zero parse errors, 3,261 renderer relative imports with none missing, 110 CSS files with zero parser errors. Lean source requires temporarily linking globally installed TypeScript for the preserved Forms test, removed before packaging. No new migration or native executable rebuilt.
- **Finite remaining TD3 owners:** complete the remaining independent action-owner negative-result review (e.g., Desktop Native Services, non-menu utility commands) and verify/disposition remaining higher-risk CSS candidates using actual computed selectors, not duplication counts; QML source check passes but is not a Qt compile. See `TD3_R29_IMPLEMENTATION_AUDIT.md`. **Historical R29 status: TD3 active. R30 supersedes this status after the source closeout.**

## October 14: TD3 R30 final source-level closeout

- **Verified Desktop Native Services contract:** file open/reveal, clipboard, server-profile/settings windows, and widget-library opening now require positive native broker acknowledgements; false and malformed results display failure, not a successful operation. Native utility actions have synchronous per-action locks and visible pending feedback to stop duplicate clicks in the same render cycle.
- **Native transfers and capture partial outcomes:** confirmed transfer mutation versus failed projection refresh are reported distinctly. A successful capture whose preview fails retains the opaque handle and explains partial success rather than encouraging duplicate capture.
- **Workstation Git source behavior:** Git mutations, clone, Git operations, repository task starts and initialization claim immediate intent locks. LFS mutation success followed by failed follow-up status refresh explicitly reports committed work and reconciliation need; it no longer says the mutation failed.
- **CSS computed ownership:** People metrics previously changed `display:grid` to flex based on source ordering, overflowing a 375px viewport (scrollWidth 462 vs clientWidth 375). Removed the competing Production UI display/grid override. Select menu padding likewise varied 5px/4px with load order, now canonical select owns 4px. Mobile open-chat inset, Select shadows, and Admin horizontal subnavigation were tested and left intact where stable or intentional.
- **Development evidence:** `TD3_R30_CSS_OWNERSHIP_EVIDENCE.json` 20/20, `tools/scripts/cluster-td3-r30-native-service-outcomes-tests.mjs` 11/11, `TD3_R30_REGRESSION_RESULTS.json` 29/29, native QML source audit 89/89, inherited eight Appearance background scenarios, source scan 1,062 TS/TSX zero parse diagnostics, 3,262 renderer-relative imports zero missing, 110 CSS zero parser errors.
- **TD3 IMPLEMENTATION CLOSED (source-only):** the finite documented R29 negative-outcome, CSS and QML-contract owners have been dispositioned with source changes or grounded no-change evidence. This is not proof that every runtime scenario is correct. Any new demonstrated defect can reopen TD3. Installed Qt/Windows DPI/keyboard behavior, dependency-backed compilation, actual browser flows and multi-user tests remain ONLY on `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.
- **Next active source:** TD4 real resource adapters alongside TD6 Library collection/selection workflows; TD5 native completion as consumed. No elective redesign of TD3, and no runtime-certification requirements imported into implementation gates.


## October 14: TD4 Library collection sharing (R31)

- **Implemented end-to-end:** explicit viewer/editor grants for personal manual and smart Collections, discoverability in shared recipient Library Explorer, owner-only share management, and editor-only membership edits. Owner/admin settings control is unchanged.
- **Security:** Library access/tool checks remain separate from collection grants. Personnel Records attachments are still excluded; source metadata/content is filtered with the established Library ACL. Unauthorized users cannot open arbitrary collection IDs. Membership totals are suppressed for shared roles to avoid disclosing inaccessible counts.
- **Durability:** Prisma `LibraryCollectionGrant` relation with composite primary key and role constraint. Grant/revoke uses collection-revision CAS in a Serializable transaction, including durable ActivityEvent evidence. Disabled/archived/expired recipients cannot be newly granted access.
- **UI:** owners manage grant roles and revocation in an accessible modal; editors can add/remove collection references but not change query definitions or sharing; viewers browse only. The result-after-commit refresh path distinguishes a saved mutation from a roster-fetch failure.
- **Development evidence:** `TD4_R31_LIBRARY_COLLECTION_SHARING_IMPLEMENTATION.md`, `TD4_R31_SOURCE_VALIDATION.json`, `tools/scripts/cluster-td4-library-collection-sharing-tests.mjs`, updated `cluster-0540-library-completion-tests.mjs` with in-memory route authorization and grant-mutation checks. The inherited 29 suites passed (Forms required a temporary development-only TypeScript link, not packaged).
- **TD4 remains open:** real resource/action/search adapter enrollment, provider ownership, typed events, and server-side select-all-matching. **TD6 CD-02 remains open:** collection sharing is one connected slice, not the entire Library completion ledger. TD3 stays source-closed.
- **Release certification remains separate:** live PostgreSQL migration application, actual authenticated browser and multi-user behavior, Node 24 builds, Windows and Qt device testing are not proven by static/in-memory checks.

## October 14: TD4 R32 server-authoritative Library selection

- **Implemented:** `POST /api/library/bulk/select-matching` resolves a bounded, complete Library workspace result on the server from the same filter builder as the browser, including records beyond the loaded pages. Returned authorized items and live revisions feed the existing revision-checked bulk preview/write and CSV/collection actions. The old client-side twelve-page prefetch was removed.
- **Fail closed:** 201+ visible matches, overlong scans, inconsistent rows, and read-transaction conflicts never return a partial selection. This is a **maximum-200 operation**, not unbounded bulk-job execution. Users must narrow filters; larger asynchronous queued selection is still TD4/TD6 work.
- **Privacy:** server excludes Personnel Records and individual ACL-inaccessible items when selecting. Independently, `/api/library/bulk` rejects attempts to mutate guessed Personnel Records item IDs. Collection grants still never grant source Library permissions.
- **Consistency:** matching scan, Records exclusion and dependent favorite/folder scope queries share a repeatable-read PostgreSQL transaction. The browser refuses stale navigation results, preserves current reviewed selection on background refresh, and still submits expected revisions on write.
- **Source evidence:** `TD4_R32_SERVER_MATCHING_SELECTION_IMPLEMENTATION.md`, `TD4_R32_SOURCE_VALIDATION.json`, `tools/scripts/cluster-td4-library-matching-selection-tests.mjs`. TD3 stays source-closed.
- **Still open:** unrestricted/async large bulk jobs,  deeper reusable resource/action/search adapters and typed provider events; TD5/TD6 work. PostgreSQL/Node 24/browser and Windows/Qt certification remain separately gated.

## October 14: TD4 R33 complete bounded Collection selection (source)

- **Delivered:** Manual and Smart Collections can now select *every* currently accessible item across unloaded pages (up to 200) using the same complete bounded selection engine as the Library workspace. The existing bulk review/write path receives current item revisions and independently checks authorization and revision preconditions again on apply.
- **Authority:** new `POST /api/library/collections/:collectionId/select-matching` requires Library tool + collection grant, re-reads live collection role, `archived` and expected collection revision inside a repeatable-read snapshot, compiles the saved Smart query or walks Manual memberships deterministically, filters Personnel Records and per-item Library ACL, and refuses partial results on 201+ visible matches or scan/snapshot failure. Shared collection grant never becomes Library source access.
- **UI:** one Select Matching action for Library and Collections, safe stale-navigation response rejection, reviewed selection retention during same-query collection refresh, clear errors and limits. Collection selection follows its saved query/membership, not unimplemented additional filters in the collection browser.
- **Evidence:** `TD4_R33_COLLECTION_SELECTION_IMPLEMENTATION.md`, `TD4_R33_SOURCE_VALIDATION.json`, extended `cluster-0540-library-completion-tests.mjs` with real in-memory route invocations and 200-item boundary/ACL/revocation/role tests; inherited R31/R32/TD3/Forms regressions retained. No new migration or native binary change.
- **Still TD4:** >200 item durable/background bulk execution with resumable idempotency checkpoints, shared resource/action/search adapters, typed provider events and lifecycles. TD3 remains source-closed; real Node 24 + PostgreSQL + Windows/Qt/browser certification remains separate.

## October 14: TD4 R34 durable Library background metadata operations (source)

- **Delivered:** complete UI→preview→confirmation→queue→checkpointed worker→progress/cancel workflow for non-destructive Tag/Untag/Pin/Unpin operations on up to 1,000 authorized matching Library records, including previously unloaded pages. Original up-to-200 interactive atomic selection/bulk path unchanged. Collection-specific background jobs are not yet supported.
- **Correct transaction authority:** selection is resolved in a repeatable-read database snapshot from the canonical Library where-builder; the confirmation digest captures exact IDs and revisions. Every worker chunk rechecks active actor identity, project/Library permissions, Personnel Records attachments, protected lifecycle and active asset locks. Update CAS prevents overwriting concurrent edits.
- **Durability/idempotency:** immutable target revisions, small serializable transaction chunks, one durable checkpoint with progress totals, and one ActivityEvent per committed chunk prevent duplicate writes after lost acknowledgements, retries or lease recovery. Per-intent unique index on BackgroundJob prevents a second job even after the first reaches terminal status. Tool ownership participates in the existing suspend/re-enable lifecycle.
- **UI feedback:** explicit preview and confirmation, per-job progress/status counts, cancellation at chunk boundaries, same-intent retry after network uncertainty, job ID restoration, reduced foreground polling while hidden, and explicit partial/denied/conflicted results. No hidden full-list client prefetch.
- **Implementation evidence:** `TD4_R34_DURABLE_LIBRARY_BULK_IMPLEMENTATION.md`, `TD4_R34_SOURCE_VALIDATION.json`, new `tools/scripts/cluster-td4-library-durable-bulk-tests.mjs`, updated TD2 owned-job regression, schema and migration `20261014214500_td4_library_durable_bulk_checkpoint`.
- **Still open:** true collection-aware background selection, archive/delete/move/rename at scale, >1,000-item job splitting, typed resource/search adapters, lifecycle orchestration, broader TD5/TD6 consumers. Production validation still requires real Node24 dependency-backed compilation, Prisma client generation/migration on PostgreSQL, and authenticated browser/multi-user/Windows/Qt tests. TD3 source closed remains unchanged.


## October 14: TD4 R35 Collection-aware durable Library metadata jobs

- **Delivered:** Manual and Smart Collection owners/editors can preview and queue matching Tag/Untag/Pin/Unpin operations on up to 1,000 accessible items. Viewer-only collection grants are insufficient. Existing standalone Library workspace background jobs and up-to-200 interactive actions remain unchanged.
- **Server scope:** preview and queue share a repeatable-read resolver of current collection grants, collection revision, saved Smart query/folder scope or complete Manual membership, and *independent* per-item Library contribute permissions. Personnel Records attachments, deleted/trashed/destroyed and unauthorized items are excluded. The 1,001st accessible item refuses the entire selection; client-supplied item IDs are not accepted.
- **Durable authority:** request-key deduplication now incorporates collection identity and revision, and the immutable worker payload includes the reviewed collection revision. Each resumed 20-item chunk checks live collection editing authority and revision inside its item/checkpoint/activity transaction. Revocation, archival or definition/membership changes skip remaining targets with denied counts; prior committed chunks remain. Per-item ACLs/revisions/Records/locks still revalidate as in R34.
- **UI safety:** collection viewers see no background action menu, while owners/editors can explicitly review and confirm. The reviewed action is bound to its original collection; navigation during prompting/preview/confirmation aborts. Durable status and cancellation reuse R34.
- **Evidence:** `TD4_R35_COLLECTION_DURABLE_BULK_IMPLEMENTATION.md`, `TD4_R35_SOURCE_VALIDATION.json`, focused executable collection tests and extended durable-worker tests; inherited suite retained. This is **not** a live Qt/browser/PostgreSQL certification.
- **TD4 remains open:** large destructive/tree lifecycle jobs, canonical resource/action/search provider adapters and typed events, cross-provider durability, and TD5/TD6 integrations. TD3 stays closed.


## October 14: TD4 R36 durable file-only Archive / Unarchive

- **Source-complete slice:** existing `library.bulk.metadata` durable job authority additionally accepts `archive` and `unarchive` status transitions for standalone Library files, from either complete workspace search matches or shared Manual/Smart Collection matching. `unarchive` means archived → active, **not** Trash restore.
- **Selection correctness:** server preview and queue recompute a repeatable-read snapshot, apply user contribution ACL and Personnel Records policy, then remove folders, trashed/destroyed/deleted records, wrong-status items, and records with any children. The digest includes exact ID/revision snapshot; a stale confirmation cannot enqueue. Maximum 1,000 eligible files; 200-item interactive path unchanged.
- **Execution safety:** current account, collection revision/editor authority, individual file ACL, protected attachment status, lock, live hierarchy, lifecycle state, and revision are all rechecked inside each 20-item Serializable chunk. One transaction stores changed statuses, checkpoint totals, and activity evidence. Lost progress response can retry without re-applying completed chunks. File blobs and paths are not modified.
- **User experience:** `Archive matching files…` and `Restore archived matching files…` live in the existing Library background-action menu, with an explicit preview/confirmation and scope explanation. Current progress/cancel and incomplete/blocked/conflicted counts remain intact.
- **Source evidence:** `TD4_R36_FILE_ARCHIVE_IMPLEMENTATION.md`, `TD4_R36_SOURCE_VALIDATION.json`, expanded `cluster-td4-library-durable-bulk-tests.mjs` and `cluster-td4-r35-collection-bulk-tests.mjs`. No migration or native executable modification.
- **Remain open:** hierarchy-wide archive/restore, Trash/destruction, cross-folder moves, large transfer jobs, and TD4's resource/action/search adapters, typed events, provider lifecycle implementation. Actual PostgreSQL, Node 24/dependency-backed builds, multi-user/browser, Windows/Qt testing remain separate release certification.
