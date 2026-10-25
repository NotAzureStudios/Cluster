# Cluster source checkpoint: v0.546.0 G27 Pass 15

Canonical source: `Cluster-v0.546.0-G27-Pass15-Guarded-Browser-History-Source.zip`, parent Pass 14. Browser history and manual hash navigation now use fresh workspace authorization, an unsaved-work confirmation before commit, and global navigation/session intent race protection. Duplicate pending `popstate`/`hashchange` events share one operation. Run `npm run cluster:g27:p15:browser-history`. See `G27_PASS15_GUARDED_BROWSER_HISTORY_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 14

Canonical source: `Cluster-v0.546.0-G27-Pass14-Board-Request-Identity-Source.zip`, parent Pass 13. Async Board detail reads now accept only the latest matching Board/account/screen result, preventing stale success, error and loading-state commits following navigation and session changes. Fresh server reads avoid permissions-stale Board detail cache. All 17 new and inherited G27 regression checks pass. See `G27_PASS14_BOARD_RESPONSE_IDENTITY_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 13

Canonical source: `Cluster-v0.546.0-G27-Pass13-Project-Tabs-Local-Selection-Source.zip`, parent Pass 12. Project tab close/close-others and Board/Whiteboard local selectors now respect dirty-workspace authorization before mutation, including canceled and stale intent handling. 20 new executed tests plus inherited G27 pass. Board fetch response ordering remains the next target. See `G27_PASS13_PROJECT_TABS_LOCAL_SELECTORS_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 12

Canonical source: `Cluster-v0.546.0-G27-Pass12-Shell-Workspace-Admission-Source.zip`, parent Pass 11. All 13 shell onOpenBoard/onOpenWhiteboard callbacks now dispatch canonical authorized ID-only navigation instead of selecting resource state before admission. 17 new executable callbacks plus inherited G27 tests pass. Local selection and Project-tab closing remain. See `G27_PASS12_SHELL_WORKSPACE_ADMISSION_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 11

Canonical source: `Cluster-v0.546.0-G27-Pass11-Direct-Project-Resume-Navigation-Source.zip`, parent Pass 10. Direct Project opener and Home Continue Working now require discard approval before selection/URL changes. A shared navigation epoch suppresses late approval/authorization results after newer navigation or session reset. Focused 22/22 and all inherited G27 source suites pass. Other tool-local selection and runtime acceptance remain separate. See `G27_PASS11_DIRECT_PROJECT_RESUME_GUARD_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 10

Canonical source: `Cluster-v0.546.0-G27-Pass10-Atomic-Linked-Work-Navigation-Source.zip`, parent Pass 9. Central Search/Inbox/Create/native resource navigation now confirms unsaved-work loss before applying URL and selection updates, cancels obsolete confirmation results, and avoids a second discard prompt. The real central callback and inherited G27 suites pass. Direct Project/Resume shortcuts still need similar integration. See `G27_PASS10_ATOMIC_LINKED_WORK_NAVIGATION_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 9

Canonical source: `Cluster-v0.546.0-G27-Pass9-Unsaved-Guard-Detached-Meeting-Source.zip`, parent Pass 8. `setScreen` now checks unsaved-work confirmation before cleanup/UI state mutation, and pending Meeting inspectors survive Calendar route changes and Desktop detach. Executable tests run the actual navigation controller. **Remaining:** some cross-resource entrypoints still change selection/URL before `setScreen` admission; do not assume every unsaved-work case is fixed. See `G27_PASS9_UNSAVED_GUARD_DETACHED_MEETING_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 8

Canonical source: `Cluster-v0.546.0-G27-Pass8-Canonical-Meeting-Navigation-Source.zip`, parent Pass 7. Canonical Meeting resource identity now resolves to its authorized CalendarEvent through a fresh, privacy-safe Meeting target endpoint. Standalone Meetings, Desktop URLs and copied browser Meeting links work through the same admission flow. New tests exercise actual server-route access policy, URI parsing, current Event identity and stale-session behavior. G27-05/06 still have remaining integrations; certification is not part of this source checkpoint. See `G27_PASS8_CANONICAL_MEETING_NAVIGATION_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 7

