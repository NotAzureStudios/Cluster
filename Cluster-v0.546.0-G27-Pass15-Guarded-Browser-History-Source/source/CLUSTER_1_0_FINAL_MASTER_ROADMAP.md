### G26 Pass 50 | Grant replay ledger and native MSI custody durability (2026-10-24)

Strengthened the native one-use signed grant ledger with first-create exclusivity, persistent Package/operation evidence, read-back file identity/size checks, and containing-directory sync where supported. Initial MSI lifecycle receipts, atomic journal replacements, MSI install receipts, and operation locks now also flush parent directory metadata after file writes/creates. Unexpected POSIX flush failure fails closed; Windows directory `Sync` support remains inconsistent and is **not** a power-loss certification claim. This improves both supervised MSI and shared managed-content grant custody without granting retries, clearing evidence, or automatically executing recovery. 32 new native/source checks, **1,928/1,928 total**; Go race/vet and Windows x64 crossbuild passed. G26-10/G26-11/CERT-12 remain OPEN. See `G26_PASS50_GRANT_LEDGER_AND_MSI_JOURNAL_DURABILITY.md`.

### G26 Pass 49 | Profile-wide MSI recovery incident worklist (2026-10-24)

Adds a bounded read-only recovery incident inventory over every coherent MSI attempt/lock and lifecycle journal, **including orphan journals** without matching original receipt custody. Stable case IDs, strict predecessor receipt digest comparisons, original registration observations and non-replay recovery classifications are available through a signed-in, profile-root-owned Qt capability and independently validated Desktop table. The operator can copy full case hashes without grants, absolute paths, or executable authority. Native CLI refuses grant/release/Package selector material. Adversarial native and renderer/Qt contract tests pass, while no journal clearance, OS-health attestation, automated cascade or live Windows certification is claimed. G26-10/11 and CERT-12 remain OPEN; see `G26_PASS49_PROFILE_MSI_INCIDENT_WORKLIST.md`.

### G26 Pass 45 | Dependency-ordered MSI recovery workflow (2026-10-24)

Implemented a read-only, per-Package rollback disposition workflow from canonical receipt-bound transitive dependencies. Go derives an exact dependents-first sequence, validates each dependent's uninstall-review blockers and the root's signed rollback custody, and records separate authorization requirements without carrying or issuing grants. Qt/renderer independently validate unique identities, prerequisite order, blocker coherence and non-authorizing flags. 59 new checks; 1,637 combined, Go unit/race/vet and Windows cross-build pass. **No automatic dependent uninstall, cascade rollback or clearance of stale dependency records** is implemented. G26-10, G26-11 and CERT-12 remain open; linked Qt/real Windows certification deferred. See `G26_PASS45_DEPENDENCY_ORDERED_MSI_RECOVERY_WORKFLOW.md`.

### G26 Pass 44 | Signed supervised MSI rollback executor (2026-10-24)

Added the independently administrator-authorized, default-disabled native `msi-rollback` execution path. The server and native verifier bind four exact predecessor, upgraded-source and journal SHA-256 identities; the helper writes a **separate non-replayable rollback journal before consuming a one-use grant**, retains the original installation attempt and completed upgrade evidence unchanged, protects both MSI byte sources and supervises a single suspended Windows `msiexec /i predecessor` attempt. Late registration, dependency, journal and source changes block resume; known dependents require their own authorized disposition, so multi-Package cascades are **not implemented**. Qt/Desktop independently verify recovery with a typed `ROLLBACK` confirmation; installer exit and product registration never establish application health. 1,578/1,578 portable/source checks and Go unit/race/vet/Windows cross-build passed; actual Windows MSI downgrade outcomes and linked Qt remain unverified. **G26-10, G26-11 and CERT-12 remain open**. See `G26_PASS44_SUPERVISED_MSI_ROLLBACK_EXECUTION.md`.

**Implementation progress (G26 Pass 41):** Server and native deployment grant contracts now accept an independent, default-disabled signed `upgrade` operation bound to both exact previous installation receipt SHA-256 and retained original MSI SHA-256. All other grant operations reject upgrade-only fields. Server replies `signed_upgrade_grant_not_executable` and `executableInstallationAllowed: false`; there is no native upgrade mutation executor or rollback authority yet. Go and source-bound tests pass; G26-10/11 and CERT-12 remain open. See `G26_PASS41_MSI_UPGRADE_GRANT_CONTRACT.md`.

**Implementation progress (G26 Pass 40):** Signed, read-only MSI minor-upgrade readiness now requires a retained, digest-verified original MSI source from a durable install receipt, identical ProductCode, strictly increasing same-major MSI ProductVersion, unchanged Windows registration, and absence of known dependent Packages or lifecycle journals. Qt/Desktop validate and present this as a no-install review; no upgrade grant, mutation, automatic rollback or application health attestation is implemented. Go/renderer source tests pass; Windows/Qt runtime certification remains open. See `G26_PASS40_MSI_UPGRADE_READINESS_CLOSEOUT.md`.

**Implementation progress (G26 Pass 38):** Added distinct, separately Ed25519-authorized, administrator-opt-in supervised **per-user Windows MSI uninstall** with an exact original install receipt SHA-256, coherent current-user registration, no-known-dependents block, shared immutable-history lifecycle journal and fixed Job-supervised `msiexec /x` ProductCode command. Qt Desktop requires a typed irreversible-action confirmation and validates a dedicated read-only uninstall journal before fetching grant. Tests pass on source, Go and Windows cross-compile; no live Windows runtime, removal health, global OS dependency scan, automatic rollback or signed upgrade executor is attested. G26-10/11 and CERT-12 remain open. See `G26_PASS38_SUPERVISED_MSI_UNINSTALL_CLOSEOUT.md`.

**Implementation progress (G26 Pass 37):** Implemented default-disabled, independently server-signed, administrator-authorized supervised per-user MSI **repair**, distinct from install. Repair binds exact prior installation receipt SHA-256, rechecks registered user scope and signed dependencies, refuses known dependents and any previous lifecycle journal, writes a crash-retained repair receipt before consuming its one-use grant and executing a fixed, Job-supervised Windows Installer repair. Qt and Desktop have separate action/status/evidence validation with typed operator confirmation. Portable/Go adversarial regressions pass; Windows runtime, upgrade, uninstall, dependency-aware rollback and post-reboot application health remain open. See `G26_PASS37_SUPERVISED_MSI_REPAIR_CLOSEOUT.md`.

**Implementation progress (G26 Pass 22):** Durable native evidence linking now has distinct retained-file vs relationship statuses in Transfer Center and Sync Center; the journal rejects fabricated/inconsistent evidence completion receipts; native push includes current queue posture to avoid duplicate per-tick bridge reads; workflow-link POST now returns an existing authorized relationship after a unique collision without modifying creator metadata or duplicating activity. Focused concurrent-replay tests and inherited transfer regressions pass. G26-08/09 remain source-partial pending linked Qt and Windows/PostgreSQL acceptance. See `G26_EVIDENCE_RECOVERY_STATUS_PASS22.md`.

**Implementation progress (G26 Pass 20):** Added a durable verified-upload completion receipt before downstream Project-file finalization. On manual crash recovery, Desktop replays only the existing authenticated, idempotent Project-file endpoint and validates its Project/file/checksum/size result before acknowledging completion. The failed/lost finalization reply can no longer require blindly recreating the consumed upload session. 492 reported compiled portable/source assertions pass; live Qt/Windows 10 remains unverified. G26-08/09 still source-partial. See `G26_NATIVE_UPLOAD_FINALIZATION_REPLAY_PASS20.md`.

**Implementation progress (G26 Pass 19):** Corrected invalid freshly queued native download journal records; bounded upload source identity and checked it on every continuation, checksum and server completion; upload session requests refuse redirects; recovered download paths outside the current Downloads root are preserved without granting native write/commit/open rights. Focused and inherited portable/source regressions passed; Qt and Windows runtime verification remain open. G26-08/09 still source-partial. See `G26_NATIVE_TRANSFER_RECOVERY_SOURCE_IDENTITY_PASS19.md`.

**Implementation progress (G26 Passes 17–18):** Desktop Qt transfer journal now validates every persisted record, bounds JSON reads/writes, and constrains cancellation cleanup to its owned `.cluster-part` sibling. The missing `transfer.download` and `transfer.uploadProjectFile` native capabilities are connected through authenticated, durable queue admissions; downloads are same-server only and uploads use opaque handles plus the canonical project-files finalization route. Persisted session IDs and paths are validated. Unsupported related-work evidence linking now rejects explicitly rather than silently pretending success. G26-08/09 remain open; see `G26_STRICT_TRANSFER_JOURNAL_CLOSEOUT.md` and `G26_NATIVE_TRANSFER_ADMISSION_CLOSEOUT.md`.

**Implementation progress (G26 Pass 16):** Native Qt download completion now journals SHA-256 commit intent before final rename; crash recovery from either retained partial or already-final file requires explicit manual resume and full independent rehash. Two-phase completion still unverified on actual Qt/Windows 10 and G26-08/09 remain open. See `G26_TWO_PHASE_DOWNLOAD_COMMIT_RECOVERY_CLOSEOUT.md`.

**Implementation progress (G26 Pass 15):** Native Desktop Transfer Center actions now return actual committed queue mutation outcomes. Pausing/cancelling/continuing/removing failed saves or invalid states can no longer report `{updated:true}`; Retry All reports possible partial success instead of pretending atomicity. Source contracts pass; actual Qt/Windows tests not run. G26-08/09 remain source-partial. See `G26_NATIVE_TRANSFER_MUTATION_ACKNOWLEDGMENT_CLOSEOUT.md`.

**Implementation progress (G26 Pass 14):** Existing Qt TransferManager now holds all post-admission work when its atomic queue journal write fails, preserves bytes and prior committed queue state, and requires explicit reload plus manual transfer resume. New `journal-write-failed` native/Desktop status is separate from corruption and another-window ownership. Source assertions and inherited contracts pass; G26-08/09 **remain source-partial**, with real Qt/Windows disk-full, restart, two-window, and server authorization acceptance unverified. See `G26_TRANSFER_JOURNAL_WRITE_FAILURE_HOLD_CLOSEOUT.md`.

