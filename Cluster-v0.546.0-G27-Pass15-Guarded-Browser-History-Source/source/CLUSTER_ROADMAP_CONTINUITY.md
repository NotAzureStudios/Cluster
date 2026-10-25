> **LATEST TD6 GROUPED IMPLEMENTATION (2026-10-19):** G15 adds 4 MiB authenticated, per-chunk entitlement-checked Package transfer with in-session retry and Transfer Center browser handoff. Existing signed ZIP sizes still cap at 4 MiB ordinary / 32 MiB MSI; true large blobs and durable native staging remain OPEN. See `IMPLEMENTATION_ROADMAP_TD6_G15.md` and `TD6_G15_TO_G16_HANDOFF.md`.

> **LATEST TD6 GROUPED IMPLEMENTATION (2026-10-19):** G14 checks the staged MSI's actual Windows Installer Property-table ProductCode/Version against the independently signed declaration before consuming installer grants or launching Windows Installer. Qt and Desktop expose separate read-only MSI embedded-identity evidence, not OS-health attestation. Source-level only; TD6 remains open and runtime certification deferred. See `IMPLEMENTATION_ROADMAP_TD6_G14.md` and `TD6_G14_TO_G15_HANDOFF.md`.

> **LATEST TD6 GROUPED IMPLEMENTATION (2026-10-19):** G13 requires signed MSI ProductCode/version identity, stores it in native attempt evidence, and adds read-only Windows Installer registration/version checks to signed preflight and Desktop recovery views. OS registration is not software health or MSI-source attestation. CD-08 and other CD gaps remain open; runtime certification is deferred. See `IMPLEMENTATION_ROADMAP_TD6_G13.md` and `TD6_G13_TO_G14_HANDOFF.md`.

> **LATEST TD6 GROUPED IMPLEMENTATION (2026-10-19):** G12 adds a bounded 32 MiB signed-MSI-specific path (ordinary Packages remain 4 MiB), fixes large base64 verification, and exposes read-only native MSI attempt/recovery evidence in Desktop. CD-08 and other CD gaps remain open; comprehensive runtime certification is deferred. See `IMPLEMENTATION_ROADMAP_TD6_G12.md` and `TD6_G12_TO_G13_HANDOFF.md`.

> **LATEST TD6 GROUPED IMPLEMENTATION (2026-10-19):** G11 adds opt-in, admin-authorized, separately signed MSI execution grants and native Windows MSI preflight/attempt evidence. CD-08 remains open for large installers, installed-product attestation, recovery and cross-Package rollback. Full runtime certification remains deferred. Read `IMPLEMENTATION_ROADMAP_TD6_G11.md` and `TD6_G11_TO_G12_HANDOFF.md`.

> **LATEST SOURCE PRIORITY (2026-10-17):** TD6 feature implementation comes first; runtime certification is deferred. Start with `CLUSTER_IMPLEMENTATION_FIRST_DIRECTIVE.md`, `IMPLEMENTATION_ROADMAP_TD6_F01.md` and `TD6_F01_TO_F02_HANDOFF.md`.

# CURRENT SOURCE — TD3 Pass 14 (2026-10-13)

Continue from Pass 14, based on Pass 13 (and including all TD1/TD2 closeout + TD4 reliability changes). Shared menu dismissal/undo, touch context interactions, People identity, and Qt source parity improvements are source-implemented; see `TD3_PASS14_MENU_PEOPLE_QT_HARDENING.md`. **TD3 is still open for defined implementation**, not release certification. Keep floating/docked shell options, Project Tabs replacement search, taskbar utilities, per-user accent rings, and independent presence dots.

# Current continuation: TD3 Pass 12 (2026-10-13) implements the user-requested animated search replacement of Project Tabs only. Source base: Shell Regression Audit (TD3 Pass 11 + TD1/TD2 closeout + TD4 Pass1). All other taskbar utilities remain untouched. Source notes: TD3_PASS12_TASKBAR_SEARCH_IMPLEMENTATION.md. Release certification roadmap is separate.

# Current decision (2026-10-13): TD1/TD2 core implementation closed and release certification split out. See TECH_DEBT_MASTER_ROADMAP.md, TD1_TD2_IMPLEMENTATION_CLOSEOUT.md, CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md. Continue TD3/TD4/TD6 implementation without waiting on OS/DB acceptance.

# Cluster v0.546.0 | TD3 Pass 8 Continuation | October 12, 2026

**Newest source:** TD3 Pass 8 is built on **TD4 Pass 1**, not TD3 Pass 7. It preserves the prior TD4 Global Create, shared async action-menu and Command Palette work. See `TD3_PASS8_RESPONSIVE_LAYOUT_INTERACTION_HARDENING.md` for precise changes, tests and limits.

# Cluster v0.546 Tool Developer Kit | October 10, 2026

New standalone-tool route contract and renderer module registry; Inventory, Vault and Integrations migrated. Searchable Admin tool directory covering all canonical tool identities, scaffold/check tools, validated deep links and developer guide. API authorization remains independent. Source-level only; full runtime certification deferred. See `FEATURE_PROGRESS_0546.md`.

---

# Cluster v0.545 Inventory/Vault standalone tools | October 10, 2026

Inventory and Vault now have independent sidebar routes and workspaces. Employee-owned resources and admin asset/key-pool operations share the Inventory tool; encrypted standalone Vault secrets are admin-only, with controlled reveal, edit, rotate and revoke. See `FEATURE_PROGRESS_0545.md`.

---

# Cluster v0.544 Forms completion | October 10, 2026

Admin form editing, audience assignment, draft publication, recipient My forms, revision-safe submission and admin review queue are now source-integrated. Form notifications connect to the existing Inbox. Independent applications workflow retained. Browser/PostgreSQL certification and advanced respondent drafts/reminders remain deferred. See `FEATURE_PROGRESS_0544.md`.

---

# Cluster v0.542 Inventory commercial key pools | October 10, 2026

Inventory Admin gains Vault-backed encrypted game/license key pools: create/import/deduplicate/assign/redeem/revoke/privileged reveal, bounded paging and search, and Vault route bypass protection. This is admin-controlled distribution only; person self-service, external redemption verification and contracts/seat synchronization remain open. Runtime certification deferred. See `FEATURE_PROGRESS_0542.md`.

---

# Cluster v0.540 Library completion | October 10, 2026