Canonical source: `Cluster-v0.546.0-G27-Pass7-Card-Permalink-Browser-Restore-Source.zip`, parent Pass 6. The common Copy Link flow now supports Card-only identities on Web and Desktop, and a copied browser URL cold-starts the existing per-Card authorized Board resolver rather than trusting or requiring a stale Board. Bounded URL parsing, once-per-identity hydration and denied/missing Card recovery preserve safe workspace state. Passes 1–7 inherited and focused source regressions pass; G27-05/06 stay open. See `G27_PASS7_CARD_PERMALINK_RESTORATION_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 6

Canonical source: `Cluster-v0.546.0-G27-Pass6-Authorized-Workspace-Search-DeepLinks-Source.zip`, parent G27 Pass 5. Cross-workspace Project/Board/Whiteboard navigation now uses fresh permission-checked resource reads before mutating workspace or inspector state; moved Board/Whiteboard links follow the current authorized parent and incomplete links cannot inherit stale selected Boards. Native Card-only links use Pass 5's fresh Card resolver; duplicate/revoked/changed identity Search entries stay denied while moved *authorized same-identity* results follow the new placement. Focused and inherited source-development regressions pass. G27-05/06 remain open. See `G27_PASS6_AUTHORIZED_WORKSPACE_SEARCH_DEEPLINK_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 5

Canonical source: `Cluster-v0.546.0-G27-Pass5-Authorized-Card-Activation-Source.zip`, parent G27 Pass 4. Cards in Inbox/My Work/Activity/Search/Work Actions now resolve their **current** Board and Project from fresh permission-filtered `/api/cards/:id` before navigation. Prior Board IDs and project placement are treated as non-authoritative hints; moved Cards follow their newly authorized location, while deleted/revoked/unavailable Cards leave the current screen intact and produce a recovery notice. Stale session and overlapping navigation operations cannot replay an old result. Historical Card notifications without a Board preserve their exact Card inspector for this resolver. Source-level regression and pure asynchronous fault tests pass; no full browser/Windows/Postgres certification claimed. See `G27_PASS5_AUTHORIZED_CARD_ACTIVATION_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 4

Canonical source: `Cluster-v0.546.0-G27-Pass4-Notification-Card-Placement-Source.zip`, parent G27 Pass 3. Fixes Card notifications (including My Work/Inbox, dashboard and Desktop notification routes) opening a previously selected, unrelated Board. Exact notification Board IDs are now preserved; no-Board historical Card notifications land on the parent Project or recipient Inbox rather than opening an incorrect Board, while malformed IDs are rejected. Adds executable routing tests and inherits the Pass 3 Forms/Search/Recent/Create regression matrix. Fresh per-Card board discovery and all G27-05/06 cross-tool coverage remain unfinished; release certification is separate. See `G27_PASS4_NOTIFICATION_CARD_PLACEMENT_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 3

Canonical complete source: `Cluster-v0.546.0-G27-Pass3-Authorized-Navigation-Create-Source.zip`, parent G27 Pass 2. Implements non-admin delegated Form reviewer deep-link routing to My Forms with exact per-response access checks, independent submission/reviewer projections, fresh online Recent Project/Board/Whiteboard admission and correct placement, permission-safe history titles, and record-ID-specific Create & Open for Calendar/Scheduler/Timeline/Packets. A duplicate Command Search TypeScript declaration is also fixed. Includes focused/inherited executable checks and a maintained source hash manifest. G27-05/06 and other cross-resource workflow obligations remain partial; Windows/PostgreSQL/browser certification is not claimed. See `G27_PASS3_NAVIGATION_FORMS_CREATE_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 2

Canonical complete source: `Cluster-v0.546.0-G27-Pass2-Delegated-Forms-Navigation-Source.zip`, parent G27 Pass 1. Repairs a real G27 cross-workspace deep-link gap: authorized per-Form delegated reviewers can now resolve a private non-application submission to its owning Form, without needing global Studio Settings edit. Missing, application and revoked/inaccessible targets yield indistinguishable generic 404s and no answers/identity. One canonical `canReviewForm` authority backs both detail and target routes. Adds executable admission tests and updates historically stale Studio Form route assertions without weakening the production policy. G27-05/06 remain source-partial; live and release gates remain open. See `G27_PASS2_DELEGATED_FORMS_DEEPLINK_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G27 Pass 1