**CURRENT SOURCE FOLLOW-ON (G26 Pass 13; supersedes Pass 12):** Native Desktop now distinguishes a malformed/unreadable transfer queue from another window holding the writer lease. New allowlisted read-only `transfer.status` reports redacted status, `transfer.claim` cannot override corrupt history, mutating routes report the precise reason, and Transfer Center surfaces the journal hold even with zero rows without creating fake jobs. Source contracts and TypeScript structural scan passed; actual Qt 6.11.2/Windows 10 behavior is not certified. G26-08/09 remain source-partial. See `G26_NATIVE_TRANSFER_JOURNAL_VISIBILITY_CLOSEOUT.md`.

**CURRENT SOURCE FOLLOW-ON (G26 Pass 12; supersedes Pass 11):** Desktop Qt transfer queue admission reserves both destination and partial paths against files/symlinks/queued jobs, preserves nonterminal records rather than truncating at 200, and requires an atomic journal commit before reporting a new transfer accepted. Corrupt/unreadable journals hold read-only; legacy migration keeps its source until the replacement commits. In-flight download `readyRead` progress no longer rewrites the full queue journal. Source contracts plus compiled portable C++ retention tests passed; **no Qt/Windows 10 live certification**. G26-08/09 remain source-partial. See `G26_DESKTOP_QUEUE_CUSTODY_AND_PROGRESS_CLOSEOUT.md`.

# Cluster 1.0 | FINAL Master Completion & Certification Roadmap

**Document authority:** single surviving master roadmap for Cluster 1.0. This file supersedes **planning order and future to-do lists** in the historical TD0–TD6, G25–G28, F2–F4 and release documents without rewriting their evidence. **Baseline:** Cluster v0.546.0, **F4 P15** (October 23, 2026). **Scope:** internal self-hosted game studio platform, Windows 10 primary deployment, Node 24, PostgreSQL 18, native Go service/Win32 panel/Qt desktop, optional Garnet, separate optional Linux/Docker profile. **Status:** active plan, **NOT release-ready**.

**Implementation progress (G26 download continuation bound, Pass 11):** The Desktop HTTP range policy now rejects excessively tiny nonfinal 206 fragments for large objects, preventing request amplification from pathological partial-range replies; final short tails remain valid. Standalone C++ policy and source contracts passed; real Qt/Windows acceptance remains open. See `G26_DOWNLOAD_CONTINUATION_REQUEST_BOUND_CLOSEOUT.md`.

**Implementation progress (G26 branch reconciliation, Pass 10):** Combined the verified but diverged Qt Desktop download continuity / multi-window transfer writer / canonical upload-session branches with the newer native transfer pending-checkpoint recovery lineage. Fixed fresh-profile queue initialization so the native Qt writer creates its own app-data transfer directory before attempting QLockFile ownership. All core G26-08/09 requirements remain **source-partial**, with browser/mobile parity, full Qt 6.11.2 Windows build, two-process live behavior, and auth/revocation acceptance unverified. The `G26_BRANCH_RECONCILIATION_CLOSEOUT.md` records the merge and tests; this is not a parallel roadmap.

**Implementation progress (G26 supervised MSI process, follow-on Pass 4):** Signed per-user Windows MSI now starts suspended and is assigned to a native kill-on-close Job Object before resumption, with a bounded 15-minute helper deadline rather than Qt's generic 30-second staging timeout. **The external Windows Installer service remains out-of-job; source safety is not Windows deployment certification.** See `G26_MSI_SUSPENDED_JOB_SUPERVISION_CLOSEOUT.md`; `G26-10/11` remain open.

**Implementation progress (G26 native custody integrity, follow-on Pass 3):** `transfer-inspect` is now strictly read-only even for missing identities. Stable metadata and payload verification, dual-payload/rename refusal, and identity-checked transfer/MSI lock cleanup are implemented and tested; full multi-client Transfer Center/Windows MSI certification remains open. The transfer append full-prefix rehash O(n²/chunk) performance risk is explicitly tracked. See `G26_NATIVE_TRANSFER_MSI_CUSTODY_INTEGRITY_CLOSEOUT.md`.

**Implementation progress (G26 transfer diagnostics, follow-on Pass 2):** Added strictly read-only local diagnostics (including stranded-lock warning) across native Go/Qt/renderer UI; does not clear locks or infer installer success. G26-08/09 remain source-partial. See `G26_NATIVE_ARCHIVE_DIAGNOSTIC_CLOSEOUT.md`.

**Implementation progress (G26 transfer recovery, post-F4 P15):** Added explicit read-only-boundary native archive checkpoint reconciliation for interrupted append/commit, including Go/Qt/renderer UI and focused negative tests. `G26-08` and `G26-09` remain **source-partial** because global Transfer Center parity, browser/mobile/multi-window interruption and live Windows 10 + authorization-after-restart still require acceptance. See `G26_NATIVE_ARCHIVE_RECOVERY_CLOSEOUT.md`. The implementation baseline remains F4 P15 for F2–F4; this is a G26 source follow-on, not release certification.

> **Continuity rule:** This is the *last new roadmap*. From here, update the version/revision and the stable IDs in this document and its adjacent JSON register. Do not invent a separate planning scheme, drop open work because another phase number advanced, or announce new percent-complete estimates without line-item evidence. Close work via code, acceptance proof or explicit recorded scope decision.

## 1. Authority, evidence and acceptance vocabulary

**Evidence checked:** `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`, `TECH_DEBT_MASTER_ROADMAP.md`, `TD6_CONSOLIDATED_G25_TO_G28_PLAN.md`, `TD6_G07_CD01_CD20_FEATURE_LEDGER.md`, `TD6_G25_WORKSTREAM17_SOURCE_CLOSEOUT.md`, `TD6_G26_IMPLEMENTATION_STATUS_LEDGER.md`, `TD6_G27_BATCH8_TO_G27_CLOSEOUT_HANDOFF.md`, `F4_P15_TO_CLUSTER_1_0_HANDOFF.md`, `F4_P15_UPDATE_RECOVERY_GATE_CLOSEOUT.md`, plus `Cluster-v0.546.0-F4-P15-Roadmap-Gap-Reconciliation.md`. Planning and checkpoint language is not a substitute for independent code/build inspection. This is a reconciliation of the recorded commitments, not proof that every historical defect still reproduces.

**Current checkpoint baseline:** G25 is **source-closed**, not runtime certified. G26 still **open**. G27 Batches 1–8 source implemented, **G27 still open**. G28 **not closed**. TD1/TD2 core and TD3 shared-appearance bounded source scope marked closed historically, with operational release acceptance pending. TD4/TD5 integrations remain specific requirements, not invitations to rewrite whole frameworks. F2–F4 through F4 P15 contain substantial source-implemented operations and safety improvements, but a native Service-owned restart/update executor is **not implemented**; backup/window preflight intentionally remains `executable:false`. TD7 **not started**. Release certification **not run**. The CD ledger from G07 is historical and must not overrule newer G25/G26/G27 evidence.

**Status labels:**

- `source-closed-unverified`: source implementation was explicitly closed for its scoped requirements, but full real-runtime acceptance remains open.
- `source-partial`: real implementations exist; connected workflow, authority integration or proof has remaining obligations.
- `needs-audit`: existence/coverage requires source and real-workflow verification, not automatically a defect.
- `not-implemented` / `not-started`: roadmap handoff explicitly identifies a missing implementation.
- `blocked-safe`: risky behavior deliberately disabled pending a safety gate. Never convert this into a TODO to blindly turn on.
- `provider-decision`: optional external adapter scope must be documented as required for 1.0 or deferred to 1.1.
- `not-run`: live deployment/certification evidence is absent.
- `open`: defined completion work without closure evidence.

**Independent completion dimensions per ID:** source implementation; backend permissions/data contracts; integrated user/native UI; focused negative/fault tests; full dependency build; real runtime validation; user acceptance; and a release/block/defer decision. Completing one dimension must never overwrite the others.

## 2. Release scope and non-negotiable boundaries

**1.0 required:** reliable projects/work lifecycle, Boards, Whiteboards, Tickets, Builds/QA, Calendar/Scheduler, Forms, Library/Packets/Transfer, People/permissions, security/Privacy/Backup, core Packages for approved native deployment, self-hosted Server Manager, consistent Search/Create/Help/Notifications and recoverable operation. Include supported Git/LFS, Unreal and Discord source integration (real-provider proof is certification). Preserve Home/My Work, widget behavior, responsive/mobile and native Desktop within the already promised first-party boundaries.

**Remain out of 1.0 by default:** external `/portal` with client/guest experience, separate chat/DM product, separate wiki instead of extending Packets, dynamic/public plugin marketplace, universal automation builder, hosted cloud multi-tenancy, broad third-party provider ecosystem, speculative collaboration options, and purely ornamental redesign. **These are visible 1.1+ candidates**, not hidden omissions. Contractor users *inside* Cluster remain governed by existing account type/permissions scope; external portal is separate.

**Never waive without explicit operator approval and tested mitigation:** no unsolicited public API/DB exposure; secrets/PII must not leak; access verified at time of action; safe backup/restore before changes; do not enable irrecoverable Library provider deletion, arbitrary MSI execution, unattended update or external credential automation merely because a source contract exists. Default planned maintenance *does not execute* updates automatically. One protected PIN when saving sensitive batch changes, no PIN per individual field edit. Admin authorization is enforced server-side.

**Design:** Apple-inspired restrained visual system, Comfortaa as preferred identity font where readable, neutral/dark palette, efficient working areas, compact/dense options and real accessibility. Official CL-DS-001 v1.3.0 path `source/docs/design/CLUSTER_STUDIO_STYLE_GUIDE.md` is **absent from the audited F4 P15 ZIP**; recover the authoritative document before claiming precise style-guide compliance. Do not reconstruct it from guessed rules. No disruptive redesign of source-closed TD3 shell. Confirm native Qt / mobile parity with actual UI runs.