Recursive Smart Collections, bounded cross-page bulk selection, protected Personnel Record collection filtering, revision-safe single membership removal. Explicit collection sharing authority remains open. No native/schema changes or runtime certification. See `FEATURE_PROGRESS_0540.md`.

---

# Cluster v0.537 People/Admin lifecycle closeout | October 10, 2026

Application review and member conversion now use a canonical optimistic-revision contract and database CAS; account creation is contingent on claiming the exact approved submission. Admin applications preserve notes and show temporary passwords in a dismissible local credential surface with opt-in mapping selection. Approval and application lists no longer report false emptiness after refresh failures. Offboarding gains duplicate-action locks, reconciliation rather than blind mutation replay, and revision claims for equipment, completion, and cancellation. These are development-source changes, not PostgreSQL or Windows certification. See `FEATURE_PROGRESS_0537.md`.

---

# Cluster v0.536 assigned source-review workflow closeout | October 10, 2026

My Work now opens exact assigned source reviews in Project Source; comment-only reviews remain actionable, failed attention subfeeds stay visible as partial outages rather than false empty queues, and failed mutations preserve drafts. Requesting changes requires a reason at UI and server. No schema/native changes. See `FEATURE_PROGRESS_0536.md`. Broader Work/People/Library/Admin and deferred runtime certification remain open.

---

# v0.525 cross-layer managed-content closeout | October 9, 2026

Desktop now recognizes Go's actual managed result digest, avoiding false failed deployment status. Signed active/previous managed-copy audits detect local corruption without changing pointers or producing server receipts. Nonattested rollback device reports can complete the same single-use receipt chain as selection when it remains fresh. Actual Windows/Qt runtime, PostgreSQL, OS-level executable installation/health and broad collaboration/Library/UX work remain open. See `FEATURE_PROGRESS_0525.md`.

---

# v0.524 managed-content authorization update | October 9, 2026

Independently signed 60-second control grants, revocation-sensitive device targeting, separate native trust, authorized private managed content copying, pointer rollback and safe nonattested reporting. This completes the *unprivileged content handoff* slice only, not system software installation. Next: Windows/Qt/PostgreSQL certification and supervised OS install/rollback with trusted health evidence, then remaining Work/Library/Admin/Packet media and UI roadmap. `FEATURE_PROGRESS_0524.md` is authoritative for this source pass.

---

# v0.522 Distribution / native-integrity / admin-navigation continuation | October 9, 2026

Opt-in original PDF flattening via new image-backed PDF derivatives, shared authorized and checksum-verified file reads, signed native Package selection audit and consolidated Admin specialist section fixes. All production native PDF decoding/hostile-source certification, OS installation, activation-time authorization and Live/PostgreSQL/Qt Windows certification remain open. See `FEATURE_PROGRESS_0522.md`.

---

# v0.521 Distribution continuation | October 9, 2026

Opt-in Packet image derivatives (JPG/PNG/WebP inputs to detached small WebP), verified uploaded .txt to fresh PDF publication, author previews, controlled recipients/ZIPs, and moved source transformation outside the database transaction with commit-time immutable-manifest and edit-access recheck. **Still open:** secure original PDF, audio/video derivatives; production sharp decoder load, full Windows/PostgreSQL runtime; signed Package reauthorization at actual activation, OS-managed install/rollback/health; collaborative Work, Library/Admin and UX feature ledger. No new production compatibility scaffolding.

---

# v0.520 connected distribution/deployment source implementation

**Implemented:** signed Package target-to-native stage identity binding, fresh server authorization for rotating device-reported receipt progression, independently provisioned local signing pin preserved, explicit no-installation status, bounded detached plain-text uploaded Library file Packet derivatives, snapshot/path/integrity checks, and Personnel Records publication policy guard. **Next gates:** native supervised installation in authorized managed roots with real Windows filesystem transaction and rollback, reauthorization immediately before activation, health evidence, OS runtime tests; full binary media derivative adapters; collaboration/Undo/Redo, outstanding Library/Admin/UX and 1.0 certification. Backend/UI/test portions alone do not mean OS certified.

---

## October 9, 2026 | v0.519 manual authenticated native staging

- Staging kits import into the actual Go stager through memory-bound signed release verification; no filesystem sidecar extraction by Qt and no package execution.
- Qt Desktop now provides on-demand native picker + confirmation + separate per-profile trust-pin read + guarded asynchronous verifier. Renderer submits no filesystem path or executable parameters; profile-change cancels in-flight verification.
- Source tests pass, but Qt/Windows and fresh server permission/entitlement file-binding certification remain open; next priority is server-authorized native orchestration, content consumer trust and supervised OS installation policy.

# v0.518 source feature continuation

Implemented: signed-in Desktop Package discovery and manually downloadable, SHA-256 verified signed-release staging kit; Qt package build includes Go verifier/stager helper for later independently provisioned use. Security boundary is explicit: browser holds non-exportable ES256 device proof key; kits never contain receipt challenges or trusted pins; server public keys included in kits are *not* independently trusted. Next: authenticated native orchestration and entitlement recheck, supervised OS install/rollback, signed policy-proof and real device attestation; then original media derivatives, collaboration and full runtime certification. See `FEATURE_PROGRESS_0518.md`.

---

# v0.517 source feature continuation

Implemented: admin-only, on-demand Package rollout reconciliation over verified Desktop registration pages, using the exact signed target selector and nonattested receipt evidence. Platform remains a simulation, not independently attested OS data; device reports remain unverified claims. Native authenticated Qt staging, service-owned activation, signed policy-proof, device attestation, original media/PDF derivatives, Work collaboration and production certification remain open. See `FEATURE_PROGRESS_0517.md`.

---

# v0.516 source feature continuation

Completed: Go signed-content selection/rollback pointer with staged-tree revalidation, server receipt `content_selected`, optional immutable Packet PDF publication watermark. **Still open:** OS installer/Qt signed device agent, secure original-PDF/media derivatives, Package policy attestation, Work collaboration and native runtime certification. See `FEATURE_PROGRESS_0516.md`.

---

# Active 0.515 Package convergence

Device delivery, one-time reports and native staged ZIP verifier implemented. Native install/rollback, attested receipts and full Windows/PostgreSQL certification remain open. Other feature-ledger goals unchanged; see `FEATURE_PROGRESS_0515.md`.

