# Cluster implementation roadmap | active summary | revision 28

**Baseline:** v0.546.0 TD3 R28 viewer command outcomes, PDF clipboard/print/download, native preference feedback, sidebar CSS target-height ownership, preserving the earlier TD6/CD-01 Forms draft source unchanged. **Active execution: TD3**, not TD6. The comprehensive historical/source ledger is `TECH_DEBT_MASTER_ROADMAP.md`. This file is the shorter, current execution view. All release acceptance lives in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## Phase execution

| Phase | Implementation status | Exit scope |
| --- | --- | --- |
| TD0 | Core complete | Fix new confirmed defects only |
| TD1 | Closed | Settings Authority source contracts preserved |
| TD2 | Core closed | Six configurable tools and registered job/event ownership preserved |
| TD3 | **Active: documented source closeout audit** | Viewer system command failures now propagate; PDF copy/print/download, native diagnostics/link/profile action feedback corrected; sidebar touch-target stylesheet conflict reproduced and fixed. Remaining independent action/CSS candidates need finite disposition. |
| TD4 | Partly built | Real resource/action/search adapters, provider lifecycles and typed events |
| TD5 | Partly built | Missing native/diagnostic/background **implementation**, not runtime proof |
| TD6 | Deferred from active execution until TD3 is closed; earlier authenticated Forms drafts preserved | Required CD-01 to CD-20 workflows, with optional provider extensions deferred explicitly |
| TD7 | Not started | Delete obsolete implementations after canonical replacements; code freeze |

## TD6 implementation backlog (not certification)

| Work group | CD owners | Next substantive code slice |
| --- | --- | --- |
| Workflow authoring and collaboration | 01, 03, 18 | Authenticated Forms respondent drafts implemented; public application draft strategy explicitly deferred; collaboration-safe Board/Whiteboard history and type-aware QA/build context still open |
| Library, files and delivery | 02, 07, 13 | Collection sharing; server-side bulk selection; missing permitted media derivatives; unified transfer operations |
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

1. **TD3 native/shared UI closeout:** inventory all QML components in the compiled module; correct missing component refs, responsive typography, high-contrast opacity, focus and accessibility; audit CSS conflicts with concrete selectors, and shared action owners with demonstrated failure paths. Close only when the enumerated implementation gaps are fixed or assigned elsewhere.
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

**Next TD3 exit work:** finish the finite action-owner/CSS inventory using concrete user-visible failure paths, verify QML constructors and style/focus/accessibility source contracts, then close TD3 by evidence, not by pass count. No new TD4/TD5/TD6 feature work until then.

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

**TD3 remains OPEN.** Finite next tasks: verify remaining local actions that close despite uncertain outcomes; inspect exact-selector CSS candidates in rendered theme/state combinations and resolve only proven conflicts; audit any remaining native source accessibility/interaction defects. Actual Qt executable and live Windows runs belong to release certification.

## October 14: TD3 R28 viewer/native/sidebar ownership

**Active implementation remains TD3.** Parent: TD3 Return source (R27), itself retaining the intervening CD-01 Forms work.

- **Viewer shared commands:** `runSystemAction` previously swallowed errors, causing the `ViewerCommandBar`/`useClusterMenuExecution` wrapper to dismiss the overflow menu after failed clipboard/download/export/detach commands. Failures now update visible ARIA alert status **and rethrow** to the menu execution owner; pending commands retain single-flight behavior. All header/inspector action entry points route through handled `ViewerCommandRegistry` outcomes instead of unhandled fire-and-forget promises.
- **PDF adapter:** selection copy uses `copyClusterText` (native/browser fallback), rejects empty or denied clipboard writes; missing source/HTTP-denied PDF printing and missing download source now reject rather than silently returning success.
- **Native Qt settings:** C++ log/app-data folder invokables expose the `QDesktopServices::openUrl` boolean result. Qt App Settings displays registered-link/open-folder failure and has responsive diagnostic action layout. Server Profiles now reports errors for rename, switch, open local folder and sign-out actions.
- **CSS demonstrated conflict:** `#cluster-sidebar .cluster-sidebar__link` had root `!important` 36px and 38px minima in different CSS owners, both defeating the mobile 44px rule. Two source stylesheet orders produced different desktop min heights and both produced 36/38px on mobile. Row-height ownership is now in `sidebar.css`: Chromium confirms 38px desktop and 44px mobile across both load orders. Shell's independent icon/color/padding/collapsed layout rules remain intact.
- **Evidence:** `TD3_R28_IMPLEMENTATION_AUDIT.md`, `TD3_R28_REGRESSION_RESULTS.json`, `TD3_R28_SIDEBAR_CSS_EVIDENCE.json`, `TD3_R28_SOURCE_SCAN.json`, regression script and Chromium probe. 27 inherited/new suites executed after temporarily resolving the global TypeScript test dependency.

**TD3 is still OPEN.** Prioritization next: bound the remaining independent action owners and check their negative/uncertain outcomes, inspect CSS selector conflicts using actual cascade effects (not mere string differences), and complete native QML source-focused audit. Qt/Windows build and live runtime certification remain exclusively on `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`. No TD4/TD5/TD6 expansion until source closeout.