## 3. One execution sequence: connected work packages, not endless decimal passes

| Order | Package | Must deliver before closing | Source vs real-machine gate |
|---|---|---|---|
| A | **G26 source closeout** | Safety-bounded Library, retention, derivatives, Packet distribution, durable Transfers, trusted Windows Packages, Inventory/Vault and integration source owners; formally record blocked destructive actions | Source/UI, adversarial tests; native/physical acceptance remains separate |
| B | **G27 source closeout** | People lifecycle, unified Search/Create/Help/Inbox, Home, actionable Operations, one-PIN Settings, high-density/Qt/mobile source UI | Cross-tool source/e2e-mock evidence; live rendered acceptance later |
| C | **F2–F4 native & maintenance executor** | Exclusive Service-owned drain → restart (update only when separately authorized) → recovery verification; bounded networking, fail-safe alerts, Windows 10 support, no self-restarting JS | Code, fault simulation first; no unattended production action before live certification |
| D | **G28 product reconciliation** | All 20 CD entries plus micro-UX/small-wins closed by evidence, or explicit approved deferral; repair newly revealed source gaps | No hidden unknowns or silently rebranded defects |
| E | **TD7 fossil cleanup / release freeze** | Remove dead code only with replacement evidence, optimize requests with measurements, close warnings, produce manifest/migration inventory | Full dependency build must be green before freeze |
| F | **Real certification / release** | Disposable PostgreSQL migrations & restore, Windows 10 SCM/Qt/Garnet/SMB/NAS/Unreal/Discord, security/load/DPI/soak, verified installer/signature | Only this can authorize **1.0 Stable** |

**Dependencies, not dogma:** Native execution work can proceed alongside A/B where source interfaces are stable; G28 begins as a running ledger immediately and performs final closeout after A/B/C. Rerun targeted regressions each package; never defer all testing. Avoid producing one phase number for every helper.

## 4. Twenty-feature completion charter (G28 controls)

| Feature | Current source disposition | Required 1.0 closeout / acceptance question |
|---|---|---|
| CD-01 Forms | G25 scoped source-closed; unverified | Author → assign → respondent draft → deadline → submit → delegated review → authorized follow-up across users, devices and revisions. |
| CD-02 Library | G26 partial | Folder/collections/versions/records/bulk, permission-safe previews and storage recovery; no bypass of holds or unsafe physical disposal. |
| CD-03 Boards / Whiteboards / collaboration | G25 scoped source-closed; unverified | Two-editor/offline saved operation history, approved reversible Undo, privacy-safe comments, conflicts and deliberate Ticket conversion. |
| CD-04 People | G27 partial | Application → onboarding → scoped access/expiry → offboard → return without resurrecting historical privileges. |
| CD-05 Inventory | G26 partial | Seat/key custody, expiry, renewal and offboarding with current entitlement and audit; provider connections explicitly scoped. |
| CD-06 Vault | G26 partial | Independent reviewed rotation, reveal/replace/revoke, transactionally committed audit, no secret bleed or stale privileges. |
| CD-07 Packets / delivery | G26 partial | Secure version-pinned PDF/video/audio, source-vs-recipient rights, decision/acknowledgment/reminders and watermark choices. |
| CD-08 Native Packages / desktop | G26 critical open | Trusted staged → OS installed → repaired/uninstalled → crash/reboot recovered, signed and authorized with dependent rollback. |
| CD-09 Git, Unreal, Discord | Contracts exist; audit needed | Source integration complete and live two-workstation LFS/UE and actual Discord permission/revocation proof. |
| CD-10 Projects | G25 scoped source-closed; unverified | Internal/external/codename/aliases, Plan/Build/QA/Ticket readiness and review/closeout with safe projections. |
| CD-11 Calendar / Scheduler | G25 scoped source-closed; unverified | Recurrence occurrence identity, room reservation collision, DST, RSVP, meetings, capacity and privacy. |
| CD-12 Shell / appearance | TD3 bounded source-closed; runtime unverified | Actual web/Qt/mobile/a11y/DPI parity; sidebar/taskbar, no clipped icons, readable dense layouts. |
| CD-13 Transfer Center | G26 partial | Durable native/web stream pause/resume/retry/cancel, checksums, real progress, interrupted handoff and device reconnect. |
| CD-14 Search / Actions | G27 unfinished | Actual resource coverage with one action authority, verified deep links, Copy ID/Path/Link, context-preserving navigation. |
| CD-15 Setup / Settings | G27/F2/F4 partial | Safe OOBE, revisioned settings/import-diff/rollback, single PIN Save, operator recovery on actual server. |
| CD-16 Communications | G27 partial | Inbox/announcements/alerts/preferences/quiet-hours, permission-safe links, scopes, critical override and deduplicated delivery. |
| CD-17 Operations | F2/F3/F4 advanced source; incomplete | Native maintenance executor, service/network/worker resources, actionable incidents/on-call, owner and auditable recovery. |
| CD-18 Builds / QA | G25 scoped source-closed; unverified | Git/UE provenance and branch/QA blocker gate connected to actual Project readiness and Ticket triage. |
| CD-19 Interaction consistency | G27 unfinished | Truthful save/queued/failed/disabled status, complete Help/errors, Create feedback, Undo limits, keyboard/touch focus across tools. |
| CD-20 Data / privacy / retention / backup | G26/F4 partial | Data rights, audit, legal holds, provider-safe disposal *gated*, restorable backup, recovery drill and secret-preserving export/erasure. |

**Special acceptance journeys never to lose:** blank Board stays blank; intentional empty ticket automation rules remain `[]` after restart; no Ticket silently chooses a different Board; a person with unknown capacity does **not** show fabricated utilization; Whiteboard/Review intentionally creates a linked Ticket without source mutation; failed QA or `Changes requested` blocks a release for the exact version; revoked Packet reviewer cannot fetch source or derivatives; detached Calendar occurrence retains original identity through DST; multiwindow large file transfer resumes with committed bytes and real hash; offline high-DPI native navigation retains Project/tab/scroll/picker state.

## 5. Immediate execution batches, definition of done, and stop conditions

### Package A: G26 remaining source implementation (P0 then P1)

- **A1 Trusted install + transfer integrity:** `G26-08..G26-11` and `F2-06` together, define OS-level receipt model, installation elevation and rollback, native Qt/Win32 handoff, update/repair/uninstall; stage-only capabilities remain labelled staged until independently verified.
- **A2 Content and storage authority:** `G26-01..G26-07`, `G26-17`: privacy-safe media/Packet/watermark, reviewed destructive retention policy, exact permission/version authority, upload leases. Unsafe physical deletion remains disabled until release acceptance: that is a *safe conditional block*, not unfinished code to switch on prematurely.
- **A3 Entitlement & integration:** `G26-12..G26-16` and `G26-18`: Inventory/Vault access, offboarding settlement, real source audits for Git/UE/Discord, credential custody/external revocation boundary.

**G26 source closure artifact:** matrix of backend route + DB contract + auth + actual UI + failure tests + explicit provider decisions, no claim of live Windows/provider certification.

### Package B: G27 remaining source implementation

- **B1 People/Settings:** `G27-01..G27-04`, real account/access / OOBE / revision-diff/rollback flows.
- **B2 Search/Create/Comms:** `G27-05..G27-10`, complete surface matrix for every first-party tool, recent/favorites, exact inbox deep-link and permission checks, quiet hours.
- **B3 Visual/Operations:** `G27-11..G27-15`, Home Widgets 2.0 states and layouts, taskbar/sidebar, resource use, native status, keyboard/phone/Qt, long identifier visibility and design guide recovery.

**G27 source closure artifact:** adopted surface checklist (not just helper primitives), feature regression, accessibility/effective-authorization negatives. No claiming real DPI/screen-reader acceptance from CSS text scanning.

### Package C: Native Operations and maintenance executor

- Preserve existing F2 P1–P6, F3 P1–P4 and F4 P1–P15 code. Reuse the supervisor authority and native emergency journal; do not create a second process manager, scheduler, incident DB or private API.
- A protected operator request is **intent**, not permission for Node to execute SCM operations. Native Go Service receives a bounded authenticated claim, validates fresh revision/mode/window/recovery evidence, begins exclusive drain, checkpoints jobs, persists intent, performs one allowed restart/update step, checks `/health/supervisor` versus `/health/ready`, clears or rolls back safely. No update auto-execution by mere window match. Inconsistent DB/file/native evidence is a hold requiring operator review.
- Validate no orphans, no restart storm, one PIN on protected Save/operation as required, hold-mode ordinary API background fences, crash-safe journal & canonical incident reconciliation, failover when DB unavailable, correct LocalService/SMB permissions, configured listener ownership/TLS/firewall outside-LAN checks, real Windows 10 prerequisites. Disabled Garnet must not block normal memory-backed operation.

**Executor closeout artifact:** explicit state machine, approved action receipt, timeout/cancel semantics, durable journal, interruption matrix and unit/fault tests; separate Windows 10 runtime proof before unattended support.

### Package D: G28 exact reconciliation

- For *every* CD row and every register item, record status fields and evidence paths; review actual app workflows and necessary negative tests. Fix source gaps, don't merely create a spreadsheet of them.
- Validate all historical small-wins: docked/floating sidebar/taskbar, icon clipping, modal/submenu/popup boundaries, Home Widgets 2.0, density, Comfortaa fallback, fullscreen Whiteboard/Board, project tabs, mobile/kiosk, viewer PDFs/video/audio/3D and metadata stripping, selection/bulk, creation overhaul, Help/error/empty-state, permission prompts, PIN workflow, real event vs optimistic queued result, server status globally.
- Confirm the G25 closed workflow scope remains intact and future scope isn't silently reintroduced. Resolve provider-specific and optional features through a release decision record.

**G28 gate:** no undocumented `unknown`; each P0 either implemented with source evidence, explicitly gated safe behavior, or blocked with a named owner. No consent to defer data integrity/security basics.

### Package E: TD7 cleanup/optimization and freeze