---

## Current development position: 0.514.0

Verified signed device download feed and server delivery implemented as feature code, not installation. The signed Package native agent, install/rollback evidence, Packet source media derivatives, full Work collaboration and Library/Calendar/Studio feature ledger remain to implement. Source-only regression green, production compilation/runtime certifications intentionally deferred. See `FEATURE_PROGRESS_0514.md`.

# 2026-10-08 Cluster 0.513 feature implementation continuation

Authoritative Pass 15 merge remains the trusted source. Managed Package signed releases, revocable keys, staged rollouts, policy-only rollback targets, device registration-bound pins and People offboarding cleanup are source implemented. Packet authors can publish eligible text notes as detached PDFs; **uploaded binary source processing remains pending**. Continue building planned features while full application compilation and certification are deferred at user direction. See `FEATURE_PROGRESS_0513.md`. Historical notes below reflect earlier milestones.

---

# 2026-10-08 source integration update

**Authoritative Pass 15 source reconciliation is completed at the source level**, retaining the modern P16C and 0.512.2 developments. Old "Pass 15 not merged" statements below are historical, not active blockers. The next first priority is a dependency-backed full compile followed by real PostgreSQL migration/runtime and Windows native build certification. Product feature completion, including binary/PDF Packet derivatives and Packages deployment, remains separate.

---

# v0.512.2 continuation (source only)

Expanded 0.512.x feature work: detached Packet note-bundle ZIP with integrity manifest and authorized download; admin release revocation with retained audit/protected source references; idempotent notification inbox event materialization; durable Discord receipt recovery (manual authorized and adaptive scheduled). Full product feature ledger and Pass 14/15 source reconciliation remain open. See `VERSION_0512_BUNDLE_REVOCATION_NOTIFICATION_HANDOFF.md`.

---

# Cluster v0.512.1 continuation (October 8, 2026)

Opt-in, separately stored and hashed text-note derivatives can be published with Packet releases and downloaded by eligible recipients. Author-only preflight; version-pinned bytes; no Library source downloads. PDF/video/binary adapters, Managed Packages, shared Work collaboration and production certification remain open. See `VERSION_0512_TEXT_DERIVATIVE_HANDOFF.md`.

# Cluster v0.512 transition (October 8, 2026)

v0.511 Communications/Distribution work transitions to the v0.512 development and certification-entry checkpoint. Hash-verified Packet catalogues with frozen recipient audiences, published-source destruction protection and mandatory critical security notifications are source-implemented. Actual derivative delivery and full build/runtime certification **remain open**. See `VERSION_0511_TO_0512_HANDOFF.md` and `FEATURE_PROGRESS_0512.md`.

# Cluster v0.511 transition (October 8, 2026)

The v0.510 Planning/Projects/Library wave advances to the v0.511 Communications, Packages, Integrations and Distribution wave. Project closeout lifecycle/partner-link privacy, multi-day Calendar overlap/DST, and Library destruction/retention transactions received source-tested hardening. No final certification or authoritative Pass 14/15 merge is claimed. See `VERSION_0510_TO_0511_HANDOFF.md`, `FEATURE_PROGRESS_0510.md` and `FEATURE_PROGRESS_0511.md`.

# Cluster Roadmap Continuity

**Tracking baseline:** Cluster v0.510 development source (v0.509 Work System transition), October 8, 2026.
**Release naming:** Cluster v0.509 → v0.510 → v0.511 → ... → v1.0. Internal npm SemVer: `0.510.0`.
**Purpose:** Keep the full Studio/Cluster 1.0 program visible while engineering works through bounded infrastructure slices. **This is an index and continuity guardrail, not a replacement for the full Master Roadmap and Feature Ledger.**

## Current checkpoint: v0.510 Planning, Projects, Library and Administration entry

The Work System source pass introduces a fifth Board view (Timeline, projecting canonical Card dates), compare-and-swap EntityComment edits/deletions and safe reaction retries, and atomic revision-checked Board List reordering. The 0.509 scope is **not declared complete**; shared Work status, Whiteboard conversion, cross-tool Undo/Redo, reviews and offline multi-editor testing stay in backlog. PostgreSQL migration remains unapplied. See `VERSION_0509_TO_0510_HANDOFF.md`.

### Prior checkpoint: v0.508 People lifecycle entry (active development, not runtime-certified)

Source implemented: atomic People provisioning (identity, membership and normalized workforce in one transaction); atomic profile/role edits; permission-aware Access Explorer explanations; resource-safe Project Access labels; broader canonical action menus. The v0.507 workstream transitions to v0.508 with open scoped-grant, full impact simulation and cross-tool adoption tasks preserved as backlog, not certified. See `VERSION_0507_TO_0508_HANDOFF.md` and `FEATURE_PROGRESS_0508.md`.


**Feature-first user testing policy (October 8, 2026):** implement the entire remaining roadmap before beginning comprehensive Windows/PostgreSQL/GPU/multi-user runtime and acceptance certification. Keep automated source/unit/security checks in every engineering batch to avoid regressions. Track all runtime and migration gates for final 0.512 hardening; do **not** claim those checks have been performed. Versions can advance while certification remains open.

**Current implementation batch:** Company Graph projected from the canonical Workforce API into People → Organization. Departments form a navigable hierarchy; Teams and Employment supply membership and reporting links. Users can drill into profiles; authorized editors can create and revise Department hierarchy/lead/name with optimistic revision and transaction-locked cycle detection. Workforce queries, organization writes and other-person availability changes now enforce same-workspace authorization and redact out-of-workspace manager/team references. No new Prisma schema or duplicate organization store. See `VERSION_0507_COMPANY_GRAPH_HANDOFF.md`.

**Source integrity caveat:** still derived from Pass 13 with cumulative overlays and 0.506 changes; Pass 14/15 authoritative source merge must be conflict-reviewed before release. This remains a tracked integration task, but does not block feature construction in 0.507–0.511.

## Historical checkpoint: v0.506 (development source, not runtime-certified)

Source-implemented and statically/source-tested work includes owner-recovery/password cleanup and passkey enrollment policies; guided/quick/import/skip setup; safe allowlisted `.clusterconfig` import/export, preview, audited publication and revision history; Admin setup checklist; settings partial writes and security gates; retained staged capability-exposure work (Library lifecycle, access explanations, workforce availability, Project workflow graph, metadata preview, Admin audit); GPU metrics, adaptive video encoding, CUDA video-thumbnail fallback, and PostgreSQL-backed GPU leases.