Canonical complete source: `Cluster-v0.546.0-G27-Pass1-Fresh-Search-Admission-Source.zip`, parent G26 Pass 50. Moves into product-wide G27 with **uncached live Search result reauthorization at activation**, strict canonical location matching, stale/deferred-query refusal, session/ACL change interruption, and equivalent desktop-window admission. Search result clicks and detached-window opens navigate only from newly admitted results. Existing server admission remains the resource/permission authority; local commands and offline Projects remain separate and are not claimed as server-authorized. **G27-05 remains partially implemented**, other G27, G28, TD7 and live certification remain open. See `G27_PASS1_FRESH_SEARCH_ACTIVATION.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 50

Canonical complete source: `Cluster-v0.546.0-G26-Pass50-MSI-Ledger-Durability-Source.zip`, parent Pass 49. Source-level one-use grant ledger, first-write MSI journal, atomic journal replacements and operation-lock directory custody now flush their containing directories when supported, with checked nonce-file identity and fail-closed POSIX errors. Windows directory flushing is not reliably supported and **not certified as power-loss durable**. Native Go/Windows crossbuild and **1,928/1,928** combined source/portable assertions passed; G26-10/11 and CERT-12 remain OPEN. See `G26_PASS50_GRANT_LEDGER_AND_MSI_JOURNAL_DURABILITY.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 49

Canonical complete source: `Cluster-v0.546.0-G26-Pass49-MSI-Incident-Worklist-Source.zip`, parent Pass 48. Adds a profile-wide, bounded read-only incident inventory across all original MSI receipts/locks and lifecycle journals, including missing/mismatched predecessor receipts. Native CLI, authenticated Qt bridge, Desktop validator and operator evidence-copy UI independently enforce **no mutation, no replay and no OS-health attestation**. Source, native Go/Windows cross-build and adversarial checks pass; live Windows/linked Qt/PostgreSQL certification is not claimed. G26-10/11 and CERT-12 remain open. See `G26_PASS49_PROFILE_MSI_INCIDENT_WORKLIST.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 48

Canonical full source: `Cluster-v0.546.0-G26-Pass48-MSI-Receipt-Byte-Coherence-Source.zip`, parent Pass 47. Extends Pass47's read-only dependent MSI incident triage with a *two-pass SHA-256 byte fence* across every bounded MSI installation receipt and lifecycle journal in the profile. Same-file, same-size, timestamp-preserving rewrites between receipt reads are rejected even if the old FileInfo snapshot appeared stable; namespaces cannot collide. No new mutation scope, replay, journal removal or automatic recovery. **1,814/1,814** combined portable/source assertions (28 new); Go unit/race/vet and Windows x64 binary/native-test crossbuild passed. No live Windows Installer, linked Qt or PostgreSQL certification. G26-10/G26-11/CERT-12 remain open. See `G26_PASS48_MSI_PROFILE_RECEIPT_BYTE_COHERENCE.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 47

Canonical complete source: `Cluster-v0.546.0-G26-Pass47-MSI-Incident-Continuity-Source.zip`, parent Pass 46. Adds **journal-specific, read-only incident continuity** to the dependency-ordered MSI recovery workbook. Every child carries exact lifecycle journal SHA-256/state or an explicit unrecorded state, a derived non-executable recovery action, and the plan identifies any manual-recovery Packages and at most one independently reviewable next Package. Native Go, Qt and Desktop independently validate the summary. **1,786/1,786** portable/source checks (76 new), Go unit/race/vet and Windows x64 crossbuild passed. No automatic recovery, shared grants, journal deletion, live Windows MSI/linked Qt/PostgreSQL certification or application-health attestation. G26-10/G26-11/CERT-12 remain open. See `G26_PASS47_DEPENDENT_MSI_RECOVERY_INCIDENT_CONTINUITY.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 46

Canonical complete source: `Cluster-v0.546.0-G26-Pass46-MSI-Dependent-Disposition-Source.zip`, parent Pass 45. Pass 46 recognizes **independently completed, receipt-matched MSI uninstall journals plus current scoped Windows Installer ProductCode absence** to advance a bounded dependents-first rollback workflow. Both distinct native mutation operations remain individually grant-bound and journaled; repair does not inherit this relief. Qt/Desktop validators verify settled/outstanding partitions, and Desktop refreshes the exact native dependency plan before authorizing each dependent or root operation. **1,710/1,710** portable/source checks (73 new), Go unit/race/vet/Windows cross-compilation passed. No automatic batch execution, no OS/application-health attestation, no live Windows/linked Qt/PostgreSQL testing. G26-10/G26-11/CERT-12 remain OPEN. See `G26_PASS46_DEPENDENT_DISPOSITION_CUSTODY.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 45