- Remove only proven fossil routes/fields/aliases/duplicated controls with replacement/regression proof; don't preserve old API schemas for zero installed instances.
- Audit OpenAPI endpoints, permission ownership, migrations and lifecycle scripts; dedupe visual tokens, no broad `!important` stacking; fix Win32 `unsafe.Pointer` inherited warnings, request storms and unexpected pollers. Measure before/after resource use and request/SQL counts, not alleged gains.
- Close dead test fixtures/generated build artifacts, create clean source + reproducible pinned dependencies + installer manifests. Recheck no debug secrets or private URLs in logs.

### Package F: Certification, packaging, sign-off

1. **Portable test and disposable DB:** install exact Node 24; Prisma generate + schema diff, complete TS/build; apply **all** historical migrations including G25/G26/G27 and F3 P2, F3 P3, F2 P4, then restore/rollback fault tests on disposable PostgreSQL 18. Never experiment with unbacked-up studio production data.
2. **Windows 10 native:** tested current Win10 build/security update baseline; compile pinned Go, Qt, native Win32; install/repair/uninstall Windows Service (LocalService or dedicated least-privileged), boot/tray/SCM, Job Object tree, read-only Windows readiness script, TLS/listeners/firewall from second PC; test device/network failures and MSI recovery.
3. **External services:** genuine Garnet with correct .NET/Lua/PubSub or documented safe fallback, real Discord guild authorization, two workstation Git/LFS and Unreal build/QA, NAS SMB and S3/local paths with interruption, resource measurements and failover.
4. **User-facing security & UX:** authenticated admin/member/contractor/revoked flows, stored/sensitive audit and exports, offline/reconnect, failure injection, high-DPI (100/125/150/200%), screen reader/keyboard/mobile, media preview and transfer under sustained load.
5. **Ship gate:** restore drill, reproducible and integrity-verified installer/native binaries, release note/rollback/runbook, soak and user review. Only after passing those do we mark `1.0.0 Stable`.

## 6. Explicit decisions, not hidden omissions

| Decision | Default until reviewed | 1.0 acceptance implication |
|---|---|---|
| Automatic physical storage/provider file deletion | **Disabled** | Do not ship unverified destructive unlink; reviewed non-destructive custody usable |
| Unattended machine/server updates | **Disabled** | Manual approved native executor first; production scheduling only after real fault recovery |
| Optional external Inventory/Vault provider APIs | **Deferred unless named essential** | Internal custodied entitlement and audit remain required; document limits |
| Universal Undo including irreversible operations | **Not promised** | Versioned safe saved inverses and explicit barriers, no dangerous rewind |
| External guest/client portal / chat | **1.1+** | Contractors inside Cluster retain scoped access, no outside public path required |
| Advanced CMS/public website inside Cluster | **Out of 1.0 scope** | Avoid exposing studio API to internet for website publishing |
| Cross-platform Linux/Docker | **Separate profile, not silent promise of Windows parity** | Document current tested profile; source packaging may exist without full Linux runtime validation |
| Old compatibility routes/data migrations | **Remove if truly obsolete** | Keep schema history needed for a fresh install, not unnecessary legacy behavior |
| GPU preview optimization | **Optional fallback path** | Feature must operate via bounded CPU path when no usable GPU |
| Official CL-DS-001 guide | **Recover, do not fabricate** | Source/UI standards can be audited only against original reference |

## 7. Operational rules for every subsequent implementation checkpoint

1. Start from the **exact latest verified full-source ZIP**. Never mix parent archives implicitly or call unintegrated mock tests a release build.
2. Make connected code/data/API/UI/native edits; update every touched ID in `CLUSTER_1_0_FINAL_WORK_REGISTER.json` and this roadmap, including new discovery IDs in the same register (not another roadmap).
3. Run focused positive/negative tests, inherited suites and structural scan. Runtime acceptance fields stay `not-run` until executed on real pinned dependencies/hardware.
4. Package cumulative source ZIP, exact-parent patch, integrity manifest and short handoff. Verify extraction, hash and patch reconstruction independently. Do not include test binaries by accident.
5. Always report **what is implemented**, **what is unverified**, **what is intentionally disabled** and **what was explicitly deferred**. Never make up a completion percentage or declare v1.0 based on source-only regressions.
6. Stop only on real dependencies or missing authorized access, not at arbitrary decimals; protect the verified checkpoint before large changes. No aggressive data deletion or service updates on the live Windows 10 machine without operator consent and backup.

## 8. Source-of-truth appendix and continuity

- **Current source parent:** `Cluster-v0.546.0-F4-P15-Verified-Update-Recovery-Preflight-Source.zip`.
- **Historical implementation authority:** `TECH_DEBT_MASTER_ROADMAP.md`; `TD6_CONSOLIDATED_G25_TO_G28_PLAN.md`; G25 WS17; G26 ledger and Batch H onward; G27 Batch 8 closeout; F2–F4 closeouts. Their historical *facts* stand; this roadmap supersedes their suggested next-order lists.
- **Separate release acceptance authority:** `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`; run execution evidence against each item here instead of creating another standalone release plan.
- **Previous gap analysis:** `Cluster-v0.546.0-F4-P15-Roadmap-Gap-Reconciliation.md`. This final roadmap folds in its uncovered obligations and adds the stable register and acceptance charter.
- **Open source-handoff constraint:** absent `source/docs/design/CLUSTER_STUDIO_STYLE_GUIDE.md` must be recovered from the actual guide. A missing referenced file is not evidence of failed appearance rendering.
- **Safety baseline:** zero active production instances reported, but do not assume the user's current Windows machine or backups can be modified without consent; source breaking changes are permitted, live destructive operations are not.

---

## 9. Stable actionable work register

This is the detailed no-omission list. Each row's status is a **baseline inference at F4 P15** from the checked documentation. The full JSON companion preserves item IDs and fields for future checkpoints. `Source-closed-unverified` does not mean certified, and `needs-audit` is not a claim of confirmed breakage.

### Governance

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `CORE-01` | P0 | open | Single source of truth: update this register with each checkpoint; no undocumented new roadmap or silent closeout. |
| `CORE-02` | P0 | open | Reconcile canonical source paths, recent implementation closeouts, live proof and explicit deferrals; retain unverified states. |
| `CORE-03` | P0 | open | Recover CL-DS-001 v1.3.0 from authoritative source; inspect before imposing design changes; record if unavailable. |
| `CORE-04` | P0 | open | Freeze 1.0 minimum workflows; approvals required for risky downgrades, disabling protections and deferrals of mandatory functions. |

### G26 Library

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-01` | P0 | source-partial | End-to-end Library explorer, versions, records, collection-sharing, folder permissions, copy/move/archive, server-side matching bulk selection, privacy and stale grants. |
| `G26-02` | P0 | source-partial | Implement dynamic legal-hold/retention propagation to future descendants where in-scope; verify ancestor checks cannot be bypassed by rename/move/trash. |
| `G26-03` | P0 | blocked-safe | Only enable physical/provider file destruction after generation-fenced delete, legal/hold checks, independent review, real provider failure-injection and recovery proof; until then disable it. |
| `G26-04` | P0 | source-partial | Verify S3/NAS/local upload provider reconciliation, lease and object identity under interrupted multipart finalization, revocation and concurrent cleanup; no physical deletion on ambiguous ownership. |

### G26 Review & Packets

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-05` | P0 | source-partial | Safe version-pinned PDF/image/audio/video review derivatives, exact recipient authorization, approved vs changes-requested decision, provenance and revoked-reviewer behavior. |
| `G26-06` | P1 | source-partial | Watermark settings, manual/default rules, immutable delivery provenance, privacy-safe image/PDF/media rendering, metadata stripping and recipient-specific revocation. |
| `G26-07` | P0 | source-partial | Packet publishing, acknowledgements, expiry, reminder/overdue evidence, signed manifest integrity, large roster pagination; live non-admin recipient, no underlying Library source access. |

### G26 Transfers

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-08` | P0 | source-partial | One durable Transfer Center for upload/download/import/export: streaming, resume, pause, cancel, retries, checksums, bounded RAM/disk and truthful progress. |
| `G26-09` | P0 | source-partial | Reconnect after interrupted Windows desktop/Qt, browser tab, mobile and two-window sessions; resumable checkpoints and revocation at every continuation boundary. |

### G26 Packages

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-10` | P0 | source-partial | Supervised Windows package install/update/repair/uninstall with trusted signature/destination, elevation policy, installer event receipts and OS-proven installed-state verification. |
| `G26-11` | P0 | source-partial | Crash/reboot recovery for MSI, dependency order, pre-launch vs launched-unknown statuses, dependent rollback and safe repair; never equate staged files with installed software. |
| `G26-12` | P1 | source-partial | Inventory seat entitlement + managed Package dependency and device binding; verify revoked/expired seats and new device/recipient selection. |

### G26 Inventory

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-13` | P1 | source-partial | Inventory keys, supplier/license contracts, team-scoped assignments, seat renewal/reassignment, custody, on/offboarding and audit with concurrency. |

### G26 Vault

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-14` | P0 | source-partial | Vault independent-approver rotation/replace/revoke with PIN, transactionally durable audit, scoped secrets, redaction and offboarding with no privilege reactivation. |
| `G26-15` | P1 | provider-decision | External provider key replacement/revocation verification and redemption sync: select required first-party integrations for 1.0; document other providers as 1.1. |

### G26 Integration

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-16` | P0 | needs-audit | Audit code-complete Git/LFS, Unreal Build/QA, Discord linking and event delivery, Qt/native IPC/contracts; close demonstrated missing source integration. |

### G26 Privacy

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-17` | P0 | source-partial | Privacy export/erase, retention, legal holds, scope-wide archive, audit-chain/export and media permissions; verify actual precedence and denied access. |