**Critical integrity gate:** v0.506 still derives from a P13 + P16C staging tree. It has **not** been conflict-reviewed and merged into the authoritative P15 source; do not overwrite P14/P15 improvements. Runtime certification is not complete. Actual native Windows, PostgreSQL multi-writer/multi-worker, FFmpeg GPU, WebAuthn, privacy/ACL and DPI testing are still required.

**Retained integration/certification ledger:** merge authoritative Pass 15 source; verify all migration/transaction/lease/recovery and owner authentication behavior with real PostgreSQL/Windows during 0.512 certification. GPU remains a bounded Media/Resource Governor track.

## Major remaining release tracks

| Release | Main focus | Status | Must not lose |
|---|---|---|---|
| **0.506** | Company/Identity/Security foundation, OOBE/config/recovery, runtime convergence | **In progress** | Authoritative source merge and real certification; no shared master password; secure owner recovery; server config governance |
| **0.507** | Company/Resource Graph, permissions, shared runtime and search | **Feature wave transitioned; open integration backlog** | Canonical resource identity/relationships, scoped roles/bundles, access explanations, shared commands/actions/views/inspectors and search |
| **0.508** | People, lifecycle, Forms, Packets, Inventory, Vault | **Source wave transitioned; end-to-end delivery remains incomplete** | Employment/Teams/engagement, onboarding/offboarding, authoring/publishing, entitlements and secret safety |
| **0.509** | Work System consolidation | **Source wave transitioned; scope remains open** | Boards, Whiteboards, Tickets, actions, dependencies, comments/mentions, reviews, collaboration and workflows without duplicate authorities |
| **0.510** | Planning, Projects, Library and Administration | **Source wave transitioned; carry-forward open** | Calendar/Scheduler/Timeline, Project identity/type/profile, asset explorer/relations/versions, lifecycle/closeout and Tool Config hierarchy |
| **0.511** | Communications, integrations, Packages and distribution | **Development entry: active** | Notifications, announcements, Discord, Git/LFS/Unreal, controlled Packet/Package release and Desktop deployment |
| **0.512** | Full production certification and hardening | **Planned** | Windows/native builds, Qt parity, PostgreSQL bootstrap, permissions/privacy tests, load/caching/worker behavior, GPU/CPU benchmarks, UI/DPI/mobile, disaster recovery |
| **1.0** | Certified release | **Not achieved** | No promotion from static tests alone |

Versions describe the main integration wave, not an exclusive feature gate: shared primitives may be implemented earlier when necessary. Every version should contain **Major Systems + Small Wins + Cleanup + Certification**.

## Always-on cross-version feature ledger

Track each entry as **Planned → Backend Ready → UI Ready → Integrated → Tested → Certified**. A passing source assertion is not certification.

### Shared platform
- Command/mutation engine with idempotency, Undo/Redo, draft/autosave, conflict resolution and safe retries.
- Shared Create that creates once, dismisses the panel and opens the created resource.
- Shared resource picker, action registry/context menus, inspector, bulk selection/action and impact preview.
- Shared filters/smart/saved views, resource/reference graph, compare/diff, revisions/publishing, import/export, templates and audit/activity distinction.
- Shared status/health, lifecycle/archive/retention, transfer/progress, preferences, navigation/session, clipboard/drag-drop, notifications and UI feedback.

### Studio & access
- Company structure, employment/teams, account types separate from roles; scoped access and independent Portal access policy.
- MFA/passkeys/recovery and audit, access previews and server-enforced resource visibility.
- Guided/quick/import/skip OOBE, setup checklist, safe configuration snapshots, proper Tool Infrastructure vs Studio Settings vs Server Config separation.

### Work, content and distribution
- Projects, Boards, Whiteboards, Tickets, Timeline, Builds/QA, workflows, Calendar/Scheduler, People, My Work/Home, Library, Packets, Inventory/Keys/Entitlements/Vault and Packages.
- **Distribution boundary:** a Packet entitlement never grants source Library access. **Derived Delivery Only** should be the default; content delivery uses authorized, immutable published versions, not arbitrary source links.
- Git/LFS and Unreal integration, Discord transport, Desktop workstation/OS features, Portal, external-safe names, NDA/guest/contractor access.

### Usability and small wins
- Global taskbar search drawer that restores project tabs on exit; consistent modal/drawer/action patterns.
- Tooltips/help/first-use guides, permission-denial explanations, usable empty/error/loading/progress states and nonintrusive completion notices.
- Responsive/mobile usability, Comfortaa/theme inheritance, no overlapping buttons or clipped icons; 100%/125%/150% Windows DPI checks.
- Personalization, recents/favorites/pins, bulk previews, drag/drop, shortcuts, stable behavior across reconnection/offline states.

### Infrastructure and reliability
- Authenticated metrics with CPU, RAM, disk, network **and GPU** capabilities/pressure and useful processing throughput; no sensitive hardware inventory in public health.
- Hardware-adaptive worker resource governor; GPU offload only where supported/benchmarked, CPU fallback and shared cross-process leases.
- PostgreSQL/Prisma correctness, media and background queue reliability, permission-safe caching, multi-tab leadership and efficient SSE reconnects.
- Secure backup/restore, Windows managed-process teardown, Qt Desktop parity and multiple-real-user verification.

## Latest shared-engine continuation (0.506 staging)

The latest cumulative package strengthens generic idempotency handling for privileged exports, resource-graph access/pagination, and the canonical Calendar visibility boundary in global Search. This is **source tested only**. These improvements move forward the Shared Mutation / Resource Graph / Search engines without claiming the entire 0.507 implementation is finished. They do not change the 0.508–1.0 major system plan.

## Immediate execution order

1. **Build 0.507 major features:** Company/Resource Graph, scoped authorization and reusable shared engines. Avoid successive GPU-only or config-only micro-passes.
2. **Advance 0.508–0.511 feature work** in coherent batches; use the Feature Ledger so small UX wins and security requirements are not forgotten.
3. **Preserve authoritative source:** retain the Pass 15 merge as a conflict-review gate, never silently overwrite Pass 14/15.
4. **Certify after features:** run complete real PostgreSQL, Windows, authenticators, media, multi-user, privacy, performance and visual tests in 0.512.
4. **Maintain the ledger:** every implementation status change needs code evidence + the corresponding UI/integration/test gate, with migrations/native/Windows gates listed separately.
5. **Keep the public version simple:** one tested, recoverable source package per release, with a short handoff and clear remaining blockers. Do not encode RC/WIP/pass identifiers into public artifact names.