Canonical full source: `Cluster-v0.546.0-G26-Pass45-Dependency-Ordered-MSI-Recovery-Source.zip`, parent Pass 44. Adds a bounded, read-only, dependency-ordered MSI rollback recovery workflow with per-Package separately authorized uninstall review and target rollback review, exact receipt hashes, blocker evidence, authenticated Qt/typed Desktop verification and no batch mutation or automatic grant. **1,637/1,637** combined source/portable checks, native Go unit/race/vet and Windows x64 app/test cross-build passed. Dependency-disposition execution orchestration, real Windows/Qt/PostgreSQL certification and application health remain open; see `G26_PASS45_DEPENDENCY_ORDERED_MSI_RECOVERY_WORKFLOW.md`. G26-10/G26-11/CERT-12 remain OPEN.

# Cluster source checkpoint: v0.546.0 G26 Pass 44

Canonical full source: `Cluster-v0.546.0-G26-Pass44-Supervised-MSI-Rollback-Source.zip`, parent Pass 43. Implements independently signed, administrator-opt-in *supervised MSI rollback execution* with four-hash predecessor/upgrade custody, a distinct crash-retained and non-replayable `rollback_<packageKey>.json` journal, double-protected predecessor/successor MSI source handles, Job-supervised suspended Windows Installer process, and native Qt/Desktop typed operator confirmation plus read-only registration-status recovery. Preserves both the original installation attempt and completed upgrade journal. No automatic uninstall, forced downgrade, dependency cascade, replay or OS/application-health attestation. **1,578/1,578** portable/source checks, Go unit/race/vet, Windows x64 Go application/test cross-compile; **no live Qt/Windows/PostgreSQL certification**. G26-10/11 and CERT-12 remain open. See `G26_PASS44_SUPERVISED_MSI_ROLLBACK_EXECUTION.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 43

Canonical full source: `Cluster-v0.546.0-G26-Pass43-MSI-Rollback-Review-Source.zip`, parent Pass 42. Adds a bounded, read-only MSI rollback custody and transitive dependency-order review in native Go, authenticated Qt, and Desktop, retaining predecessor and successor MSI source identity and refusing unknown/foreign/changed evidence. Adds a separate, cryptographically isolated four-hash `msi-rollback` signer/verifier scope **without an issuing API or native rollback executor**. Pass43: 113 new source/portable assertions; 1,494/1,494 total, Go tests/race/vet and Windows cross-build passed. **No automatic MSI downgrade/rollback, no OS-health attestation and no live Windows/Qt certification.** G26-10/11 and CERT-12 stay open. See `G26_PASS43_MSI_ROLLBACK_REVIEW_AND_GRANT_CONTRACT.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 42

Canonical full source: `Cluster-v0.546.0-G26-Pass42-Supervised-MSI-Upgrade-Source.zip`, parent Pass 41. Adds separately authorized, default-disabled, supervised Windows MSI upgrade execution with a durable non-replay lifecycle journal, retained predecessor/target MSI file handles and checksum checks, final signed receipt/dependency/product registration revalidation immediately before suspended child resume, Qt/Desktop typed confirmation and read-only Windows registration recovery. The original successful install receipt is retained. **No automatic rollback or success attestation.** 1,381/1,381 portable/source checks, native Go race/vet and Windows cross-compilation passed; **not live Windows/Qt certified**. G26-10/11 and CERT-12 remain open. See `G26_PASS42_SIGNED_SUPERVISED_MSI_UPGRADE_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 41

Canonical full source: `Cluster-v0.546.0-G26-Pass41-Upgrade-Grant-Contract-Source.zip`, parent Pass 40. Adds administrator opt-in, separately signed `upgrade` authorization bound to both the exact predecessor receipt digest and predecessor MSI bytes digest. Native Go verifies the identical operation-specific scope. **No executable upgrade CLI, journal or rollback authority exists yet; grant response explicitly marks `executableInstallationAllowed: false`.** 1,321/1,321 portable/source checks, Go race/vet and Windows cross-compilation passed. G26-10/11 and CERT-12 stay open. See `G26_PASS41_MSI_UPGRADE_GRANT_CONTRACT.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 40

Canonical full source: `Cluster-v0.546.0-G26-Pass40-MSI-Upgrade-Rollback-Readiness-Source.zip`, parent Pass 39. Native, Qt and Desktop implement a signed, read-only same-ProductCode minor-upgrade readiness review requiring a retained, digest-verified predecessor MSI and an exact prior receipt. Neither upgrade mutation authority nor automatic rollback is enabled. The full suite passes 1,285 source/portable assertions, Go/race/vet and Windows x64 crossbuild; no linked Qt/Windows certification. G26-10, G26-11 and CERT-12 remain open. See `G26_PASS40_MSI_UPGRADE_READINESS_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 39

Canonical full source: `Cluster-v0.546.0-G26-Pass39-MSI-Lifecycle-Custody-Source.zip`, parent Pass 38. Native, Qt and Desktop now incorporate independently validated, stable repair/uninstall lifecycle journals in profile recovery, dependency admission and cross-Package ProductCode custody. This refuses old successful install receipts as proof of active MSI prerequisites after a lifecycle operation. No automatic rollback/upgrade or live Windows certification. G26-10, G26-11 and CERT-12 remain open. See `G26_PASS39_MSI_LIFECYCLE_CUSTODY_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 38