### G26 Closeout

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G26-18` | P0 | open | Run and record G26 per-workflow source/authorization/UI/failure-regression matrix; explicitly close or defer each scoped feature without confusing certification. |

### G27 People

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-01` | P0 | source-partial | Application approval, onboarding, people/roles/departments/teams, contractor scoping and staged access expiry/recovery/offboarding in one audited lifecycle. |
| `G27-02` | P0 | source-partial | Prove account/session/MFA/device/Discord/Project/Library/Vault/Inventory/Package revocation and rehire without stale entitlement resurrection. |

### G27 Settings

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-03` | P0 | source-partial | Guided/Quick/Import/Skip first run, setup checklist, config preview/diff and revision rollback, recovery, one PIN at protected Save, Studio/Server/User scope. |
| `G27-04` | P1 | source-partial | Tool config enable/disable ownership, inherited preferences, effective-access explanation, revisions, conflicting edits, nonsecret import/export and recovery errors. |

**G27 Pass 1 source update (2026-10-24):** Command Palette now requires a fresh, noncached and permission-filtered server Search response immediately before opening an online result. It checks unchanged canonical destination, session/permission/query continuity, and applies the same gate when detaching results into desktop windows. Missing/evicted/moved results fail closed; offline cached Projects and historical recents still require their own separate authorization/navigation reconciliation. Source and injected asynchronous tests are not live browser or Qt certification. `G27-05` remains OPEN / source-partial pending surface coverage. See `G27_PASS1_FRESH_SEARCH_ACTIVATION.md`.

**G27 Pass 2 source update (2026-10-24):** Delegated Studio Forms reviewers with active per-Form grants can resolve a non-application response deep link through `/api/studio-systems/submissions/:submissionId/target`. This path previously had an admin-only guard despite the authorized details path supporting delegated reviewers. Both rely on a single per-Form access decision; the global gateway now delegates only exact review paths instead of demanding Settings-tool permission, while leaving kiosk/other administrative routes fenced. Missing/application/revoked targets return generic 404 without private fields. Focused tests and the historical Studio Forms search suite pass. All-resource Search/History coverage and actual browser/Qt evidence remain open. `G27-05`/`G27-06` stay partial. See `G27_PASS2_DELEGATED_FORMS_DEEPLINK_CLOSEOUT.md`.

### G27 Search

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-05` | P0 | open | Global Search/Actions/Create supports every supported canonical first-party resource; fresh permission checks; exact linked destination; no duplicated action authority. |
| `G27-06` | P1 | open | Navigation history, Ctrl/middle click where applicable, favorites/recents, Copy Link/ID and real filesystem Path, context restoration, project tabs and filters. |

### G27 UX

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-07` | P0 | open | Global Create and cross-workspace action surfaces are compact and reliable: double-click dedupe, create-and-open, draft/queued/saving/saved/conflict truthfulness. |
| `G27-08` | P0 | open | Help/error/empty/loading/permission-denied and partial/offline states across actual workspaces; accessible keyboard actions and focus/scroll preservation. |
| `G27-13` | P1 | needs-audit | Useful workspace canvas/ultrawide tables, viewport-aware viewers, long paths and identifiers accessible by copy/tooltip/inspector, reduced-motion/a11y. |

### G27 Communications

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-09` | P1 | source-partial | Per-tool/recipient notification preferences, user quiet hours with critical override, dedupe, immutable authority, template/schedule and revoked-access-safe deep links. |
| `G27-10` | P1 | source-partial | Separate announcement, Inbox action, routine notification, alert and approval ownership; exact delivery receipts and unread semantics across devices. |

### G27 Home

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-11` | P1 | needs-audit | Home command brief and Widgets 2.0: resizable, interactive in every size, role/scoped data, compact mobile carousel, persistent layout and no duplicate polling. |

### G27 UI

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-12` | P0 | needs-audit | Sidebar/taskbar, icon clipping, window/popup/menu/inspector placement, responsive layouts, font weights, density and narrow/high-DPI Qt parity. |

### G27 Admin

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-14` | P0 | source-partial | Operations home, resource usage by process/tool, cache/request metrics, service/host health, incident assignment/on-call routing, access/security diagnostics and actionable controls. |

### G27 Closeout

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G27-15` | P0 | open | G27 integration closeout across Search/Create/Help/Notifications/UI on all first-party tools with source and browser/Qt evidence separated. |