**Scope warning:** The original `Cluster-1.0-Master-Roadmap-and-Handoff.zip` is referenced in the project Library but its raw contents were not accessible during this continuity update. Cross-check this index against its complete Feature Ledger at the next opportunity before treating it as exhaustive.

### v0.506 Server Configuration continuation

The Server Config editor/API now uses changed-field preconditions, mandatory Security PINs, strict input and safer staged on-disk publication. This is **source-tested only**. Database/file crash recovery, cross-process serialization and Pass 15 integration remain active 0.506 release blockers. See `VERSION_0506_SERVER_CONFIGURATION_HANDOFF.md`.

### v0.506 server configuration crash-journal continuation

Durable journal + database commit marker and safe startup reconciliation are **source-implemented**, with 13 local-filesystem journal scenarios and retained publication conflict checks. Real PostgreSQL/Windows kill/restart certification, noncanonical settings writers, the authoritative Pass 15 merge and remaining security/setup gates stay **open**. The remainder of the roadmap (0.507 Company/Graph/shared engines through 0.512 certification and 1.0) is unchanged.

### v0.506 configuration and security writer continuation

Explicit admin Context Pack authorization, guarded field-selected application, Security Policy and Discord changed-field publication, and deliberate/journaled secret rewrap are staged and source-tested. The unresolved **Pass 15 merge, live database, Windows/NTFS, authenticator, context-pack sensitive-export policy and certification** remain release gates. See `VERSION_0506_CONFIG_WRITERS_HANDOFF.md`. These changes do not postpone the major 0.507–1.0 roadmap.

### v0.506 Search and Graph permission-safety continuation

Source-tested improvements: authorization decisions are now request-local (ranking can be cached); only matching search candidates need ACL checks; hidden index counts are excluded from user responses; project refresh retains global and other project ACLs; ACL changes refresh full rules and queued changes replay; database ACL fetch errors fail closed; graph project scope/truncation checks tightened. **13/13 focused tests plus the full inherited foundation suite passed.** This advances shared Search/Graph foundations ahead of 0.507 but does **not** certify the overall 0.507 program. The original master roadmap, ledger and all later versions remain in force. See `VERSION_0506_SEARCH_GRAPH_PRIVACY_HANDOFF.md`.

### v0.506 access and search consistency continuation

Source-tested Access Rule outage fail-closed enforcement across canonical authorization, cold/full Search rebuild generation safety, and access-change event identity normalization. New 13/13 regression tests. Pass 15 merge, PostgreSQL/Windows runtime and cross-server revocation proof remain open. The 0.507–1.0 major systems and small-wins ledger remain unchanged. See `VERSION_0506_ACCESS_STABILITY_HANDOFF.md`.

### v0.506 resource identity + Project graph evidence continuation

Source-tested: global vs project-scoped identity normalization, no child-ID-to-parent-ID impersonation in activity/notifications, explicit-parent-only notification links, stale or deleted workflow endpoint filtering, per-request auth/existence memoization and bounded graph frontier/scan work. 14/14 focused identity/graph checks. **Still pending:** authoritative Pass 15 merge, loaded PostgreSQL ACL+graph benchmarks, native/Windows runtime certification, and all 0.507–1.0 roadmap tracks. See `VERSION_0506_RESOURCE_IDENTITY_HANDOFF.md`.

### v0.507 shared resource actions / interaction guard continuation

A typed Resource Action resolver now adapts domain-owned actions to the existing menu controls using the canonical resource manifest, without creating a parallel backend command or authorization authority. Work Actions and Project tabs are the first consumers. The shared mutation gate coalesces duplicate Project Access create/update/delete intent, preserving server-side idempotency for supported operations. A common Project Access Resource Picker now drives both rule creation and Access Explorer; stale access decisions are guarded. Restricted share-link secret responses are excluded from the generic durable replay receipt. These are **source-tested only**, with broader action adoption, scoped permission bundles, server-authorized discovery, and runtime certification outstanding. See `VERSION_0507_SHARED_ACTIONS_HANDOFF.md`.

### v0.507 authoritative access target discovery continuation

Project Access's shared Resource Picker now fetches only bounded server-authorized target names via canonical Project/target Access Rule evaluation and Library folder/source policy. The same discovery powers Rule creation and Access Explorer, with search and fail-closed error states. The Access Explorer preview route checks the request actor's own visibility and target's Project scope before showing target-specific explanations. Source-checked; 93 combined focused checks; no database migration. General cross-studio discovery, scoped bundles/roles, Pass 15 merge, PostgreSQL/Windows runtime and 0.512 certification remain open. Details: `VERSION_0507_AUTHORIZED_DISCOVERY_HANDOFF.md`.

### v0.507 project-scoped membership roles and access-rule preview

Role keys and access levels are now explicit canonical ProjectMembership state, not free-form label inference. Project Access offers a manager-verified, bounded, read-only before/after simulation of adding an Access Rule, without exposing individual subjects. Do not conflate Project roles with Studio permission bundles. Source-level tests pass; runtime/transaction atomicity, broad Project/Team bundle inheritance, Pass 15 merge and v0.512 certification remain open. See `VERSION_0507_PROJECT_SCOPED_ROLES_IMPACT_HANDOFF.md`.

## October 8: Atomic membership + secure picker paging

A v0.507 source pass consolidated Project crew/header writes into a single Prisma interactive transaction and added bounded, encrypted, actor/project/search-bound paging to the server-authorized Project Access Resource Picker. Studio/Department/Role Permission Bundles still remain separate from ProjectMembership roles and target Access Rules. Wider scoped bundle inheritance and cross-tool picker adoption are not yet delivered. Testing remains source-/mock-runtime-level until final PostgreSQL/Windows certification.

## Latest v0.507 continuation: Team bundles and authorized picker