Canonical full source: `Cluster-v0.546.0-G26-Pass38-Supervised-MSI-Uninstall-Source.zip`, parent Pass 37. Adds separately server-signed default-disabled MSI uninstall grants, exact prior receipt and no-known-dependents gates, shared no-replay lifecycle journaling, fixed supervised Windows `/x` execution, and Qt/Desktop guarded confirmation/status. Tests are source/portable/Go cross-build only, **NOT** live Windows MSI certification. G26-10, G26-11 and CERT-12 remain open. See `G26_PASS38_SUPERVISED_MSI_UNINSTALL_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 37

Canonical full source: `Cluster-v0.546.0-G26-Pass37-Supervised-MSI-Repair-Source.zip`, parent Pass 36. This pass adds a separately signed, administrator-opt-in MSI repair operation, an exact prior receipt hash binding, independent per-user Windows registration and signed dependency admission, crash-retained lifecycle journal, guarded Qt/Desktop execution and read-only status, plus executable adversarial tests and a Desktop grant-owner race fix. Windows runtime and deployment certification have NOT occurred; feature flag defaults off. G26-10, G26-11 and CERT-12 remain open. See `G26_PASS37_SUPERVISED_MSI_REPAIR_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 36

Canonical full source: `Cluster-v0.546.0-G26-Pass36-MSI-Lifecycle-Review-Source.zip`. Source baseline: Pass 35. This pass adds bounded, independently validated read-only lifecycle review decisions for upgrade, repair and uninstall across coherent MSI profile receipts and known dependencies, with a 768 KiB Qt/native response contract. G26-10, G26-11 and CERT-12 remain open. Actual signed operation grants, safe rollback, Windows execution, Qt runtime and server integration have not been certified. See `G26_PASS36_MSI_LIFECYCLE_REVIEW_CLOSEOUT.md`.

# Cluster source checkpoint: v0.546.0 G26 Pass 35

Canonical full source: `Cluster-v0.546.0-G26-Pass35-Signed-MSI-Dependency-Source.zip`.

Pass 35 differentiates signed `content-selected` versus `msi-installed` prerequisites in the server, offline signer, Desktop and native helper. Native preflight checks MSI registration and durable receipt identity before consuming an install grant, saves those snapshots in the original receipt, and rechecks after grant consumption and immediately before suspended-child resume. Read-only MSI profile inspection derives an independently validated known-receipt dependency graph. No repair/uninstall/update/rollback authority is granted.

See `G26_PASS35_SIGNED_MSI_DEPENDENCY_LIFECYCLE.md`. Pass 34 → Pass 35 overlay is reproducible against its source baseline. The canonical master roadmap and work register retain G26-10/11 and CERT-12 as open.

Source, Go portable, Windows cross-build and code-level testing only. Linked Qt6, actual Windows installer execution and sharing semantics, backend PostgreSQL18/Node24, post-reboot app health and independently authorized repair/update/uninstall/rollback are **not certified**.

# Cluster source checkpoint: v0.546.0 G26 Pass 34

Canonical full source: `Cluster-v0.546.0-G26-Pass34-MSI-Immutable-Source-Resume-Guard-Source.zip`.

Pass34 adds the Windows held-handle immutability guard around verified MSI execution and a last two-sample Windows ProductCode admission check after creating the suspended child, before resuming it. It also verifies the held source after process completion and returns an unknown outcome on drift. Pass31/32 receipt transition and Qt profile parity are retained.

See `G26_PASS34_MSI_IMMUTABLE_SOURCE_AND_RESUME_GATE.md`. Pass32 → Pass34 overlay is reproducible against its source baseline. The canonical master roadmap and work register retain G26-10/11 and CERT-12 as open.

Source/portable/Go testing only. Linked Qt6, actual Windows MSI execution and sharing semantics, backend PostgreSQL18/Node24, post-reboot app health and independently authorized repair/update/uninstall/rollback are **not certified**.