### G25 Regression

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G25-01` | P0 | source-closed-unverified | Default Board truly blank; explicit Ticket queue/Board/List; no silent source mutation; resolved vs rejected; ticketStage independent of list; empty rules stay empty. |
| `G25-02` | P0 | source-closed-unverified | Project-to-Ticket-to-Build/QA gating, branches, status/review version, QA changes-requested, permissions and Project closeout. |
| `G25-03` | P0 | source-closed-unverified | Forms assigned recipients, drafts, reminders, delegated reviewers, published versions, conditional hidden-answer privacy, large rosters. |
| `G25-04` | P0 | source-closed-unverified | Calendar recurrence detach/edit/move, RSVP, room availability, meeting vs clock activity, timezone/DST and Scheduler overlap/locks. |
| `G25-05` | P0 | source-closed-unverified | Board/Whiteboard collaboration, comments, saved operations Undo/Redo only if reversible; two editors, offline queue, conflicts, mentions and deep-link privacy. |
| `G25-06` | P1 | source-closed-unverified | Project immutable identity plus internal/external/codename/alias lifecycle; prove external-safe projection; capacity unknown must not equal zero utilization. |

### Native Platform

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `F2-01` | P0 | source-partial | Windows 10 Service and separate GUI: boot/autostart/tray, graceful stop/restart, SCM readiness, process-tree Job Objects and orphan-free cleanup tested live. |
| `F2-02` | P0 | source-partial | Service account LocalService permissions incl NTFS, paths, linked NAS/SMB access, dedicated account fallback, no LocalSystem default. |
| `F2-03` | P0 | source-partial | Native CPU/RAM/drive/storage/GPU/PCI visibility; per-process attribution and active request / SQL / worker metrics with minimal poll overhead. |

### Native Networking

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `F2-04` | P0 | source-partial | Managed listener/port/domain/TLS/reverse proxy/firewall exposure UI and safe staged rollback verified from another machine, not only local readiness. |
| `F2-05` | P0 | source-partial | Network config exact revision/CAS + one PIN at Save, backed up last-known-good, no public private API/database exposure, blocked unsafe proxy trust. |

### Native Deployment

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `F2-06` | P0 | source-partial | Win10 installation/provisioning/bootstrap: private Node24, PostgreSQL18, host binaries, first-run OOBE, permissions, rollback/reinstall/repair/uninstall, no download loops. |
| `F2-07` | P0 | source-partial | Signed reproducible delivery, manifest/code provenance, secure updates, Windows 10 support decision including security servicing baseline. |

### Operations Reliability

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `F3-01` | P0 | source-partial | API readiness, canonical dependency incidents, routing/ack/escalation, native file-backed fallback, reconciled receipts and fail-safe alerting. |
| `F3-02` | P1 | open | Real on-call rotations/delegation, authority-scoped recipients, quiet hours and critical overrides without opening admin telemetry to arbitrary staff. |
| `F3-03` | P1 | open | Safe configured per-tool read-only functional probes with SSRF protections, bounded rate, dedupe and health-to-incident ownership. |
| `F3-04` | P0 | source-partial | Native alert backlog retention/overflow/reconciliation tests, crash/restart/clock skew, emergency channel external delivery and secret-safe logs. |

### Maintenance

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `F4-01` | P0 | not-implemented | SCM-owned maintenance executor: exclusive operation claim, fresh PIN/role, revision + window + backup preflight, drain and durable restart intent, bounded rollback. |
| `F4-02` | P0 | not-implemented | Native restart/update receipt and post-start verification; no self-restarting JS process, no automatic destructive update on unknown state. |
| `F4-03` | P1 | source-partial | Real maintenance windows DST, multiuser drain, read-only diagnostics, held-mode scheduler fences and recovery; preserve no accidental background writes. |
| `F4-04` | P0 | source-partial | Recovery readiness from verified backup and restore-drill evidence; fail closed for stale/unmatched generation, actual drill needed live. |
| `F4-08` | P1 | open | Approved diagnostic and optional scheduled maintenance actions: operator audit, no destructive changes from GET or default timers; cron and catch-up bounds. |

### Acceleration

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `F4-05` | P0 | source-partial | Garnet .NET prereqs, Lua/PubSub/lease/rate-limit/prefix, required vs auto memory fallback, real cross-client/protocol checks on Windows 10. |
| `F4-06` | P1 | needs-audit | Cache request rates/SQL/workers/media viewer and heavy admission; measure, fix request storms, memory leaks and unnecessary background wakeups without fake benchmarks. |

### Performance

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `F4-07` | P1 | needs-audit | GPU use for supported server-side previews/conversion only; safe CPU fallback, queue/worker gating, NAS GPU/PCI impacts, no claims of UI rendering acceleration. |

### Cross-tool historical

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `HIST-01` | P1 | needs-audit | Security Center, 2FA/MFA, optional biometric desktop login, admin reset/recovery, separate user versus security PIN and session/device revocation; record source completeness and explicit 1.0 minimum. |
| `HIST-02` | P1 | needs-audit | Kiosk signed-in/signed-out modes, clock-in/out and break visibility, admin-only time-entry correction and approvals; test authenticated/shared device privacy. |
| `HIST-03` | P1 | needs-audit | Home command brief, My Work cross-tool queues, resizable Widget 2.0, changed-since-yesterday and attention counts with scoped caching and mobile carousel. |
| `HIST-04` | P1 | needs-audit | People presence availability versus clock state, invisible status, custom presence and last-seen privacy, team/department capacity with truthful unknown allocation. |
| `HIST-05` | P1 | needs-audit | Timeline unified Map/Board/List, filters, dependency indicators, fullscreen item, quarterly filter and no accidental time clock inside timeline. |
| `HIST-06` | P1 | needs-audit | Native Desktop mounted Library drive-letter policy, one-letter-per-server default and optional per-Library letters; safe Qt mount lifecycle and reconnect. |
| `HIST-07` | P1 | needs-audit | Unified image/audio/video/PDF/text/3D Library viewer, time/page/region anchors, metadata stripping, 3D conversion failure fallback and actual fullscreen media controls. |
| `HIST-08` | P1 | needs-audit | Packets as wiki/knowledge base and signed Studio policies/agreements, required acknowledgment and access gating after unsigned policy with legal/retention evidence. |
| `HIST-09` | P0 | needs-audit | Client/server schema/API protocol version gating, safe read-only state, offline queue compatibility fence, recovery holds and replay denial for incompatible queued writes. |
| `HIST-10` | P1 | needs-audit | Qt desktop multiple windows, native clipboard, notifications and download/drag-drop behavior; 1:1 essential user workflows without fake web-only controls. |
| `HIST-11` | P1 | scope-decision | Internal templates and saved/smart views already in prior plans; implement indispensable existing per-tool saved views, explicitly leave broad v1.1 template engine and smart automation for later. |
| `HIST-12` | P1 | needs-audit | Project source types UE/Blender/Fortnite/CurseForge/Unity where supported, Studio roles/department tooling and immutable external-safe alias naming; never claim untested provider support. |
| `HIST-13` | P1 | needs-audit | Native Server Manager logs filter/copy/autoscroll, uptime/status, failed-start recovery, start-on-boot, portable server folder and no leftover node.exe on shutdown. |

### G28 Reconciliation

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `G28-01` | P0 | open | Reconcile CD-01 through CD-20 individually against real model, route, auth, UI, implementation tests, live acceptance and explicit scope decisions. |
| `G28-02` | P0 | open | Reconcile small-wins/micro-UX checklist, native/Qt, accessibility, dark/compact density and authoring errors; preserve source-level closeouts. |
| `G28-03` | P0 | open | Mark each item Source-Implemented, UI-Integrated, Tested-Source, Validated-Live, User-Accepted, Deferred-Explicit; never collapse into one Done flag. |
| `G28-04` | P0 | open | No item may exit the release gate as unknown: verified, blocked with owner, or explicitly agreed out-of-scope; publish migration manifest. |

### TD7 Cleanup

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `TD7-01` | P0 | not-started | Remove demonstrated dead aliases/deprecated fields/routes/migration-only compatibility and duplicate path authority, gated by canonical regression proof. |
| `TD7-02` | P1 | not-started | Deduplicate first-party permissions, events, API/OpenAPI declarations, CSS tokens/menu primitives; avoid new framework or plugin architecture. |
| `TD7-03` | P0 | not-started | Close error/warning backlogs, fix inherited Win32 unsafe.Pointer vet warnings, scan secrets and unsafe fallbacks, preserve security logs without secret leakage. |
| `TD7-04` | P1 | not-started | Baseline and optimize API request volume, cache misses, SQL fan-out, timers and heavy workloads; compare quantified before/after results. |
| `TD7-05` | P0 | not-started | Source freeze: versions, ports, config/schema/API contract manifests, pinned deps, reproducible build, signing material handling, documented remaining gates. |

### Certification

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `CERT-01` | P0 | not-run | Pinned Node24 full install, Prisma generate, type-check/server/renderer build, source scanner and release-build checks with dependency lock. |
| `CERT-02` | P0 | not-run | Apply all unapplied migrations in order to disposable PostgreSQL 18, seed/bootstrap, transaction contention, backup restore, rollback and clean install. |
| `CERT-03` | P0 | not-run | Windows 10 22H2 security-update/ESU and hardware support matrix; native Go production pin, Win32, Qt launch, SCM service boot/shutdown/restart/tray. |
| `CERT-04` | P0 | not-run | Garnet real Windows 10 .NET/Lua/PubSub or memory-fallback evidence; never rely on simulated compatible backend for certification. |
| `CERT-05` | P0 | not-run | Two real Windows machines Git LFS lock/sync, Unreal project builds and QA pipeline, real Discord link/bot channel delivery/revocation. |
| `CERT-06` | P0 | not-run | Storage fault injection across local NTFS, NAS SMB, object provider, power loss, revoked rights, package/update rollback; test irreversible guards. |
| `CERT-07` | P0 | not-run | Full restore drill incl keys, policy, schema, Library data, Packet distribution and native journal; disaster recovery and no lost claims. |
| `CERT-08` | P0 | not-run | Authenticated multiuser and concurrent two-admin writes, permission revoke, nonce/revision conflict, offline queue, notification privacy and cross-process races. |
| `CERT-09` | P0 | not-run | Web/Qt/mobile/DPI 100/125/150/200%, keyboard/screen-reader/reduced-motion, visual clipping, overlays, native file pickers and real media flows. |
| `CERT-10` | P0 | not-run | Security review of auth/PIN, cookies/CSRF/origin, secrets, server external exposure, onboarding, service privileges, logging, audit integrity and export. |
| `CERT-11` | P0 | not-run | Performance baselines and soak: CPU, RAM, I/O, bandwidth, SQL, API request counts, reconnects, throttles, media and large transfers under realistic 10+ users. |
| `CERT-12` | P0 | not-run | Install/repair/uninstall and unattended update dry-run in fresh Windows 10 VM/server with rollback, signed artifacts, checksum manifests and operator runbook. |
| `CERT-13` | P0 | not-run | Release go/no-go: P0/P1 needed gates passed, reversible known issues documented, exact artifacts and hashes, rollback and user-approved 1.0 stamp. |

### Post-launch preserved scope

| ID | Pri | Status at F4 P15 | Close only when… |
|---|---|---|---|
| `POST-01` | P2 | planned-1.1 | Separate lightweight /portal for external guests/clients with NDA, names and independent API boundaries; not required for internal contractor access. |
| `POST-02` | P2 | planned-1.1 | Advanced Cluster-wide templates, saved smart views, relationship/dependency dashboards and expanded collaboration not required for current 1.0 workflows. |
| `POST-03` | P2 | planned-1.1 | Extended Calendar 2.0 personal/project overlays, delegated editing and full-year UX beyond the existing scoped canonical recurrence/scheduler contracts. |
| `POST-04` | P2 | planned-1.1 | More complete Packets wiki/knowledge base and lightweight automation beyond existing required Studio policy and review flows. |
| `POST-05` | P2 | planned-1.1 | Public integration/plugin marketplace, universal workflow builder and arbitrary third-party providers; do not make dynamic plugin architecture for internal v1. |
| `POST-06` | P2 | planned-1.1 | Studio chat/DMs, cross-tenant hosting and public website CMS stay separate unless explicitly re-scoped. |


**Roadmap baseline note:** A required task can be newly source-closed during implementation but stay open for live certification. When evidence changes, replace its status and add links/hash/run-date rather than deleting its ID.

### G26 Pass 23 implementation checkpoint

MSI grant ordering/read-only receipt safety implemented in Desktop Packages: fresh installed-attempt/lock preflight precedes authorization, unknown recovery states fail closed, duplicate user intent coalesces, and stale package-view async continuations cannot start an installer. Go helper test/race/vet and Windows x64 cross-compilation passed. This does not attest Windows installation/health or authorize automatic retry/repair/uninstall; G26-10/11 stay open. See `G26_PASS23_MSI_PREFLIGHT_CLOSEOUT.md`.

### G26 Pass 24 implementation checkpoint

Signed MSI ProductCode registration and cross-Package local receipt/lock custody are now inspected before grant consumption. Native Qt + renderer MSI read-only report contracts fail closed on inconsistent evidence. No automated retry, repair, uninstall, rollback, reboot authorization or OS-health attestation was introduced. G26-10/11 stay open. See `G26_PASS24_MSI_PRODUCT_CUSTODY_CLOSEOUT.md`.

### G26 Pass 25 implementation increment (source only)

Profile-wide atomic MSI admission now serializes different Package keys over the entire native install attempt, preventing simultaneous foreign-ProductCode scans from both authorizing before receipt publication. Read-only admission-lock evidence propagates through Qt and Desktop, with crash/orphan visibility and fail-closed tampering behavior. 33/33 new checks plus 627/627 inherited targeted checks and Go test/race/vet/Windows cross-build passed. There is still no Windows-installed-state/repair/uninstall/reboot certification; G26-10 and G26-11 remain open. See `G26_PASS25_MSI_GLOBAL_ADMISSION_CLOSEOUT.md`.

### G26 Pass 26 implementation increment (read-only source)

Native Package recovery now offers a bounded, fail-closed, profile-wide inventory of all MSI receipt and lock identities. Qt validates the inventory independently; Desktop validates full individual receipt data and displays the results even for Packages outside the current rollout. 49/49 new plus 660/660 inherited targeted assertions, Go test/race/vet/Windows crossbuild passed. No live Windows install health or mutation lifecycle authority claimed. See `G26_PASS26_MSI_PROFILE_INVENTORY_CLOSEOUT.md`; G26-10/11 remain open.

### G26 Pass 27 implementation increment (source-only)

Native MSI admission now requires completed enumeration of the signed ProductCode across current-user and per-machine Windows Installer contexts, not only MsiQueryProductStateW. It probes again just before launch after the prepared receipt/grant consumption, and rejects unknown foreign-custody entries. Qt/Desktop validate scoped observation evidence; other-users contexts and live OS health remain unverified. No automatic retry, repair, uninstall, rollback or OS-health claim. See `G26_PASS27_MSI_MULTICONTEXT_INSTALLER_FENCE.md`. G26-10 and G26-11 stay open.

### G26 Pass 28 implementation increment (read-only MSI recovery)

MSI profile inventory now verifies a stable two-observation bounded filesystem snapshot across all receipt/lock files and the profile admission lock, refusing changed identities and mid-scan mutations. Portable deterministic fault tests cover new locks, receipt replacement, admission lock changes and directory creation. This is observational only, not a concurrent filesystem transaction or Windows MSI health proof. G26-10/11 remain open. See `G26_PASS28_MSI_SNAPSHOT_COHERENCE_CLOSEOUT.md`.

### G26 Pass 29 implementation increment (non-authorizing boot observation)

Read-only MSI recovery now correlates a bounded Windows uptime reading with the durable attempt's UTC timestamps, explicitly distinguishing reboot indicated, same boot indicated, ambiguous and unavailable observations. Qt and Desktop reject malformed and falsely confirmed/attested reports and surface the advisory state. No reboot or installation-health certification, automatic retry, repair, uninstall or rollback is introduced. See `G26_PASS29_MSI_BOOT_CONTINUITY_OBSERVATION.md`. G26-10/11 stay open until Windows VM acceptance and independent lifecycle authority are implemented.

### G26 Pass 30 implementation increment (boot anchor and OS observation stability)

New MSI attempt receipts may durably record an optional Windows uptime/UTC boot anchor before the one-use installation grant is consumed; older receipts remain readable. Read-only inspection compares anchored uptime observations without claiming a verified reboot and rejects unstable Windows Installer product-registration snapshots, including profile-wide inspection changes. Qt/Desktop independently validate the new receipt/observation fields. No automatic retry/repair/uninstall, dependency-aware rollback, or installation-health attestation is implemented. G26-10/11 and Windows acceptance gates remain open. See `G26_PASS30_MSI_BOOT_ANCHOR_REGISTRATION_CONTINUITY.md`.

### G26 Pass 31 implementation increment (MSI registration transition and drift)

New MSI receipts durably retain a scoped fresh-install registration observation immediately before committing process launch, and a double-sampled observation after `msiexec` returns. Read-only inspection reports retained registration transition and drift versus a later OS probe; conflicting or tampered evidence fails closed in Go, Qt and Desktop, and older receipts remain readable. This is registration evidence, not software health, installer causation or authority for retry/repair/upgrade/uninstall. Full MSI lifecycle and real Windows acceptance remain open under G26-10, G26-11, CERT-03 and CERT-12. See `G26_PASS31_MSI_REGISTRATION_TRANSITION_CLOSEOUT.md`.

### G26 Pass 32 implementation increment (Qt MSI profile evidence parity)

The native Qt profile MSI inspector now enforces the same signed receipt identity/digests and OS ProductCode/Version evidence contract as the individual inspector. This corrects the profile-specific weak validation path, retains separate executed Desktop checks, and adds source-boundary regression coverage. No new MSI mutation authority; G26-10/11 and Windows release certification remain open. See `G26_PASS32_QT_MSI_PROFILE_EVIDENCE_PARITY.md`.

### G26 Pass 34 implementation increment (signed MSI executable source custody and resume fence)

Before resuming the existing Job-owned suspended `msiexec`, Windows now holds a read-only handle to the signed MSI denying concurrent write/delete shares, hashes that handle and checks pathname identity, and rechecks the ProductCode twice against the committed fresh-install baseline. The handle is retained through installer exit and verified again after return. Changed sources or newly registered ProductCodes fail closed with manual-review receipts, never an authorized repair or retry. Portable Go/Windows cross-build/source assertions passed; Windows 10 MSI sharing and execution are **not** live-tested. G26-10/11 and CERT-12 remain open. See `G26_PASS34_MSI_IMMUTABLE_SOURCE_AND_RESUME_GATE.md`.

### G26 Pass 35 implementation increment (typed signed dependency and native MSI prerequisite admission)

Signed Package dependencies now require an explicit `content-selected` or `msi-installed` requirement; the server publisher, resolver, offline signer and native stager enforce compatible Package types without migration aliases. Native fresh-MSI admission requires exact persisted terminal prerequisite receipts and current matching Windows Installer ProductCode/version evidence, before grant consumption and again before suspended child execution. Receipt snapshots and a bounded read-only known-dependency graph are independently checked by native Qt and Desktop. No uninstall/repair/rollback authority or software-health attestation is introduced. 1,059/1,059 named portable/source assertions plus 11/11 signed dependency integration checks and Go test/race/vet/Windows cross-build passed. G26-10/11 and CERT-12 remain open. See `G26_PASS35_SIGNED_MSI_DEPENDENCY_LIFECYCLE.md`.

### G26 Pass 36 implementation increment (non-authorizing lifecycle review)

Each coherent read-only MSI profile inspection now includes a bounded three-operation review (upgrade, repair, uninstall) for each recorded Package, with exact receipt identity, known dependent Packages and deterministic hard blockers for locks, unknown execution, registration drift and prerequisite mismatch. Native Go, Qt and Desktop independently enforce a no-mutation contract. The larger bounded response limit is 768 KiB. This is necessary groundwork but **does not implement executable signed upgrade/repair/uninstall authorization or OS lifecycle rollback**. Continue G26-10/11 source work; Windows certification is a later gate. See `G26_PASS36_MSI_LIFECYCLE_REVIEW_CLOSEOUT.md`.

### G26 Pass 43 | Read-only rollback custody/order and separate signed scope (2026-10-24)

G26-10/11 source work adds a bounded `msi-rollback-review` that confirms the exact original installation receipt, completed upgrade journal, retained predecessor and successor MSI digests, stable current Windows Installer successor registration, and an internally re-derived transitive dependent-Package graph. The order is deterministic, **dependents first**, and changes/cycles/unknown receipts block the review. Qt/Desktop independently validate and display it. A distinct `msi-rollback` Ed25519 grant schema binds **four SHA-256 custody identities** and cannot cross-authorize managed-content rollback, install, repair, uninstall or upgrade. **The server intentionally does not issue this scope and the native helper has no downgrade executor yet.** It is a read-only recovery decision, not mutation authority, application-health certification or a completed rollback. Go race/vet, Windows x64 cross-build and 1,494/1,494 source/portable checks passed. G26-10/G26-11 and CERT-12 stay open. See `G26_PASS43_MSI_ROLLBACK_REVIEW_AND_GRANT_CONTRACT.md`.

### G26 Pass 42 | Signed supervised MSI upgrade implementation (2026-10-24)

G26-10/11 source work now includes independently gated, administrator-authorized **upgrade** execution. The short-lived signed grant binds the current predecessor receipt SHA-256 and retained original MSI SHA-256; native Go confirms a strictly newer, same-ProductCode, same-major per-user MSI target and independently rechecks dependencies and Windows registration. A durable **non-replayable** upgrade journal is written before grant consumption, transitions to launched-unknown before the Job-supervised Windows Installer process can resume, and preserves the old installation receipt and frozen prior MSI bytes. Qt/Desktop require a fresh read-only review, explicit typed confirmation, and independently validated recovery observations. Zero process exit or Windows product registration is never treated as application-health attestation. No automatic rollback, retry, or downgrade. **G26-10, G26-11 and CERT-12 remain OPEN** until independently authorized rollback/dependency ordering, broader source completion and Windows runtime certification. See `G26_PASS42_SIGNED_SUPERVISED_MSI_UPGRADE_CLOSEOUT.md`.

### G26 Pass 39 | MSI lifecycle custody integration (2026-10-24)

- Durable repair/uninstall journals now participate in MSI profile inventory as `lifecycleRecords` even when the matching initial installation receipt is missing. Their directory entries are bounded, type-checked, parsed with strict receipt validation, and included in two snapshots to reject mid-scan mutation.
- A profile with *only* a lifecycle journal is classified as requiring manual review, not as a clean empty profile.
- Review projections add `prior_lifecycle_operation_recorded` to each affected package and remain `readOnly: true`, `mutationAuthorized: false`, `osAttested: false`.
- Server-profile Qt and renderer validators independently check the additional records and derive the exact same blocking projection. Desktop shows durable repair/uninstall custody in its MSI inventory.
- MSI-installed prerequisite admission now refuses an already-used repair/uninstall journal before reading the older successful installation receipt. `content-selected` dependencies remain content-only and do not require Windows Installer registration.
- Fresh installation cross-package ProductCode checks also inspect **orphan lifecycle journals**, fail closed on corrupt/malformed records, and repeat the check immediately before launch and suspended-thread resume.
- No automatic journal deletion, lock break, retry, repair, rollback, upgrade, or OS application-health attestation is introduced.

G26-10/11 and CERT-12 remain source-partial/open. No live Windows MSI or post-reboot application-health certification claimed.

### G26 Pass 46 | Independently settled MSI dependents (2026-10-24)

The G26 MSI source path now recognizes a *separately* completed uninstall of each downstream Package, using its non-replayable durable lifecycle journal linked to the exact successful installation receipt and a complete current-user-and-machine scoped Windows Installer ProductCode-absence probe. The known historical receipt graph remains intact: root rollback becomes reviewable only when **every** recorded transitive dependent has that evidence. Individual dependent uninstalls advance in deterministic dependents-first order, but every operation receives its **own** signed grant and supervised journal. Native Go, Qt, and Desktop independently verify the new dispositions; a fresh workflow is required before each child uninstall and the root rollback. Repair retains conservative blocking. No silent removal of journals, automatic cascade/retry, all-users registration proof or application-health attestation. 73 new assertions, 1,710 total source/portable checks, Go test/race/vet and Windows cross-compilation passed. **G26-10, G26-11 and CERT-12 remain open**; linked Qt/actual Windows MSI and PostgreSQL runtime acceptance have not been run. See `G26_PASS46_DEPENDENT_DISPOSITION_CUSTODY.md`.

### G26 Pass 47 | MSI interrupted-dependent incident continuity (2026-10-24)

A bounded, receipt-derived `msi-rollback-cascade` now retains the exact uninstall lifecycle **journal SHA-256 and state** for each recorded downstream Package, with a strictly derived read-only `recoveryAction`, `manualRecoveryRequired` list and one `nextReviewablePackageKey`. A child whose uninstall process returned zero but remains registered, whose journal shows interrupted/unknown outcome, or whose evidence conflicts stays under explicit `manual_recovery_no_replay` review; it never becomes a completed disposition or restartable operation. Native Go, Qt and executable Desktop validators independently check this projection. 76 new assertions, 1,786 combined source/portable checks and Go test/race/vet plus Windows x64 application/test crossbuild passed. No automatic cascade, journal clearing, reauthorization, application-health attestation or live Windows/Qt/PostgreSQL certification. **G26-10, G26-11 and CERT-12 remain open.** See `G26_PASS47_DEPENDENT_MSI_RECOVERY_INCIDENT_CONTINUITY.md`.

### G26 Pass 48 | MSI receipt body coherence across recovery snapshots (2026-10-24)

G26 native MSI profile inspection now rehashes *every* bounded attempt and lifecycle receipt twice, before and after reading the read-only profile, requiring both metadata snapshots and the SHA-256 content snapshots to match. This rejects an in-place edit preserving inode, filename, length and restored modification timestamp that a metadata-only comparison might have missed, including a changed journal used by Pass 47 recovery triage. The digest namespaces are disjoint (`attempt:` vs `lifecycle:`). Native fault tests inject both such rewrites; 28 new executable/source assertions, 1,814 total; Go test/race/vet and Windows x64 app/test crosscompile passed. No authorization semantics changed. **No real Windows Installer/linked Qt/runtime or application-health certification. G26-10, G26-11 and CERT-12 remain open.** See `G26_PASS48_MSI_PROFILE_RECEIPT_BYTE_COHERENCE.md`.

### G27 Pass 3 | Delegated Forms, authorized Recent navigation, and Create & Open (development source)

- **Implemented:** non-admin delegated reviewers enter My Forms (never administrator Studio Settings) from exact `studio-form` / `form-submission` targets; inherited URL inspectors preserve context and resolve exact currently authorized response IDs without exposing missing or revoked details.
- **Implemented:** Recent Project/Board/Whiteboard routes require fresh server admission and exact current resource placement online; stale history labels are sanitized; narrow permission-filtered offline Project/Board fallbacks never fabricate authorization for standalone Whiteboards.
- **Implemented:** post-create Calendar, Scheduler, Timeline and Packet navigation retains the newly created record identity; historical Project Meetings remain their own Plan workflow.
- **Verified in development:** focused Pass 3, inherited Pass 1/2, Studio Forms, announcement/navigation, and source scanning. **Not claimed:** full typecheck, real multi-user browser/Windows/Qt/PostgreSQL acceptance, complete G27-05/06 or G27 shared workflow closeout.
- **Next implementation:** additional cross-resource destination admission and G27 feature-ledger convergence, not release certification. See `G27_PASS3_NAVIGATION_FORMS_CREATE_CLOSEOUT.md`.

### G27 Pass 4 | Card notification exact Board placement (development source)

- **Implemented:** notification-driven Card inspector links now carry the explicitly reported owning `boardId` to renderer and native Desktop destinations. Without a validated Board ID, a historical Card link opens its Project/Inbox instead of restoring whichever unrelated Board happened to be selected.
- **Preserved:** application/announcement recipient Inbox isolation, onboarding/People-related navigation, other resource routing and server-side access checks.
- **Verified in development:** 15 new executed assertions plus inherited G27 Pass 3 regression and source scan. No native executable or database changes.
- **Still required:** current Board lookup for old/relocated Cards, further G27-05/06 route/authorization matrix, authenticated browser/native execution and unrelated release certification. See `G27_PASS4_NOTIFICATION_CARD_PLACEMENT_CLOSEOUT.md`.

### G27 Pass 5 | Fresh per-Card Board resolution (development source)

- **Implemented:** every Card-inspector navigation entering the authenticated application now resolves the Card's current Board/Project from its server-authorized detail endpoint with an uncached fresh request. Moved Cards follow the newly permitted destination, missing/revoked/failed lookups preserve the current UI, and a newer navigation or session change invalidates any in-flight Card lookup.
- **Implemented:** historical Card notifications without Board placement retain their Card ID for resolution rather than falling back to the wrong previously selected Board; native push without a Board still opens Inbox until the member activates the link.
- **Verified in development:** 21 new fault-injected authorization/identity/race and source-wiring assertions plus inherited G27 Pass 1–4 and source scan. No database migration or native binary changes.
- **Still open:** remaining first-party resource deep-link audits, multiwindow/desktop native realization, full authenticated browser and PostgreSQL tests, and G27/G28 completion. See `G27_PASS5_AUTHORIZED_CARD_ACTIVATION_CLOSEOUT.md`.

### G27 Pass 6 | Current destination admission, moved Search results and native Card identity (development source)

- Generic Project/Board/Whiteboard work links now perform a fresh permission-protected exact-resource read and authorize current placement *before* changing URL, Project/Board selection or inspector state. Stale network/session requests fail closed.
- Card-only native URI opens are now valid only through the current Card permission+Board resolver. Boardless/Projectless link identity no longer requires fabricated historical placement.
- Search follows moved resources only when a fresh authoritative result still has the same canonical identity; permission removal, duplicate/missing results and changed identity stay blocked.
- New Pass 6 tests and updated deep-link/Search regressions. **G27-05/G27-06 remain open** for the remaining cross-resource adapters, history/session surface matrix and complete feature integrations. Release certification is separate and not the development stopping criterion. See `G27_PASS6_AUTHORIZED_WORKSPACE_SEARCH_DEEPLINK_CLOSEOUT.md`.

### G27 Pass 7 | Copied Card browser/native links (development source)

- `Copy Link` no longer requires historical Board ID for Cards. Desktop Card URIs and browser Card permalinks both enter the central authorized Card-to-current-Board resolver.
- A copied browser URL can hydrate a Card inspector on first authenticated load, including when a Card moved to another Board; malformed or denied links recover safely instead of leaving a blank Board workspace.
- One hydration per user/Card identity, project/Board placement from server only, existing access checks unchanged.
- G27-05/06 remain **open** for other detailed resource adapters, full history navigation reconciliation, and real browser/desktop integration. See `G27_PASS7_CARD_PERMALINK_RESTORATION_CLOSEOUT.md`.

### G27 Pass 8 | Canonical Meeting navigation (development source)

- Exact Meeting ID links now obtain an authorized current CalendarEvent target through the Calendar visibility policy, including participant-only, private and standalone Meetings without an owning Project.
- Project and browser/desktop links retain identity until authorized; missing/revoked records do not reveal private event placement, and canceled navigation cannot replace a newer workspace.
- New executable server callback and browser URL restoration regressions. G27 cross-resource closeout remains active. See `G27_PASS8_CANONICAL_MEETING_NAVIGATION_CLOSEOUT.md`.

### G27 Pass 9 | Unsaved-change guard ordering and detached Meeting identity

- `setScreen` no longer clears inspector URL, section or sidebar before allowing a dirty-workspace navigation; cancel or failed confirmation keeps the current screen untouched.
- Calendar retains untrusted Meeting targets only long enough to pass through the canonical authorized resolver, including desktop split-window reconstruction and work-source identities.
- Source test runs extracted controller with confirmed, cancelled and failing guards. **Remaining:** atomic guard across direct linked-work URL/selection changes and Project context pre-mutation. See `G27_PASS9_UNSAVED_GUARD_DETACHED_MEETING_CLOSEOUT.md`.

### G27 Pass 10 | Atomic linked-work navigation

- All central linked-resource activations now defer URL, inspector, Project/Board/Whiteboard state and screen changes until any dirty-workspace transition is approved. Canceled and late confirmations have no side effects.
- Fresh authorized Card/Meeting/Workspace resolvers carry the same navigation sequence through final commit, and an internal one-intent flag prevents double discard prompts.
- 19 executable central-handler checks plus inherited suites. Direct Project selection and Home resume still require guarding, so this is not yet all-entrypoint closeout. See `G27_PASS10_ATOMIC_LINKED_WORK_NAVIGATION_CLOSEOUT.md`.

### G27 Pass 11 | Direct Project and Continue Working safety

- Direct Project selection and Home resume no longer pre-mutate Project, Board, Whiteboard or inspector context before unsaved-work approval.
- One navigation-intent epoch invalidates asynchronous permission lookups, pending discard dialogs and project/resume requests after any newer navigation or session loss.
- 22 new executable direct-controller checks and all inherited suites. Remaining screen-local selection/history flows are still in the G27-05/06 ledger. See `G27_PASS11_DIRECT_PROJECT_RESUME_GUARD_CLOSEOUT.md`.

### G27 Pass 12 | Shell Board/Whiteboard entrypoint convergence

- Eight Board and five Whiteboard opening callbacks no longer call local `setId`/`setScreen` directly; they enter the shared fresh authorization/placement and dirty-workspace guard.
- Executed all 13 JSX callbacks through a harness that rejects any direct mutations. User/Project permissions unchanged.
- Separate workspace-local selector and Project-tab lifecycle audit remains. See `G27_PASS12_SHELL_WORKSPACE_ADMISSION_CLOSEOUT.md`.

### G27 Pass 13 | Project tab and in-workspace selection safety

- Active Project tab close/close-others validates unsaved-work departure before removing tabs or switching Project. Revoked fallback Projects are omitted; background tab closings remain nonblocking.
- Board/Whiteboard local selectors and Board close now use canonical authorized navigation; dropping a Board's loaded state happens only after the selection actually clears.
- 20 executable tab/JSX callback tests and inherited regressions. Outstanding: asynchronous Board request races. See `G27_PASS13_PROJECT_TABS_LOCAL_SELECTORS_CLOSEOUT.md`.

### G27 Pass 14 | Board response identity and race suppression

- Board API results, errors and loading states now require matching latest request sequence, selected Board ID, authenticated user and active Board route. Old results cannot overwrite a newer selection or current error.
- Logged-out/session-changed contexts invalidate outstanding requests; current Board reads are uncached permission rechecks.
- 17 fault-injection tests plus inherited suites. The same race needs targeted examination in other asynchronous workspaces, not automatic broad assumptions. See `G27_PASS14_BOARD_RESPONSE_IDENTITY_CLOSEOUT.md`.

### G27 Pass 15 | Browser history authorization and guarded restoration

Source-implemented: popstate/hashchange admission now requires fresh Project/Board/Whiteboard authorization, maps moved workspaces to current placement, confirms dirty-workspace navigation before UI state commits, coalesces competing event paths, and ignores stale navigation/session results. Focused behavioral source tests and inherited G27 regressions run through `cluster:g27:p15:browser-history`. Runtime deployment certification remains separate; initial authentication hydration and non-workspace inspectors require independent integration evaluation.