Team-scoped Studio Permission Bundles are attached to the canonical normalized Team records and evaluated by the existing access resolver. Team assignment requires Admin independent of People tool management. Access Explorer now uses normalized Team membership authority, and the shared Resource Picker has kind-bound authenticated continuation and one reusable client query hook. **Project-specific bundles and arbitrary cross-tool discovery are still planned**, not implemented. See `VERSION_0507_TEAM_BUNDLES_PICKER_HANDOFF.md`.

## October 8, 2026 | Project bundle ceiling + Board picker continuation

- v0.507 Project bundle assignment is now implemented as a Studio Settings **restrictive policy ceiling** on a specific Project. This explicitly does **not** implement per-member Project-bundle grants. Existing authorization, Project membership and Library ACLs remain necessary.
- Project Lead archive helper now respects Project-scoped ceilings. Source-level Project/target decisions include policy contributors; administrator recovery requires an active identity.
- Project Access continues to use the shared authorized picker. Card Projection now also consumes the same Project-scoped server-authorized, kind-filtered, paginated discovery, lazily.
- Remaining in 0.507: scope-specific grant administration without bypasses, Project policy impact previews, wider shared picker/actions adoption, Resource Graph/search integration, source reconciliation. 0.508–0.512 roadmap unchanged.

## October 8, 2026 | Resource Graph discovery continuation

- Completed category/severity/blocking filters and SQL-pushdown for canonical resource graph. Authorization-filtered node display labels and safe Project Control focus now reuse existing workflow hydrators and server-authorized Resource Picker; graph ACL checks run with bounded concurrency and request-local caching.
- Added tested graph behavior without adding a graph store, migration, parallel permissions engine, or global search ACL shortcut. This is **source-level implementation**, not release certification.
- Remaining 0.507 priorities: scoped grant administration and impact previews, wider picker/action adoption and Library/Inspector Used By views. 0.508–0.512 roadmap and Pass 14/15 merge requirements remain unchanged.

## 0.507 Project Control privacy + Library references continuation (October 8, 2026)

Project Control overview now filters ProjectRelationship edges, link-candidate metadata, and linked entity IDs by the viewer's actual target authorization; the summary counts only visible edges. Library Inspector can browse authorized incoming/outgoing Resource Graph links in a lazy References view with shared Work actions. This is a source-level implementation checkpoint, not full PostgreSQL/Windows/browser certification. See `VERSION_0507_LIBRARY_REFERENCES_CONTROL_PRIVACY_HANDOFF.md`.

## v0.508 → v0.509 source milestone (October 8, 2026)

Transactional People provision/profile foundations plus offboarding Inventory revocation; server-validated Forms and closed-version enforcement; Packet immutable author-only source manifests; Inventory assets and locked seat allocation; separated encrypted Vault records and MFA/audit reveal, with small admin screens. Development source only. See `VERSION_0508_TO_0509_HANDOFF.md`.

**Carried forward:** Complete key/seat entitlements, Packet derivative delivery, account lifecycle/engagement workflows, vault recovery/authenticator UX, permission grants and actual performance/runtime certification. The authoritative Pass 14/15 conflict merge remains a hard prerequisite to merging into production.


## v0.523 development checkpoint (October 9, 2026)

Completed native out-of-band signing trust setup from Qt Desktop, read-only staged-content re-audit on Go using immutable signed staging kits, and the truthful server/Admin deployment reporting contract. There is no activated state until supervised OS installation and attestation are real. See `FEATURE_PROGRESS_0523.md` for tests and remaining blockers. Preserve the broader Work/Collaboration/Library/UX/Certification ledger and do not infer rollout entitlement from an old signed ZIP.

## 0.532 direct file updater workflow (October 10, 2026)

Connected authenticated server Package download to Qt native staging-kit transfer, Go signing-key-pinned verification, and native destination-file update. The new on-demand **Download & update files** action eliminates the repeated save/pick/re-pick ZIP workflow. Native confirmation, local modification protection, backup/rollback and current rollout validation remain intact. Deliberately no OS installer. Still open: opt-in unattended update policy and cadence, efficient delta downloads, Qt Windows functional test, Library/Work/Admin feature ledger and deferred certification. See `VERSION_0531_TO_0532_HANDOFF.md`.


## Cluster 0.533 Library workflow completion

Added title-only bulk rename (review, collision/revision/permission guarded), selected metadata CSV export, file-version metadata diff, explicit revision-checked metadata/restore. Does NOT close every Library/Work roadmap item. No installer/OS execution work. Desktop automatic-update policy and Work collaboration remain open; runtime certification still deferred by request.

## Cluster 0.534 Board workflow closeout (October 10, 2026)

Completed in source: Card editor unsaved-draft Undo/Redo, pinned-revision save and double-submit protection, secondary Card edits that stay in the editor, and revision-guarded Board/column manager renames and deletion commands, including database-level revision-qualified deletes. These integrate with existing card conditional-write authority. This is not a claim of persistent server Undo/Redo or completed multi-user rich-text editing. Next remaining Work/Library/Admin and Desktop update-policy ledger stays open; runtime certification remains deferred. See `VERSION_0533_TO_0534_HANDOFF.md`.

## Cluster 0.535 Board collaboration recovery (October 10, 2026)

Added a permission-checked fresh Card read and explicit three-way merge/review for stale editor saves. Nonconflicting local and remote metadata changes can be reviewed together; overlapping fields require explicit per-field owner decisions, and no revision is promoted without user approval. Card metadata Save no longer moves a Card back to a previous column. Header X and browser reload protect unsaved local edits. Whiteboard operation-based collaborative Undo/Redo already exists; do not rebuild it. Persistent server-side Card Undo, broader approval/review flows, remaining Library/Admin/People ledger and Desktop automatic file-update policies remain open. Certification deferred; see `VERSION_0534_TO_0535_HANDOFF.md`.

## Cluster 0.538 People lifecycle completion (October 10, 2026)

Offboarding cancellation now exists in Admin UI and uses explicit reasons and reviewed case revisions. Equipment and completion also require the reviewed revision; creation serializes duplicate active cases on the subject row. Onboarding publishing/assignment/supersession/activation is transactional; steps can be reordered with duplicate rejection, and ambiguous writes are never offered for blind retry. Source-level targeted + simulated transaction + inherited checks passed. Real PostgreSQL/browser/Windows certification remains deferred. Next: broader Library/People/Admin closure and cross-tool UX. See `VERSION_0537_TO_0538_HANDOFF.md`.


## v0.539 Library Collections closeout

Implemented rolling Smart Collection date filters, complete paginated browsing of manual/smart collection contents, saved media/visibility/pinned/exact-folder filters, stable sorting, and revision-qualified collection mutation. Remaining: recursive descendants smart rules, shared collections, true cross-page bulk selection, broader Library/Work/Admin UX and deferred runtime certification. No native updater or Prisma migration changes.

### v0.541 Inventory asset/assignment workflow completion

Inventory Admin now covers a connected asset-management lifecycle: paginated server search; revision-bound asset editing and retirement/reactivation; recipient-checked, capacity-locked assignments/transfers; equipment returns and stock-decrementing write-offs; distinct license revocations; closure evidence and history. No OS installer or Vault ciphertext exposure. The new Inventory revision/closure migration is **source only**; PostgreSQL/browser certification remains deferred. Broader Inventory key pools, entitlements and Vault secret delivery remain on the feature ledger. See `CURRENT_CHECKPOINT.md` and `FEATURE_PROGRESS_0541.md`.

## Cluster v0.543 Inventory recipient self-service (October 10, 2026)

The Inventory administrator asset and commercial key-pool lifecycle is now connected to a recipient **My resources** account view. Recipients see owner-scoped equipment and license seats and may use a PIN to reveal only an active, assigned Vault-backed game/software key with audit-fail-closed disclosure. Result lists contain no secret bytes or Vault identifiers. In-memory authorization and pagination checks pass. Provider redemption/contract syncing and full browser/PostgreSQL/Windows runtime testing remain open. No new migration. See `CURRENT_CHECKPOINT.md`.


## Current continuation checkpoint: TD3 Pass 10 (2026-10-13)

TD1 and TD2 defined core implementation contracts were closed before this checkpoint and remain closed. Pass 10 continues TD3 on that exact merged full source, preserving TD4 Pass 1. Shared pickers, mobile drawer interaction, and dynamically mounted modal background isolation now have working source fixes and repeatable tests. Next continuation should prioritize remaining actual TD3 implementation gaps, not release certification. See `TD3_PASS10_PICKER_DRAWER_MODAL_INTEGRATION.md`.


## Current source continuation (2026-10-13): TD3 Pass 11

Parent is TD3 Pass 10. Home, Projects, Library, People, Calendar, Boards, Settings and shared control illustrative previews now ship with source-level common header/search/metric/history hardening plus mobile Home and People fixes. Preserve earlier TD1/TD2 implementation closeout and TD4 Create/search. Review `TD3_PASS11_MAIN_WORKSPACE_AND_INTERACTION_REFINEMENT.md`; continue missing TD3 implementation and do not promote release certification into the development checklist.


## TD3 Pass 13 (implementation)
Shared action-menu execution is single-flight across all menu actions; recovery notices now guard async restores and surface failures. See `TD3_PASS13_SHARED_ACTION_EXECUTION.md`. Release certification not part of this milestone.

## TD3 Pass 15: Workspace controls and Quick Ticket

- Preserved TD1/TD2 implementation closeout and prior TD3/TD4 source behavior.
- Taskbar Quick Ticket creation now has immediate single-intent and durable idempotency protection, guarded dismissal and stale-fetch protection.
- People and Projects Data Tools now use `ClusterDisclosureGroup`, preserving full analytics/saved-view bodies.
- Qt ComboBox and Switch keyboard/accessibility semantics improved.
- Source-CSS preview gallery and targeted regression tests added; see `TD3_PASS15_WORKSPACE_CONTROL_CONVERGENCE.md`.
- Release certification stays separate. TD3 remains open for remaining *implementation* work only.

## TD3 Pass 16: Shared disclosure and scoped navigation

- Parent is TD3 Pass 15. Seven People/Board/Whiteboard/Project/Library disclosure sections now use the common semantic owner; domain-specific content and visual identity are retained.
- Compact section overflow and resource browsing share scoped outside-click/Escape handling. People filter grid is owned by its content instead of the header shell. Qt native settings window has narrower minimum width.
- Preserve animated Project Tab Search and all taskbar utilities, People identity accents/activity dot, TD1/TD2 closeout and TD4 Create safeguards.
- 17 inherited+new development regression scripts passed; release certification remains a distinct future roadmap. See `TD3_PASS16_SHARED_DISCLOSURE_NAV_CONVERGENCE.md`.

## TD3 Pass 17 · Project / Tickets / identity convergence

- Five Project/Tickets disclosures migrated without removing workflows, analytics, permission gates or share-link controls; canonical native disabled-state semantics strengthened.
- Project team chips now use the canonical identity avatar, user-color accent, independent presence state/dot and invisible-state privacy. Restricted share-link form fields received explicit labels and IDs.
- Source regressions/Chromium fixtures documented separately; TD1/TD2 stay implementation-closed, certification stays outside TD3. See `TD3_PASS17_PROJECT_TICKETS_IDENTITY_CONVERGENCE.md`.

## TD3 Pass 18 · Cross-workspace disclosure continuation

TD3 Pass 17 is the parent. Twelve more legacy expandable panels in Projects, Build/QA, Notifications, Library governance, Project Access and Viewer migrated to the shared disclosure system with detailed domain content intact. Native Qt ComboBox labels now resolve via textAt(index). Shared chevron supports reduced motion. Keep source action-menu convergence as next implementation work; release certification stays separate. See `TD3_PASS18_CROSS_WORKSPACE_DISCLOSURE_CONVERGENCE.md`.

## TD3 Pass 19 | Filter, Admin and People surface convergence (2026-10-13)

Pass 18 is the parent. Projects secondary filters now use a canonical portaled floating surface (correct outside/Escape/mobile behavior). Seven Admin sections, People team context/permission bundles and Project Type advanced settings use the shared disclosure with domain contents intact. Native Qt buttons/switch/combo gained explicit accessibility names/states. Source regression and CSS previews recorded in `TD3_PASS19_FILTERS_ADMIN_PEOPLE_QT_CONVERGENCE.md` and `TD3_PASS19_VALIDATION.json`. TD1/TD2 implementation remain closed, release certification separate.

## TD3 Pass 20: Resource browser and QA/Build filter convergence (2026-10-13)

**Implementation only.** Portaled Board/Whiteboard resource Browse; single-flight window actions; removed the hidden duplicate Builds filters while retaining the canonical visible bar; QA uses shared disclosure; unique input labels and scoped CSS cleanup. Preserve all taskbar, People identity, and appearance contracts. Source and targeted checks: `TD3_PASS20_RESOURCE_NAV_QA_BUILDS.md`, `TD3_PASS20_REGRESSION_RESULTS.json`, `TD3_PASS20_SOURCE_SCAN.json`. Release certification remains separate.

## TD3 Pass 21 continuation

The authoritative implementation source now includes Viewer command overflow on shared floating/action owners, a registry-wide execution gate across toolbar/keyboard shortcuts and safe shortcut error feedback. Keep the existing shell/People preservation requirements. Continue only concrete TD3 implementation gaps; release certification remains separate.


## TD3 Pass 22 implementation continuation

Migrated CompactSectionNav overflow to the shared portaled floating surface, preserving group/active/detail navigation and responsive behavior; standardized menuitemradio keyboard focus; converged Admin/desktop evidence and capture disclosures; fixed stale Admin audit filter response ownership. Full development notes: `TD3_PASS22_NAVIGATION_EVIDENCE_CONVERGENCE.md`. TD1/TD2 remain implementation-closed. Preserve animated taskbar Project Tabs search, My Work/Tickets/Transfer Center, and People identity accents/presence. Release certification is separate.

## TD3 Pass 23: Taskbar notification/presence action integrity (2026-10-13)

Implemented newest-request-wins notification preview, server-acknowledged read state, immediate single-flight guards for notification and presence actions, visible failure feedback, live-stream projection ownership and bounded reconciliation. Taskbar shell/People identity preserved. See `TD3_PASS23_TASKBAR_ACTION_RELIABILITY.md`. TD1/TD2 remain implementation-closed; release certification separate.

## TD3 Pass 24 · Admin action integrity (2026-10-13)

Operations incident workflows and Studio Setup/Configuration controls now share synchronous mutation admission, newest-response ownership and explicit pending feedback. Incident creation and timeline notes reuse stable server idempotency keys on uncertain retries. Confirmed incident actions preserve status across silent health refreshes. See `TD3_PASS24_ADMIN_ACTION_CONVERGENCE.md`. TD1/TD2 implementation remains closed; certification is separate.

## TD3 Pass 25 · Transfer and job feedback ownership (2026-10-13)

Reused the synchronous action gate for taskbar Transfer Center and added visible errors, native-transfer latest-read ownership, transport-specific Retry All and guarded dismissal. Shared job-ID-scoped import/export feedback eliminates cross-job stale status/download links and suspends hidden-page polling. See `TD3_PASS25_TRANSFER_JOB_FEEDBACK.md`. Preserve shell/search/People identity. TD1/TD2 remain closed; release certification stays separate.

## TD3 Pass 26 · Clipboard and sensitive-copy ownership (2026-10-13)

Corrected Desktop clipboard bridge `false` outcomes, consolidated one-time secret/recovery/People/partner-link copies onto shared feedback and immediate action gating, and corrected table/profile copy success reporting. Details in `TD3_PASS26_COPY_INTEGRITY.md`. Preserve animated taskbar search, workspace utility controls, and People identity cues. TD1/TD2 stay closed, certification separate.

## TD3 Pass 27 / active roadmap revision 23 (2026-10-13)

Reconciled TD0–TD7 implementation tracking to the current source, with CD-21 formally excluded from active TD6 and live Windows/PostgreSQL/Qt certification retained exclusively in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`. Quick passes are back: close real source interactions, then move to TD4/TD6 feature work rather than indefinitely migrating presentational controls. Pass 27 fixes shared data import/export action and stale-response ownership. Preserve TD1/TD2 closeout and all established shell and People identity details.


## Revision 24 execution method: deep subsystem passes (2026-10-13)
The active roadmap explicitly replaces the quick-pass cadence. Audit a complete subsystem, implement its full connected scope, preserve application identity, run developmental source regressions, and close only against finite implemented behavior. Qt native controls/component registration and accessibility are the current connected subsystem. Certification is a separate roadmap, not a phase gate. See `IMPLEMENTATION_ROADMAP_R24.md` and `TD3_DEEP_NATIVE_UI_AUDIT.md`.


## v0.546.0 TD3 deep shared-action + Appearance cascade checkpoint

Based on TD3 Deep Native UI (Roadmap R24). Current execution view: `IMPLEMENTATION_ROADMAP_R25.md`. Canonical action feedback now distinguishes server failure, rollback failure and post-server local commit uncertainty; taskbar Search command outcomes are checked before dismissal, including Desktop detached windows and clipboard return values. Project restricted share-link Copy checks the actual native/browser clipboard outcome. Six demonstrated competing Appearance background rules were deleted from their original CSS owners, restoring independently selectable light background presets without a new override stylesheet.

These are development-source implementations. The separate release-certification roadmap remains untouched. TD1/TD2 remain closed, and TD3 still requires the finite remaining action/CSS owner audit before source implementation closeout.


## TD5 source implementation closeout and TD6 G21 (2026-10-19)

TD5 P01–P13 source scope is now formally reconciled closed, following 14/14 P01–P13 selected suites and 167 passing cases. Runtime verification remains in the independent release roadmap, and destructive storage operations remain disabled. TD6 G21 adds normalized recurring meeting occurrence RSVP/attendance, shared Calendar projection and reminder integration, renderer selection and bounded data scans. CD-11 remains source-partial. See `TD5_SOURCE_IMPLEMENTATION_CLOSEOUT.md`, `IMPLEMENTATION_ROADMAP_TD6_G21.md`, and `TD6_G21_TO_G22_HANDOFF.md`.


## TD6 G22 cross-resource collaboration closeout (source development)

G22 resumes G21 without reopening TD5. Added canonical Project entity-comments target, server-enforced Project access, archived-resource denial, authorization-scoped mentions, Project collaboration broadcasts, and Project Overview comment/watch/history UI. Board gained equivalent watch/history views; existing Whiteboard integration preserved. Revision-guarded comment deletion now emits metadata-only Activity evidence. No new migration. Focused/inherited tests pass on source harnesses. CD-03/CD-19 stay partial pending comment pagination, atomic comment/activity records, broader collaborative drafts/Undo/Redo and runtime testing. See `IMPLEMENTATION_ROADMAP_TD6_G22.md`; release certification remains deferred.
