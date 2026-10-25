> **G13 active source checkpoint (October 19, 2026):** Signed MSI product identity + read-only native Windows registration checks implemented; see `IMPLEMENTATION_ROADMAP_TD6_G13.md`. Older phase headlines below are history, not the current implementation baseline. TD6 feature completion remains active and CD-08 is not closed.

> **TD6 G08 source update (October 18, 2026):** Calendar now supports per-recipient authorized reminders, owner/attendee delivery choice, recurrence occurrence identity with daily/weekly/weekday/monthly DST calculations, and aggregate admin evidence. See `TD6_G08_CALENDAR_COLLABORATION_IMPLEMENTATION.md`. CD-11 and CD-16 remain partially implemented: full recurring-event rendering, attendee delegation, flexible notifications/templates and runtime certification are still open. G09 OOBE/Configuration/Help next.

> **TD6 G07 controlling update (October 18, 2026):** G07 source implementation covers Studio announcement draft edit/preview/duplication and shared Copy ID, with full CD-01–CD-20 owner reconciliation in `TD6_G07_CD01_CD20_FEATURE_LEDGER.md`. G01–G07 checkpoints are scoped, not module-wide completion. Continue grouped feature code before TD7 and separate certification. Older checkpoint headers below remain history, not current authority.

> **Current grouped development instruction (October 18, 2026):** Combine related unfinished workflows into major implementation batches. TD6 G01 groups Inventory digital seat expiration/renewal, key leases and disclosure evidence, People offboarding physical custody, and admin/recipient UX. G01 source is the successor to F11. Start G02 as a multi-workflow batch, not a micro-pass. Full runtime certification remains deferred; see `IMPLEMENTATION_ROADMAP_TD6_G01.md` and `TD6_G01_TO_G02_HANDOFF.md`.

> **TD6 F09 current source (2026-10-18):** Governed People access-renewal requests, peer review, durable staged expiry notices and revoked expired sessions; see `IMPLEMENTATION_ROADMAP_TD6_F09.md`. Implementation-first directive and certification separation remain in force.

> **TD6 F07 current source (2026-10-18):** Signed, read-only managed Package destination integrity/drift audit is wired into Qt/Desktop with bounded local evidence. CD-08 remains unfinished, and OS installation is NOT attested. See `IMPLEMENTATION_ROADMAP_TD6_F07.md`. Continue unfinished feature code before platform certification.

> **TD6 F06 current source:** Managed Package native destination update plans distinguish tracked upgrades from local edits/untracked collisions, and Desktop now surfaces a bounded conflict list. CD-08 remains unfinished; see `IMPLEMENTATION_ROADMAP_TD6_F06.md`. Implementation first, certification deferred.

> **TD6 F05 current source:** F01–F04 Forms/Collaboration work is preserved; F05 adds bounded Packet PCM WAV preview-derived delivery. CD-07 remains unfinished; see `IMPLEMENTATION_ROADMAP_TD6_F05.md`. Next code priority is CD-08 Packages. Release certification remains deferred.

> **October 17, 2026 execution-order override:** The user explicitly prioritized unfinished TD6 feature implementation ahead of live runtime/release testing. Follow `CLUSTER_IMPLEMENTATION_FIRST_DIRECTIVE.md` and `IMPLEMENTATION_ROADMAP_TD6_F01.md`. Historical TD5 testing-first text below is retained for traceability, not as the next-pass instruction.

# Cluster Master Technical Debt & Completion Roadmap

> **Current checkpoint: TD5 P1 active, based on TD4 R76.2 source-closed (2026-10-16).** This document retains the historical revision-31 implementation inventory. The controlling current-state documents are `IMPLEMENTATION_ROADMAP_R76.md`, `TD4_R76_SOURCE_CLOSEOUT.md`, and `TD4_R76_FINAL_OWNER_MATRIX.md`. Earlier TD4 "open" statements below are historical. TD5 owns unsafe storage/provider execution and runtime acceptance; TD6 owns unfinished application destinations. No runtime certification is implied.

**Baseline:** v0.546.0 TD4 R31 Library collection sharing (parent: TD3 R30 source-implementation closeout), retaining R29/R28 and earlier source work (original planning baseline: `Cluster-v0.546(1).zip`)  
**Compiled:** 2026-10-10  
**Revision:** 31 — TD4 Library collection sharing (2026-10-14)  
**Purpose:** Track feature and framework IMPLEMENTATION until source-complete. Release/platform certification is tracked separately in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.  
**Status:** Implementation tracker. Historical entries record work as it was performed; they do not override the current implementation-only closure rules below. No full dependency-backed build, Windows/Qt execution or live PostgreSQL certification has been established.

**TD4 R31 update:** Library Collection owner/viewer/editor sharing is now implemented with a Prisma grant model, revision-guarded mutations, ActivityEvent evidence, accessible owner UI and independent item ACL enforcement. See `TD4_R31_LIBRARY_COLLECTION_SHARING_IMPLEMENTATION.md` and `TD4_R31_SOURCE_VALIDATION.json`. This closes only that workflow; TD4 and CD-02 remain open.

## Active implementation tracker (revision 31, supersedes outdated phase gates below)

This is the **source implementation roadmap**, not a release-testing plan. Phase implementation closes when the defined code paths, user-facing behavior, integration wiring, and focused development regressions are present. Real Windows/Qt/PostgreSQL acceptance, full dependency-backed release builds, security/performance soak and multi-user certification belong **only** in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`. None of that is a reason to hold open implemented TD work.

| Phase | Current disposition | Concrete unfinished implementation | Next action |
|---|---|---|---|
| **TD0 — Critical fixes** | Core implemented | No known remaining required TD0 code from current source ledger | Leave closed unless a reproduced source defect is discovered |
| **TD1 — Settings Authority** | **IMPLEMENTATION CLOSED** | Extensions for new setting domains belong to those domains, not another TD1 rewrite | Preserve settings CAS, provenance, inheritance boundaries |
| **TD2 — Tool Runtime** | **CORE IMPLEMENTATION CLOSED** | Ownership required for newly added consumers belongs with their module | Preserve disable/admission/worker contracts |
| **TD3 — Appearance / shared UI** | **SOURCE IMPLEMENTATION CLOSED (R30)** | The R29 finite shared action, CSS cascade and native QML source-contract inventory was dispositioned; no known outstanding required source owner in that bounded audit | Preserve changes; reopen for confirmed source defects only. Native/Qt/browser runtime certification is separate |
| **TD4 — Extension API Convergence** | **In progress: Library collection sharing wired** | Resource/search/action adapters, provider lifecycle, typed events, server-side selection | Continue required first-party adapters; avoid plugin marketplace scope |
| **TD5 — Reliability / Native Implementation** | Subsystems exist; incomplete | Actual native process/deployment hooks, diagnostic/telemetry ownership, background and job integrations not yet connected | Implement missing production code while TD6 workflows require it; defer environment acceptance |
| **TD6 — Feature Completion** | Major unfinished implementation | Required portions of **CD-01 through CD-20**, see current owner matrix below | Close coherent end-to-end user workflows; mark optional providers explicitly deferred |
| **TD7 — Cleanup & Freeze** | Not started | Dead shims, duplicated authority, unused CSS/routes, final developer manifests | Retire only after canonical replacement is source-complete |

### Quick passes: next connected implementation batches

1. **TD3 closed at source level:** retain native/action/CSS regression coverage and reopen only for demonstrated source defects. Windows/browser/Qt runtime acceptance stays in the release-certification roadmap.
2. **TD4 + TD6 convergence:** finish actual resource/action adapters used by Library, Forms and Projects workflows.
3. **TD5 + TD6 implementation batches:** native Packages/Transfers, collaboration, access lifecycle and committed features; TD5 is not a universal blocker.
4. **TD7 direct cleanup:** remove obsolete contracts/styles only after replacements are verified, then freeze source. Certification follows separately.

**CD-21 was the old certification-only completion item and is moved out of active TD6.** The historical CD-21 row below is retained for traceability but is **NOT** a TD6 implementation gate. CD-09 must be split: implement missing Git/UE/Discord integration code under TD5/TD6, but live two-workstation or Discord proof belongs to release certification. Likewise, native installer implementation in CD-08 stays mandatory where product scope requires it; Windows installer acceptance is separate. Every CD item must be marked required/core vs optional/provider extension before being treated as a v1 gate.

**Preservation baseline:** floating/docked sidebar and taskbar, animated search replacing only Project Tabs, My Work, Tickets and Transfer Center taskbar utilities, People user-color rings and independent presence dots, responsive layouts, Comfortaa and Appearance 3.2. Remove only duplicated *behavior*, not identities, details or user-visible features.

---

## Current implementation-only closeout (2026-10-13; overrides historical phase gates)

**User decision:** Stop mixing completed source work with future Windows/PostgreSQL/native acceptance tests. This roadmap closes implementation and concrete source bugs. Move environment/build/performance/soak/acceptance testing to `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`. Small unit/source/regression checks remain part of engineering, not a release gate or a reason to reopen a phase.

| Phase | Implementation disposition | Included contract | Excluded (not missing implementation) |
|---|---|---|---|
| **TD1 Settings Authority** | **IMPLEMENTATION CLOSED for defined 0.546 core scope** | Studio/Tool/People/Account/Server writer preconditions; six typed configurable Tool editors; field impacts, provenance, reset and locks; Studio→Project→User Calendar default inheritance; value-free process hints; automation Studio rules now require revision CAS including initial-create races | Arbitrary inheritance of security/permission/Tool enablement, speculative roaming Device settings, future setting domains; platform acceptance is on the separate certification roadmap |
| **TD2 Tool Runtime & Request Ownership** | **CORE IMPLEMENTATION CLOSED for the six Studio-configurable capabilities and registered durable job/event consumers** | Server route deny; owner timer/owned subscription suspend/resume; authoritative tool and contextual automation gates; durable pause/retry/claim/lease/recovery; Ticket direct activation guard and final Studio action-boundary gate; independent shared work remains alive | Irreversible external effects already committed before disable, instantaneous rollback, speculative plugin runtime, unregistered future tool workers; live measurements/certification are separate |
| **TD3 / TD4 / TD6** | **Continue actual implementation** | New user-facing UI, extensions, resource/actions and feature completion | No forced TD1/TD2 release-certification prerequisite |

**Scope boundaries are deliberate.** TD1 cannot truthfully promise generic inherited passwords or role/permission flags. TD2 cannot kill or reverse a DB/external action that already committed; it can deny new admissions and cooperate at safe checkpoints. New optional workers must register ownership. These are invariants, not excuses to restart the same phases endlessly.

**Handoff and evidence:** `TD1_TD2_IMPLEMENTATION_CLOSEOUT.md` and `tools/scripts/cluster-td1-td2-implementation-closeout-tests.mjs`. Earlier warnings to postpone TD3 until TD1/TD2 certification are **superseded** by the user's sequencing decision. Historical notes remain for traceability only.

---

## 0. Evidence rules and scope

This roadmap combines (A) directly observed v0.546 source facts, (B) unfinished work named in `FEATURE_PROGRESS_0540`–`0546`, older configuration handoffs and the user's preceding tech-debt/Appearance audits, and (C) external engineering research. **Do not promote historical planning to implemented code, or source-implemented behavior to runtime-certified behavior.**

- **CONFIRMED:** Exact issue or arrangement observed in the supplied source, with representative path.
- **GAP:** Coverage or certification not demonstrated by the available source/test evidence, not necessarily a production defect.
- **DESIGN:** Architectural improvement supported by experience/research, not proof of existing failure.
- **COMPLETION DEBT:** User-visible workflow previously committed to the v1 direction but incomplete or not yet integrated end-to-end. Missing work is not misrepresented as an existing defect.
- **CERTIFICATION DEBT:** Source-implemented behavior with an unproven production/runtime environment (e.g. PostgreSQL, Windows, Qt, Unreal, live Discord).
- **FUTURE OPTION:** Optional or post-v1 concept, explicitly outside mandatory technical-debt closeout until adopted as a release requirement.

**Ledger policy:** A v1-required unfinished workflow counts as completion/integration debt. An optional future feature is a separately labeled option, not invisible work or an automatic release gate. Dependencies determine sequencing; not every feature must wait for every framework milestone.

**Non-negotiable product constraints:** One compiled, first-party modular Cluster application; preserve the Web renderer / Qt-native chrome approach. No dynamically downloaded executable plugins, invented microservices or forced external cloud service. Auth/authorization, database, audit and configuration publication are core and cannot be disabled as tools. Zero deployed production installations presently require legacy application compatibility, so prefer retiring obsolete compatibility branches after safely converging on one canonical contract. Never strand durable jobs or expose private data while disabling a tool. Preserve Comfortaa as the default visual font and make mobile/native usability first class.

### Source checkpoints that must be preserved

- **v0.540 Library:** recursive Smart Collections and client-bounded multi-page selection exist; Collection sharing and true server-side select-all-matching remain open.
- **v0.541–0.543 Inventory:** assets, allocations, custody/returns, encrypted commercial key pools and user PIN-controlled reveal are source-implemented; vendor redemption, provider synchronization and actual DB/browser certification remain open.
- **v0.544 Forms:** authoring, publication, assignments/audiences, submission and admin review implemented in source; saved respondent drafts, due-date reminders and advanced conditional logic remain open.
- **v0.545 Inventory and Vault:** first-class, separate workspaces; do not move operational records back into Studio Settings. Delegated Vault permissions and provider synchronization remain future scope.
- **v0.546 Tools:** tool directory and compiled lazy-module registry for Inventory, Vault and Integrations; scaffold and checker; server/runtime modularity remains incomplete.
- **Prior v0.506 settings continuations:** selected-field writes, optimistic expected-value checking, configuration import preview, database/file publication locks, journal/recovery, explicit key rewrap and prior source tests exist. **Do not erase that work or claim it was never attempted**; current runtime verification is the gate.

## 1. Executive priority: what we actually fix first

| ID | Priority | Debt | Evidence/status | Exit condition |
|---|---|---|---|---|
| TD-00 | **P0** | Fix Appearance resolver failure and broken contrast choice | CONFIRMED `packages/renderer/src/core/visual-system.ts` | Resolver runs under actual test, contrast tests pass, browser startup works |
| TD-01 | **P0** | Canonical Tool IDs / disabled-tool policy across API | CONFIRMED `scheduler` vs `time` mismatch described and located in request-policy/disabled guard from prior source audit | Every registered route/operation classified; disabled means server-side deny or explicit safe read-only exception |
| TD-02 | **P0** | Tool lifecycle ownership | CONFIRMED partial frontend module registry; GAP runtime shutdown | Disabling optional tool drains its workers/listeners/polling and re-enabling resumes; zero unintended jobs, durable work not lost |
| TD-03 | **P0/P1** | Settings authority and writer safety | CONFIRMED duplicated schemas; patch calls without expected preconditions; GAP native DB-file certification | One effective setting contract, classified storage, conflict semantics and real crash/recovery tests |
| TD-04 | **P0/P1** | Route, resource and permission coverage | CONFIRMED manual route registration and classification; GAP whole-surface certification | CI coverage of owned endpoints, object/field checks, impersonation-safe access previews, dynamic revocation |
| TD-05 | **P1** | Appearance 3.1 canonical token pipeline | CONFIRMED split native/Web sources, misleading options/inheritance | Web/Qt semantic token parity, contrast/focus/motion tested, real preview |
| TD-06 | **P1** | Domain extension contracts | CONFIRMED special-case maps for integrations/search/widgets/events | Modules declare adapters; host does not need another provider/resource-specific switch |
| TD-07 | **P1** | Runtime observability/idle resource budgets | GAP measured performance; existing adaptive jobs/sync | Per-tool activity/queue/CPU/network metrics, disabled-state baseline, measured improvements |
| TD-08 | **P1/P2** | Shared commands, drafts, feedback, undo/conflicts | CONFIRMED narrow registry enrollment; some Board behavior local | Reuse canonical command/draft contracts in ≥2 full user workflows, no data-loss regressions |
| TD-09 (CERTIFICATION MOVED) | **P0 release gate** | Complete dependency-backed/native/PostgreSQL certification | GAP source-only checks | Clean reproducible build, real DB, Windows and browser/mobile/security/soak evidence |
| TD-10 | **P2** | Dead code, complexity, documentation and upgrade friction | DESIGN with confirmed historical duplication | Every obsolete bridge/map retired only after new contracts pass tests |

## 2. Critical Settings Framework Audit

### 2.1 What already exists, and why we must not bulldoze it

**CONFIRMED source:** `apps/server/src/app/server-services-settings-integrations.ts` implements a 5-second read cache, `mutateSettingsKeys`, `patchSettings`, expected-value compare-and-swap under `pg_advisory_xact_lock(506,1)` and server-config publication with two advisory locks, journal, persistent config replacement and database commit marker. `server-config-publication-journal.ts` implements journal logic. The frontend has separate Account, Studio and Server pages and distinct Tool Config. `tools/scripts/cluster-0506-*settings*` and `*config*` provide source/fault tests. Existing configuration files remain relevant to boot/runtime and should not indiscriminately be moved into an AppSetting table.

**Important quality assessment:** Existing durability and concurrency mechanisms are unusually serious for a small self-hosted product. The technical debt is fragmented *adoption*, definitions and unproven execution on real targets, not their absence.

### 2.2 Directly observed problem areas

| Finding | Source and certainty | Consequence / required fix |
|---|---|---|
| Tool-specific Zod schema and tool→settings key maps repeated across server and renderer | **CONFIRMED:** `apps/server/src/domains/admin/admin-tool-routes.ts` around lines 378–403; `packages/renderer/src/features/application/modules/tool-config-settings.ts` | A new field can be defined in one place and not another. Per-tool typed descriptor should own `schema`, `default`, `storageKey`, `scope`, `visibility`, `changeImpact`, `uiHints`. Renderer imports safe derived metadata, not private server policy. |
| Tool Config writer calls `patchSettings(patch)` without expected originals | **CONFIRMED:** `admin-tool-routes.ts:402` | Different-key changes avoid whole-snapshot clobbering, but simultaneous edits to same field can overwrite. Require base snapshot/revision and return a meaningful 409 field conflict. |
| People profile-field writer calls `patchSettings` without expected originals | **CONFIRMED:** `apps/server/src/domains/users/team-routes.ts:322` | Apply the same policy for shared studio-level field definitions. |
| Ordinary Studio Settings API already uses expected originals | **CONFIRMED:** `server-routes-configuration-integrations.ts` around 753–787 | Preserve as pattern; do not relabel all settings as lost-update-prone. |
| Full `saveSettings` remains a separate high-stakes path | **CONFIRMED:** `server-services-settings-integrations.ts` lines 384+, setup and certain protected writers | Treat first-run setup as special; audit all full-object callers and verify one safe journaled publication authority. Do not route boot secrets through general UI patch writer. |
| Scheduler tool mapping includes keys pointing at general Studio settings (`timezone`, `workingDaysCsv`, `workdayStart`, `workdayEnd`) | **CONFIRMED:** `admin-tool-routes.ts` mapping | Side effect from a tool page can update wider studio policy. Either deliberately present them as linked Studio defaults with clear ownership/provenance or give Scheduler a distinct, explicitly inherited override. |
| Account and Appearance preference lists partially drift | **CONFIRMED:** `application-foundation.tsx` around 153 and 1229; previous Appearance audit | `appearanceKeys` includes `accentColor`/`secondaryAccentColor` while `USER_PREFERENCE_SETTING_KEYS` excludes them. Use one canonical preference metadata source; validate studio palette vs user accent identity. |
| Settings pages are large integration surfaces | **CONFIRMED:** Studio `1,972` lines, Account `1,857`, Server Config `1,502` lines in this snapshot | Organize sections as bounded components with shared form state/draft lifecycle. File size is a maintenance signal, not a correctness bug. |
| Configuration caching and invalidation require multiclient proof | **CONFIRMED:** 5-second settings read cache; **GAP:** revocation/effective-setting latency measurement | Explicit version/epoch invalidation for critical policy changes, not blind polling. Permission changes need safe revocation semantics regardless of cached navigation. |
| Real PostgreSQL/NTFS crash recovery remains uncertified | **GAP:** source progress/handoffs specify mocks and temporary filesystem tests | Test kill points around journal write, rename, DB commit and cleanup on Windows + PostgreSQL. Fail closed on uncertain state, prove recoverability. |
| Fields are hand-maintained on Server Config UI | **CONFIRMED:** `ServerConfigPage.tsx` starts with `SERVER_CONFIG_FIELDS` descriptor array separate from server domain settings | Use schema-derived field identity and validation but retain curated UI layout, explanations and operator safety affordances. |

**Extra audit checks, not yet proven bugs:** Compare `SERVER_MANAGED_SETTING_KEYS` across renderer and request-domain; verify every configurable Tool field has exactly one valid stored-key mapping; scan feature code for silent fallback-to-default on protected decrypt/parse failure; trace existing credential masking in preview, audit, exports and API; verify malformed settings reject rather than silently coerce; confirm storage of device-specific preferences stays device-local. Run this as a CI inventory instead of filing fictional defects.

### 2.3 Target Settings Framework 2.0/3.0 contract

**One canonical `SettingDefinition` per setting.** Example schema shape, *illustrative not current implementation*:

```ts
interface SettingDefinition<T> {
  key: string;                 // stable canonical ID
  owner: "core" | "studio" | "tool" | "person" | "device";
  storage: "boot-file" | "db" | "secret-ref" | "user-profile" | "device-local";
  schema: Schema<T>;           // runtime validator with cross-field rules
  defaultValue: T;
  permittedScopes: readonly string[];
  requiredPermission: string; // evaluated on server, including resource/field scope
  sensitivity: "public" | "internal" | "secret";
  changeImpact: "live" | "reconfigure" | "drain" | "restart" | "migration";
  dependencies?: readonly string[];
  ui?: { label: string; help: string; group: string; order: number };
}
```

**Clearly separated authority planes:**

1. **Server Configuration:** boot/network, database, TLS, security limits, storage, backup, secrets references and worker budgets. Stored in protected boot config/file or appropriate secret store; privileged, may require restart and rollback. Some existing serverside settings may still be backed by DB when safe, but owner and atomicity must be explicit.
2. **Studio Settings:** organization defaults/policy, people schema, projects, security policy, shared workflows. DB-backed, transactional, audited.
3. **Tool Configuration:** enablement, tool behavior/defaults, resource budgets, integration requirements and tool-specific storage policy; never silently assumes ownership of Studio-wide fields.
4. **User / Account Preferences:** navigation, appearance, notifications, accessibility and personal views; no access-control authority.
5. **Device / Session Preferences:** desktop app chrome, OS notifications, window geometry, kiosk device mode and transient layout; deliberately scoped local/roaming.
6. **Secrets / Credential Vault:** secrets handled as references and provider-owned lifecycle, never reflected verbatim into generic settings exports or audit detail.

**Effective value model:** built-in default → Studio policy/default → Tool/project or resource context **only where explicitly declared** → user preference → device preference → accessibility/safety constraints. A Studio locked value must defeat downstream overrides. Not every setting permits every scope. Show value, owner, source, inherited/overridden/locked status, and a **Reset to inherited/default** control. Avoid forcing arbitrary project inheritance onto server settings.

**Write protocol:** validate input and cross-field dependencies → authorize actor/assurance level → capture expected original/revision → impact preview (downstream tools, restart/drain, settings changed) → transaction-safe apply/publication → audit field names/safe diffs → issue selective invalidation/config epoch → confirm applied versus pending restart → support rollback where safe. Sensitive changes (auth/TLS/ports/storage) need prevent-lockout safeguards, a rollback plan, and no secret echo.

**UI contract:** shared labels, help, inherited-source inspector, field errors, reset, searchable navigation, dirty-state/autosave drafts where safe, loading/pending/error states, explicit reconfigure/restore behavior, and impact preview. Generate *repetitive field bindings* from typed definitions; keep complex risk-sensitive settings panels intentionally custom. Avoid auto-generating an unsafe admin interface from arbitrary JSON Schema.

**Config bundle contract:** existing `.clusterconfig` reviewed import/export is a strictly limited non-secret allowlist, **not yet** general cross-instance synchronization. Expansion requires versioned manifest, imported-domain scoping, dry run, compatibility validation, dependency graph, field-level diff, conflict detection, schema migration policy and secret omission by default. The need for general bundles is product design; not a defect in the current intentionally narrow allowlist.

**Settings completion gate:** select two admins; edit same and independent fields across Studio / Tool / Server surfaces; prove preserved independent writes, 409 same-field conflict and readable merge/retry; test process kill points and saved defaults after restart; verify roles, security assurance, secret redaction and actual effective value for desktop/mobile; measure settings propagation across tabs and windows.

### 2.4 Standards and research behind this direction

- **Google SRE / Configuration Design:** explicit ownership, typed/structured configuration, versioning, safe gradual application, rollback and operator access preservation. https://sre.google/workbook/configuration-design/
- **Microsoft Options Pattern:** scoped strongly typed options, validation on startup, monitored updates/invalidation. Design pattern reference, *not* a suggestion to adopt ASP.NET. https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options?view=aspnetcore-10.0
- **Twelve-Factor App / Config:** separate deployment-specific config and credentials from code. Cluster's portable protected local config is valid for self-hosting; do **not** blindly force secrets into process environment variables if this makes Windows operations less safe. https://12factor.net/config
- **OWASP Secrets Management:** central secret lifecycle and scoped access, rotation, revocation and auditing. https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

## 3. Cross-framework debt, with clear ownership

| System | Source basis / gap | Framework work | Certification / stop condition |
|---|---|---|---|
| **Tool registration & runtime** | 3 standalone modules, 6 flag-backed tools, 22 tool permission identities; background jobs not universally tool-owned | Typed `ToolDefinition` with `required/optional dependencies`, `start/stop`, route owner, settings adapter, job/event ownership, health and UI loader | Disable, verify job/subscription cleanup + API deny; re-enable without replay/data loss; no core infrastructure switches |
| **HTTP routes & authorization** | 82 top-level route-registration calls; path/prefix classification; some shared routes need resource checks | Ownership metadata and build-time request-policy coverage; per-resource permission at operation boundary; avoid naive path-prefix-only access | Test deny-by-default for every HTTP/WebSocket/SSE/job/export/upload mutation and private projection |
| **Permissions & Access Explorer** | Central permission resolver exists; tool capability and resource scopes split | Evaluate effective permissions and provenance for person/team/role/project/tool; preview access as user *without impersonation*; support revocation, temporary scopes, bulk preview | Revoked account cannot use stale token/queue/prefetch/search index; field-level/private details never leak |
| **Background jobs, sync & offline** | Adaptive scheduler, durable queue, reconnect policies already present; no full per-tool ownership | Job manifest with owner, priority, idempotency, resource budget, retry, drain, suspension, health/metrics; multi-tab leader remains authoritative | Measure idle work/network before and after toggle, multi-window test, reconnect and durable replay invariants |
| **Appearance 3.1** | Resolver TDZ, simplistic contrast, missing functional `parentId` handling in resolver, Web/Qt native chrome style drift; old CSS selector coexistence | Fix execution bugs; single typed visual parameter/semantic token pipeline; preserve Comfortaa default; generate Web and Qt palettes; test OS accessibility | Runtime resolver and screenshots in light/dark/high contrast/reduced motion; Windows 100/125/150% DPI, mobile, keyboard/screen readers |
| **Resource/search/graph** | Resource manifest exists; kind-specific indexing, URI/projection and access branches | First-party `ResourceAdapter` for index, safe projections, address, backlinks, actions, exports and navigation; maintain specialized business rules | Non-admin cannot infer restricted resources from search/counts/backlinks; incremental index invalidation and stale-version tests |
| **Commands, drafts & Undo/Redo** | Shared command registry has narrow enrollment, Board unsaved undo and three-way merge local | Typed mutation contracts, revision/idempotency, intent→result, reusable draft/conflict and reversible-operation metadata; avoid fake universal undo | Duplicate-click and offline/retry tests; collaboration-safe undo; no undo for inherently irreversible effects |
| **Events/notifications/activity** | Typed durable registry has limited event declarations; notification inference uses text/regex fallback | Typed domain events, recipient/privacy projections, coalescing, unsubscribe ownership, audit vs human activity distinction | Correct recipient matrix; no duplicates after replay; private titles never leaked; disabled modules generate no spurious events |
| **Integrations** | Registry exists but branches on known provider IDs | Provider adapter supplies config/credential ref, validation, authorize action, connection lifecycle, health and retries; no arbitrary provider code loading | Disconnect and disable tear down work; secrets masked; failure isolation; Discord/source-control smoke tests |
| **Home/widgets** | Canonical widget IDs but model ~1,072 lines and manual provider/renderer associations | Each widget declares data provider, owner tool/capability, refresh/invalidation, offline/error/loading; no polling when not mounted/authorized | No idle refresh from disabled/unmounted widgets; performance and layout snapshot tests |
| **Forms/templates/lifecycle** | Forms implemented; separate domain-specific lifecycle state machines | Share validated template and revision/publishing primitives, audience/assignment/routing policies; leave domain-specific state semantics intact | Publish immutability, rollback/preview/permissions, draft recovery and response-version tests |
| **Import/export/analytics** | Partial shared data registries; per-domain custom adapters | Type-specific import mapping/dry-run/progress/rollback and export redaction/manifest; no common wildcard exposure | Audit and privacy classification; large selection streaming; bounded and interruptible operations |
| **Media/storage/transfer** | Library previews, derivatives, GPU encoding, native transfers are implemented in parts | Explicit media adapter capabilities, provenance, source vs derivative policy, owner jobs, concurrency budgets and output verification | Malformed input testing, source permissions, watermark policy, CPU fallback, cross-provider transfer recovery |
| **Desktop/Qt/Go/Windows host** | Shared renderer, Qt-native settings, separate native runtimes; real host not certified in source | Compatibility manifest, OS-operation supervisor, token parity for native chrome, process-tree lifecycle, launcher hardening | Real Windows shutdown leaves no orphan children; failure/upgrade/reconnect/permissions matrix |
| **Build/test/release** | Source syntax and targeted scripts pass; dependency-backed and runtime gates open | Hermetic pinned toolchain, generated Prisma, full TS/C++/Go build, PostgreSQL and migration automation, E2E/accessibility/soak | No version marked certified without reproducible evidence and artifact hashes |

**Module contract example, not an implementation directive:** `ToolDefinition` should register server capability, UI entry, config, route ownership, jobs, resource/search adapters and tests. Runtime `enable/disable` must be a supervised lifecycle transition. The manifest itself must never become a privileged bypass: server route handlers still perform context and object authorization.

## 4. Critical Appearance backlog carried into this roadmap

These are **confirmed in supplied source / preceding audit**, and **not fixed by this planning document**:

1. `resolveVisualContext()` constructs `instance` while calling `backgroundPatternFromInput(instance)` in its initializer (temporal-dead-zone ReferenceError). Fix to use the correct uninitialized-input source, then test legacy fallback and actual startup.
2. `themeContrastColor()` uses an approximate luminance threshold rather than comparing actual WCAG contrast ratios, allowing default white-on-blue text too low for ordinary text. Derive semantic on-accent colors from tested candidate contrasts.
3. `VisualInstanceLayer.parentId` is declared but the shown resolver merges direct overrides rather than actually resolving a parent graph. Either implement explicit bounded inheritance or simplify the contract to its actual capabilities.
4. Comfortaa/Inter appearance choices have an unresolved mapping; preserve Comfortaa default and ensure distinct options really differ.
5. Account appearance selection maps settings differently from canonical visual resolver; define distinction between studio colors and individual accent/preferences.
6. Qt-native `Theme.qml` owns different manual tokens; generate native palette from the shared semantic token source, not another native/Web UI rewrite.
7. Root CSS, architecture CSS and feature-level selectors coexist; enforce a cascade/layering/ownership audit with representative screenshot diffs. UI complexity is real but raw color-literal counts aren't a severity score.
8. Accessibility constraints and user-visible descriptions about motion/contrast must agree. Stop relying on body-wide mutation observation as the primary correctness mechanism for accessible primitives.

Research: DTCG **2025.10** stable Community Group format (not a W3C Recommendation), WCAG 2.2, Fluent semantic token layering and Qt Quick styles. https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/ ; https://www.w3.org/WAI/WCAG22/Understanding/ ; https://fluent2.microsoft.design/design-tokens ; https://doc.qt.io/qt-6/qtquickcontrols-configuration.html .

## 5. Future-proofing / engineering standards adopted

**A. Stability > maximal abstraction.** Consolidate only true shared mechanisms. A shared permission evaluator, config publication protocol or job scheduler is high leverage; generic CRUD for unique game-production workflows is not. Keep domain semantics with the domain.

**B. Explicit authorization at the resource boundary.** OWASP recommends deny-by-default and checking access for every request; API object/field-level authorization must not depend on a hidden UI button. https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html ; https://api-security.owasp.org/editions/2023/en/0x11-t10/

**C. Module boundaries and ownership.** Borrow Backstage's principles of typed extension points and service contracts, *not* its third-party plugin deployment architecture. Each Cluster module declares what it owns and how it extends approved hosts; domain reach-through imports are flagged selectively. https://backstage.io/docs/backend-system/architecture/index/

**D. Safe changes and rollbacks.** Google SRE emphasizes gradual changes, safety checks and rollback for configuration. Cluster is currently a self-hosted studio rather than a global fleet: staging, preview, apply, health-check and safe restart/rollback are more relevant than an elaborate fleet canary platform. https://sre.google/workbook/configuration-design/ ; https://sre.google/workbook/canarying-releases/

**E. Feature flags are not lifecycle controls.** OpenFeature supplies a useful separation between flag evaluation and consuming systems. Cluster needs *additional* active owner services to drain work and revoke access; a flag false alone cannot do that. An external flag SaaS is unnecessary. https://github.com/open-feature/spec

**F. Release metrics and evidence.** Record latency, traffic, errors and saturation, with per-tool idle CPU/network/job metrics and reliable correlation IDs. Track change failure and rollback evidence rather than counting files changed. https://sre.google/sre-book/monitoring-distributed-systems/

**G. UI accessibility and diagnostics.** WCAG 2.2 guidance for labels, error identification/suggestion, focus, pointer targets and stable help positioning informs our Settings/Appearance contracts. Automated checks require manual keyboard/screen-reader verification, not the other way around. https://www.w3.org/WAI/WCAG22/Understanding/

**H. Secrets stay secrets.** Support scoped secret references, masking, rotation, audit, disaster recovery. Do not export credentials in ordinary `.clusterconfig`, log decrypted values or let selected import fields extend to sensitive settings by mistake. https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

## 6. Delivery plan: connected work packages, not WIP spam

These are **sequenced milestones**, not estimates or promises of implementation. **TD6 is part of this roadmap, not an off-ledger feature wishlist; implementation completion items CD-01–CD-20 below are tracked with dependencies, backend/UI/test gates and source evidence.**

| Sequence | Bundle | Content | Dependency | Objective evidence |
|---|---|---|---|---|
| **TD0** | Immediate correctness hotfixes | Appearance resolver, contrast; tool-ID consistency; source regression cases for confirmed defects | None | Repro fails on baseline, passes with fixes; browser bootstrap; route deny tests |
| **TD1** | Settings Authority (**closed**) | Defined core settings authority, revision CAS, field provenance and scoped inheritance | TD0 | Source contract regressions; environment proof in separate certification roadmap |
| **TD2** | Tool Runtime & Request Ownership (**closed core**) | Canonical six-tool runtime and registered worker/event owner contracts | TD0 and TD1 config authority | Source contract regressions; live counters in release roadmap |
| **TD3** | Appearance 3.2 & UI contract | Complete remaining actual action/visual/native parity source gaps, preserve branded details | TD0/TD1 | Focused source and interaction regression tests; runtime DPI is separate |
| **TD4** | Extension API Convergence | Resource/search/action adapters, provider lifecycle, typed event registry, widgets and shared command scopes | TD2 | Add sample first-party tool/resource through a bounded descriptor, with no manual core switches |
| **TD5** | Reliability & Native Runtime | Implement missing telemetry, native lifecycle and background runtime code | Related TD4/TD6 features | Source-level executable assertions and defined owner contracts; actual environment/soak proof separate |
| **TD6** | Completion / integration debt closeout | Close **CD-01–CD-20** required source slices and explicitly defer optional extensions | Existing owners as needed; no blanket TD5 hold | Required code paths, integrated UI, focused regressions and source evidence; release runtime acceptance separate |
| **TD7** | Remove fossils & freeze | Delete obsolete aliases/duplicated mappings, obsolete CSS selectors, dead compatibility branches; publish developer guide/config manifest | After source-complete replacement | Source diff, manifest and development regression evidence; certification separately |

### Engineering checks for development packages (not release certification)

- **Correctness:** Run the checks supported by the provided source/dependency environment and report exact results; do not claim complete compilation from parser-only evidence. Full target release build is separately gated.
- **Safety:** Unauthorized user/object/field denial, secrets redacted, modification audited, no stale-permission projection after revocation, retry/idempotency and negative-path tests.
- **Lifecycle:** Start/stop/drain/cancel behavior, preservation of durable queued work, correct re-enable behavior and dependencies; no phantom success on disabled services.
- **Reliability:** Implement error/retry/idempotency ownership and test at source/component level. Target-environment crash injection and native process stop belong to release certification.
- **Performance:** Before/after measurements under the **same** number of users, tabs, enabled tools and machine specs; CPU, database queries, request cadence, heap, disk activity and worker count. Define regression budgets from baseline, not arbitrary invented improvements.
- **UX:** Tooltips/disabled reasons, editable fields and generated settings navigation, permission/access inspector, keyboard/focus, accessible errors and device layouts.
- **Product ledger:** Major Systems + Small Wins + Cleanup + Certification, each entry tracked `Planned → Backend Ready → UI Ready → Integrated → Tested → Certified`.

## 7. Unified technical + completion debt ledger

**Decision adopted 2026-10-10:** Unfinished work that is necessary to deliver the intended Cluster 1.0 is tracked here as **completion/integration debt**, together with framework and operational debt. It does not have to be a bug to be a liability. Conversely, a genuinely new, optional feature is **not** a release blocker just because it was discussed in a prior conversation.

- `FD`: framework/structural debt; underlying reusable infrastructure.
- `CD`: incomplete or insufficiently integrated **committed workflow**; overlap with framework debt is recorded rather than creating duplicate implementations.
- `RV`: runtime verification/certification debt (not proof the current feature fails).
- `UX`: interaction and visual consistency debt.
- `OPT`: future enhancements on hold until explicitly committed to v1.

**Status vocabulary:** `Proposed`, `Partial source`, `Source implemented / unverified`, `Integrated & tested`, `Runtime certified`, `Deferred by decision`. These states are evidence-based and cannot be inferred from a green parse or AST test. A released work item also records `Backend`, `UI`, `Integration`, `Security`, `Runtime`, `Documentation` and `Owner` separately. **Priority meaning:** `P0` correctness/security or a hard release gate; `P1` high-leverage core workflow/reliability; `P2` important polish or scope-controllable completion; `OPT` not mandatory.

### 7.1 Canonical framework debt register

| ID | Priority | Framework / owner | Exact debt to close | Dependents & evidence gate |
|---|---|---|---|---|
| **FD-01** | P0 | **Tool Runtime / Tool Infrastructure** | One canonical ID, module dependency graph, actual enable/disable lifecycle, route ownership, tool-owned timers/jobs/SSE/subscriptions/prefetch; no disabled-owned work | TD0→TD2; disable/off boot/mid-job/re-enable tests; CPU/network/job telemetry |
| **FD-02** | P0 | **Settings Authority** | Single typed definition per setting, scope/owner, storage classification, effective-value provenance, linked Studio vs Tool keys, expected revision for every shared writer; safe crash publication | TD1; 2-admin same/different-field tests, PostgreSQL/NTFS kill matrix |
| **FD-03** | P0 | **Effective Authorization & Access Explorer** | Consistent tool availability vs permission, resource/field scopes, inverse lookup, access simulation, bulk impact preview, revocation propagation | TD2; HTTP/SSE/job/search/export/desktop adversarial matrix |
| **FD-04** | P0/P1 | **API/Domain composition** | Replace unrelated manual route ownership/classification edits with typed registration and coverage checks; retain Fastify handlers and direct server enforcement | TD2/TD4; every optional-domain endpoint classified; unknown endpoints fail CI |
| **FD-05** | P1 | **Appearance 3.1 / UI primitives** | Fix resolver/contrast bugs, actual visual inheritance or remove phantom promise, one semantic token output for Web + native chrome, shared state/keyboard/focus handling, retire selector fossils | TD0/TD3; contrast + reduced-motion + 100/125/150% DPI and mobile screenshots |
| **FD-06** | P1 | **Resource Graph / Search / Pickers** | Typed resource adapters own address/index/projection/actions/links/exports/references; shared permission-safe discovery and stale-index invalidation | TD4; unauthorized object titles/counts/paths never leak |
| **FD-07** | P1 | **Shared Commands / Mutation / Undo & Drafts** | Idempotent intent, pending/error, per-domain reversible operations, persisted history where safe, draft autosave/conflict model; migrate real workflows | TD4+CD-03; duplicate-create, offline replay and collaboration conflict tests |
| **FD-08** | P1 | **Events / Notifications / Activity & Audit** | Typed domain events, recipient projection, grouping/rate limits and reliable idempotency; remove brittle text-parsing classifications; keep activity vs security audit distinct | TD4; no replay duplicates, privacy leaks or ghost notifications from disabled tools |
| **FD-09** | P1 | **Integration Provider Runtime** | Provider-owned config/credential references, setup, health, pollers, webhook dispatch, retry, teardown and diagnostics; remove provider-name branches from shared host | TD4+CD-09; revoke/disable/failure isolation, Discord/Git provider smoke tests |
| **FD-10** | P1 | **Widgets / Home / Navigation** | Widget-owned data/refetch/event subscriptions/permissions and view lifecycle; coherent taskbar/session tabs, no polling from hidden/unmounted widgets | TD4; unmount/disable leaves no queries/listeners; multiwindow restore and UX tests |
| **FD-11** | P1 | **Scheduler / Sync / Cache / GPU & Background** | Owner-tagged durable jobs, backpressure, retries, leases, queue draining, server-state and compatibility gate, cache invalidation/epochs, resource budgets | TD2/TD5; contention, idle metrics, failure/restart and multi-tab tests |
| **FD-12** | P1 | **Transfer / Storage / Media adapters** | Shared queue/progress/resume/cancel, verified bytes and permissions, derivative provenance, CPU/GPU capability fallback, upload/download/native ownership | TD4/TD5+CD-02/CD-07/CD-08; corruption/interrupted transfer/security matrix |
| **FD-13** | P1 | **Templates / Forms / Lifecycle / Publishing** | Reuse versions, drafts, validation, approval, audience, audit and transition primitives where semantics match; no fake universal CRUD state machine | TD4+CD-01/CD-04/CD-07; protected publication + revision tests |
| **FD-14** | P1 | **Server / Native / Packaging & Upgrade** | One supervised host/process tree, version/capability negotiation, safe deployment/updater, logging, portable runtime/Git/LFS verification, native Chrome parity | TD5+CD-08/CD-09; real Windows + PostgreSQL + Qt/Go/e2e |
| **FD-15** | P1 | **Build / Test / Diagnostics** | Reproducible installed-dependency build, generated Prisma, fault injection, permission probes, performance baselines, release manifest hashes, correlate incidents | TD5/TD7; evidence-linked release gates, no inflated completion claims |
| **FD-16** | P2 | **Developer Experience / Controlled Extension** | Complete `tool:new` and `tool:check`, import-boundary checks, source ownership maps, reviewable adapters; retire central switches only after migration | TD2/TD4/TD7; add then remove sample first-party tool without unrelated changes |
| **FD-17** | P2 | **Shared UX micro-behaviors** | Context/action menus, one global Create flow, searchable resource selection, selection/bulk impact preview, consistent disabled/error/loading/focus state | TD3/TD4; keyboard and rapid-click stress tests |
| **FD-18** | P2 | **Operations / Observability** | Tool health/diagnostics panels, per-tool activity, log volume and correlation IDs, server-status explanation, safe support bundles, admin views | TD5; useful incident repro without revealing secrets or requiring manual log excavation |

**Evidence preserved:** v0.546's 3 migrated standalone renderer modules are a real first step, not comprehensive server modules; 6 backed enabled flags vs 22 tool permission identities demand explicit classification, not a blind flag for every identity. The 82 top-level route-registration calls and 145 cross-domain import occurrences are review inventories, **not** automatically defective lines. The existing adaptive background scheduler, identity/permissions core, settings journal, visual tokens and resource manifests remain the base to converge.

**Active source checkpoint (2026-10-17, TD6 F04):** F04 extends F03 with source-implemented persistent, author-scoped Whiteboard saved-element Undo/Redo via bounded before/after metadata, authenticated history routes, atomic canonical operation-sequence replay and target conflict/compaction/revision checks. The existing local draft Undo and collaborative operations remain. Create/delete/settings/snapshot and oversized rich media are excluded; CD-03 remains in progress and full release certification remains deferred. See `IMPLEMENTATION_ROADMAP_TD6_F04.md` and `TD6_F04_SOURCE_IMPLEMENTATION.md`. The next development priority is CD-07 protected Packet PDF/image/media derivatives, NOT renewed TD5 runtime-environment testing.

**Active source checkpoint (2026-10-17, TD6 F03):** F03 extends F02 with persistence-safe Card metadata Undo/Redo in CD-03. Successful Card PATCH commits and its immutable edit history are atomic; saved history requires current authorization, actor identity and exact Card revision to reverse only the latest uninterrupted operation. The Board editor provides separate **saved** and **draft** Undo/Redo. Oversized metadata saves become explicit non-reversible history barriers. This is **not a universal Undo implementation**: Whiteboard inverses, Card moves/deletion/checklists and broader collaboration/reviews remain incomplete. See `TD6_F03_SAVED_CARD_HISTORY_IMPLEMENTATION.md` and `IMPLEMENTATION_ROADMAP_TD6_F03.md`. Keep implementation-first sequencing; full platform/release certification remains deferred.

**Active source checkpoint (2026-10-17, TD6 F02):** User-directed implementation-first execution supersedes earlier TD5-first and historical TD3-resumption sequencing. Forms CD-01 now includes authenticated server drafts (prior), conditional visibility/hidden-answer enforcement (F01), versioned deadlines with opt-in reminders, durable delivery attempts, current-audience/access rechecks, member deadline views, and admin aggregates (F02). These changes do **not** certify runtime delivery, multi-user testing or release readiness; the CD-01 UX/live integration review remains open. The other CD items below retain their unfinished source scope. Refer to `IMPLEMENTATION_ROADMAP_TD6_F02.md` for next actions.

### 7.2 Committed workflow completion debt (active TD6: CD-01–CD-20; historical CD-21 excluded)

| ID | Priority | Workspace / actual source state | Required completion work | Framework dependency and acceptance |
|---|---|---|---|---|
| **CD-01** | P1 | **Forms:** publish/assign/submit/review implemented in source (`FEATURE_PROGRESS_0544`) | Server-saved respondent drafts/recovery, assignment due dates and reminders, advanced conditional branching where v1-required; finish live editor/responder UX | FD-02,07,11,13. Two-device draft recovery, versioned submission, per-recipient authorization and scheduled reminder tests |
| **CD-02** | P1 | **Library:** recursive Smart Collections, cursor pagination and bounded selection in source (`0539`–`0540`) | Collection sharing with roles/audiences, genuine server-side select-all-matching bulk jobs; finish explorer/records/versions and shared transfer/media paths | FD-03,06,12. Large selections, privacy boundaries, permission changes, browser/DB test |
| **CD-03** | P1 | **Boards / Whiteboards / Work:** local unsaved Card Undo/Redo, Board Card three-way conflict handling (`0534`–`0536`) | Persistence-safe collaboration history and scoped Undo/Redo after saved edits, broader merge/review/approval, Whiteboard realtime lifecycle as appropriate | FD-07,08,11. Two-editor conflict + offline/reconnect, no editing someone else's action by mistake |
| **CD-04** | P1 | **People / HR / Admin:** application conversion, atomicity, review/offboarding source flows (`0537`–`0538`) | Close account lifecycle/access expiries/delegation, recovery and onboarding/offboarding journeys, approval/status evidence, admin UX | FD-02,03,08,13. Multi-user lifecycle test including revoked sessions and no retained privilege |
| **CD-05** | P1/P2 | **Inventory:** assets, custody, commercial keys, personal resources implemented in source (`0541`–`0545`) | Team-scoped management, supplier/license contracts, seat/entitlement reconciliation, provider redemption/synchronization; distinguish v1 essential from later providers | FD-03,06,09,13. Contract/entitlement lifecycle and key-reveal audit/expiry tests |
| **CD-06** | P1/P2 | **Vault:** standalone admin-only operational tool, controlled reveal/rotate/revoke (`0545`) | Delegated scoped Vault roles, secret-use automation/rotation policy as approved; keep encrypted secrets out of generic settings | FD-02,03,09. Least-privilege reveal/use vs admin boundaries, redaction and rotation tests |
| **CD-07** | P1 | **Packets / distribution:** text, images and some PDF derivatives implemented in source (`0521`–`0522`) | Original PDF, audio/video secure derivatives and watermarking where required; author/source vs recipient/derived rights; verify decoder and downloads | FD-03,08,12,13. Published immutable manifest, malformed media isolation, actual recipients and file-hash checks |
| **CD-08** | **P1 native implementation** | **Desktop managed Packages:** signed content staging and managed-copy/rollback audit implemented (`0524`–`0525`) | Trusted native installation/update/rollback for authorized destinations, activation-time authority, receipts/health attestation, policy-controlled unattended updates and delta optimization | FD-09,11,12,14,15. Fresh Windows real installer/repair/rollback/compromise test; no attestation claims from untrusted device self-report |
| **CD-09** | **P1 integration code; external proof separately** | **Desktop Git / Unreal / Discord:** protocol and source-level integration contracts exist (`V1_INTEGRATION_FOUNDATION`) | UE 5.8 compile and two-workstation LFS lock/commit/sync; private Git/LFS on clean Windows; live Discord guild/linking/channel/revocation/delivery proof | FD-03,09,14,15. Real external-system evidence rather than mocked unit tests |
| **CD-10** | P1 | **Projects 2.0:** visual/polish roadmap and partial shell/Project work (`V1_VISUAL_LIBRARY_PROJECTS_POLISH_PLAN`) | Finish coherent overview/identity/lifecycle/plan/team/tools/integrations/governance, external-safe names/aliases, closeout and readiness checks | FD-03,06,10,13. Real project user journeys, scoped permissions and external-safe projections |
| **CD-11** | P1/P2 | **Calendar / Scheduler:** shared events and visibility work implemented in earlier continuation; broader Calendar layers remain planned | Verify canonical private/studio/project visibility, timezone/recurrence/reminder semantics, overlays and meeting decisions/actions as v1-scoped | FD-01,03,08,11,13. DST/timezone cases and A/B/C/admin privacy matrix |
| **CD-12** | P1 | **UI shell / Appearance:** shell/Library polish partly source-implemented (`V1_VISUAL_LIBRARY_PROJECTS_POLISH_PLAN`) | Finish Sidebar/Taskbar, shared primitives, dropdown/menu/modal/inspector clipping, visual tokens, Windows DPI/mobile/accessibility | FD-05,10,17. App-wide screenshots and keyboard/nav verification |
| **CD-13** | P1 | **Transfer Center / Uploads / Downloads:** partial native and Library transfer infrastructure, completeness not established | One durable transfer centre, queue/resume/retry/cancel, checksum/status, taskbar and library projections, authorization and background control | FD-11,12,14. Network drop and multi-window recovery; no false progress or silent partial files |
| **CD-14** | P1/P2 | **Shared navigation / Search / Actions:** registries and picker infrastructure exist, adoption uneven | Consistent command palette, search drawer, backlinks, quick previews, bulk action picker, `Copy Link/Path/ID`, Ctrl/middle click, recently used values | FD-06,07,10,17. One action/permission definition serves menu, search, inspector and bulk UI |
| **CD-15** | P1 | **Setup, Settings and recovery UX:** Guided/Quick/Import/Skip + narrow `.clusterconfig` allowlist source-implemented (`VERSION_0506_ROADMAP`) | Broader safe nonsecret config bundle/import-diff/revisions, setup checklist, safe account recovery/backup paths, clear inherited setting explanation | FD-02,03,13,15. Fresh first-run + recovery on real PostgreSQL/Windows; no exported secrets |
| **CD-16** | P1/P2 | **Notifications / Communications:** existing Inbox, announcements and automation pieces | Close per-tool preferences, grouping, quiet-hours and delivery safety; remove text inference, consistent deep links, notifications vs actions vs system alerts | FD-08,09,11. Deduplicated replay, permission-safe links, meaningful muted/severity behavior |
| **CD-17** | P1/P2 | **Admin / Operations workspaces:** partial server health, approvals, reports and tool directory | Operator-grade status, evidence, diagnostics, actionable workspaces, permissions access explorer and tool resource usage | FD-03,10,15,18. Admin can find cause, affected tools, safe action and audit trail |
| **CD-18** | P1/P2 | **Builds / QA / work pipelines:** core workspaces exist; full cross-domain workflow parity not re-certified | Type-aware Git/UE builds, status branches, QA triage and project context; only fill proven gaps after source/user-journey audit | FD-03,06,09,11. Build provenance and direct Project/QA/Ticket navigation with correct access |
| **CD-19** | P1/P2 | **User-facing interaction consistency:** earlier UX ledger promises are broader than demonstrated current integration | Rapid-click protection, true Create-and-open, saved/unsaved indicators, reusable feedback, help/empty states and permission denied-with-reason across priority tools | FD-07,13,17. Micro-behavior suite under latency, failed saves, offline and 125% DPI |
| **CD-20** | P1 | **Data/Privacy, Backup, Retention:** existing access, Library policies, audit and config recovery, unproven complete operational matrix | Cross-tool archive/retention/legal hold and distribution boundaries; backup/restore, privacy exports, secure logs, migration/rollback evidence | FD-02,03,06,11,14,15. Restore and revocation matrix with no private source leaks |
| **CD-21 (MOVED OUT; HISTORICAL ONLY)** | **Not a TD6 implementation item** | **Release & Certification:** structural/source tests present, full runtime unproven (`CLUSTER_0546_VALIDATION_RESULTS`) | Installed dependency build and Prisma generation, fresh PostgreSQL, Windows native lifecycle/Qt, multi-user browser, mobile/DPI, external integrations, perf/security soak | FD-15. Reproducible artifacts with hashes, incident/negative-path evidence and explicit gate signoff |

**Scope integrity:** These are tracked as debt because Cluster 1.0 would otherwise carry partially completed workflows, inconsistent shared behaviors or unverified product claims. **This table is not a claim that all rows are entirely unimplemented.** Distinguish currently source-ready components from the missing slice in the third and fourth columns. Some broad initiatives require a bounded v1 decision before becoming release-blocking; use explicit `Deferred by decision`, not quiet omission.

### 7.3 Interaction, usability and small-wins backlog: no silent disappearance

Treat these as **cross-cutting UX debt candidates** linked to FD-05/07/10/17 and relevant CDs, and elevate to v1 commitments only when a representative workflow fails the usability gate. Consolidate shared behavior instead of inserting isolated buttons.

| Cluster interaction contract | Concrete capabilities to track | Initial acceptance target |
|---|---|---|
| **Actions / menus** | Shared right-click/ellipsis/inspector/command-palette actions; copy object link/path/ID; duplicate/move-to/add-to; consistent archive and restoration | Same action/capability/permission resolver in at least two tool families |
| **Create / feedback** | Context-aware Global Create, `Create & Open`, explicit `Create Another`, once-only mutations, busy/progress/error/success states | Double-click during latency creates exactly one resource; navigate to result |
| **View and selection** | Saved smart filters, multiselection/range/select-all-matching, bulk preview, grouping/columns, per-location UI state, recently used picks | Library + one other work tool demonstrate shared rules |
| **Navigation** | Tabs, back/forward, reopen closed tab, multiwindow recovery, middle/Ctrl-click, breadcrumbs and sibling menu, Home continue-work | Session restore and feature-disabled tab handling are tested |
| **Drafts / conflict** | Dirty state, autosave, revision conflicts, collaboration-safe undo/redo, crash recovery, safe cancel, review-before-discard | Forms + Board or Settings adopt shared contract |
| **Help and failure behavior** | Contextual `?`, tooltips where necessary, meaningful empty states, user-preview explanations, readable disabled reasons, troubleshooting and diagnostic link | No infinite spinner/opaque 500 for sampled flows |
| **Preferences / accessibility** | Reset to Studio default, Comfortaa, density, high contrast, motion, keyboard/focus, saved inspectors/columns, mobile | Browser/Qt/mobile contrast/layout/accessibility sample matrix |
| **Transfers / files** | Paste/drag/drop attach, quick previews, progress, background completion notices, pause/resume where safe, native Desktop integration | Large upload, disconnect/reconnect and source-permission checks |

**Keep an explicit Small Wins Ledger** with a stable ID, owner, affected tool, associated FD/CD, Backend/UI/Integrated/Tested/Certified checkboxes, and an opt-out/defer reason. Small improvements should not crowd out P0 release gates.

### 7.4 Future options intentionally not renamed as v1 defects

These concepts remain **OPT** until separately committed: public third-party plugin ecosystem, a standalone generic wiki separate from Packets, full cloud multi-tenant service architecture, wholesale microservice decomposition, universal dynamic no-code workflow builder, unlimited cross-product inheritance, speculative ML-based UI automation, provider integrations without a real user case, and v1.1-scale collaboration enhancements unrelated to a currently broken workflow. Preserve previously discussed product directions without forcing them into immediate technical-debt scope.

### 7.5 Source traceability and work-item closure contract

Each FD/CD/RV/UX item must cite at least one of: current v0.546 source path, bundled `source/FEATURE_PROGRESS_xxxx.md`, continuity/design file inside `Cluster-v0.546(1).zip`, prior named audit report, or a repeatable reproduction. Specific source anchors include:

- **v0.546** `source/FEATURE_PROGRESS_0546.md`, tool registry/scaffold/checker and route manifest.
- **v0.545** `source/FEATURE_PROGRESS_0545.md`, Inventory/Vault workspaces, scope and authorization caveats.
- **v0.544** `source/FEATURE_PROGRESS_0544.md`, Forms completion with deferred drafts/reminders/branching.
- **v0.540** `source/FEATURE_PROGRESS_0540.md`, Library Collection sharing and server-wide selection gaps.
- **v0.534–0.538** source progress files, Board/Work and People/Admin source milestones.
- **v0.521–0.525** source progress files, Packet derivatives and managed-content native trust boundary.
- `source/V1_VISUAL_LIBRARY_PROJECTS_POLISH_PLAN.md` and `source/V1_INTEGRATION_FOUNDATION.md`: bounded v1 UX/Library/Projects and Windows/Git/UE/Discord gates.
- Supporting external audit files: `Cluster-v0.546-Tool-Modularity-Runtime-Permissions-Audit-Plan.md`, `Cluster-v0.546-Infrastructure-Framework-Audit-and-Unfinished-Roadmap.md`, and `Cluster-v0.546-Appearance-and-Framework-Health-Review.md`.

At the end of **each** implementation package, update the ledger's state and evidence in the same commit/package. An item is not closed merely because its helper API exists: complete the intended user path, server authorization, side-effect/runtime lifecycle, meaningful negative tests, integration, documentation and, for release claims, actual platform certification. Deferred items stay visible with rationale and target release. Do not claim benchmark wins without before/after measurements.

## 8. Acceptance examples that make this a real roadmap

- **Tool-off test:** Disable Packets. It disappears from allowed navigation, its writes return controlled `tool_disabled` response, its optional background subscriptions/jobs stop, in-flight publishing is safely completed or made resumable, Library continues, and re-enabling Packets restores normal operation without data loss. Same matrix repeated for Calendar/Scheduler/Library with dependency impact preview.
- **Two-admin Settings test:** Admin A edits Scheduler notice window, Admin B edits Library preview limit: both persist. If both edit the same field, B gets a field-level conflict and readable current/proposed diff. A tool setting that shares the Studio timezone shows that connection before apply.
- **Crash journal test:** Terminate Windows server at each config publication checkpoint; restart under real PostgreSQL and NTFS; either recover committed value or restore prior value with audit/recovery evidence. No uncertainty silently published as healthy.
- **Permission test:** Remove a member's Library access during active search, file preview, upload and offline queued mutation. Authorization on every operation, resource and export is reevaluated. History/search/UI cannot leak title/path of now-inaccessible items.
- **Appearance test:** Changing font/density/accent/contrast in Account Settings updates actual effective visual tokens, survives login/restart where intended, respects Studio lock and OS accessibility, and matches native Qt chrome where applicable.
- **Framework extensibility test:** Scaffold a temporary first-party `example-tool`, register its route, config, job, resource, search, widget and permissions through declarations; confirm CI detects missing mandatory ownership and runtime disable stops its work; then remove it cleanly without changing unrelated global switch statements.

## 9. Open decisions, resolved defaults

- **No new separate settings database/service.** Keep existing Postgres `AppSetting` + protected boot config and improve authority, validation, publication and provenance.
- **No arbitrary runtime plugins.** Module contracts describe compiled-in features, not a marketplace or dynamic privilege escalation.
- **One effective access engine** and several enforcement points: UI previews are informative, server is authoritative.
- **No universal data model for all resources.** Standard adapters wrap domain-specific logic.
- **No global defaults overriding accessibility requirements.** Define and test policy for explicit motion opt-ins; actual visual semantics must agree with Settings descriptions.
- **Source-ready is not certified.** The real Windows/Postgres/Qt/device test matrix is mandatory before final release declaration.

## 10. Research bibliography (official/primary sources)

1. Google SRE, *Configuration Design and Best Practices*: https://sre.google/workbook/configuration-design/
2. Google SRE, *Canarying Releases*: https://sre.google/workbook/canarying-releases/
3. Google SRE, *Monitoring Distributed Systems*: https://sre.google/sre-book/monitoring-distributed-systems/
4. OWASP, *Authorization Cheat Sheet*: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
5. OWASP, *API Security Top 10: 2023*: https://api-security.owasp.org/editions/2023/en/0x11-t10/
6. OWASP, *Secrets Management Cheat Sheet*: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
7. Backstage, *Backend System Architecture*: https://backstage.io/docs/backend-system/architecture/index/
8. Microsoft, *Options Pattern* (architecture analogy): https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options?view=aspnetcore-10.0
9. Twelve-Factor App, *Configuration*: https://12factor.net/config
10. OpenFeature, *Specification*: https://github.com/open-feature/spec
11. W3C Design Tokens Community Group, *Format Module 2025.10*: https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/
12. W3C WAI, *WCAG 2.2 Understanding*: https://www.w3.org/WAI/WCAG22/Understanding/
13. Microsoft Fluent 2, *Design Tokens*: https://fluent2.microsoft.design/design-tokens
14. Qt, *Qt Quick Controls Configuration*: https://doc.qt.io/qt-6/qtquickcontrols-configuration.html

**Source inputs:** `Cluster-v0.546(1).zip`, `FEATURE_PROGRESS_0540`–`0546`, `VERSION_0506_*HANDOFF.md`, prior `Cluster-v0.546-Tool-Modularity-Runtime-Permissions-Audit-Plan.md`, `Cluster-v0.546-Infrastructure-Framework-Audit-and-Unfinished-Roadmap.md`, `Cluster-v0.546-Appearance-and-Framework-Health-Review.md`, and past conversation roadmap context.

**Final note:** No Cluster source files were changed in preparing this roadmap. Prioritize confirmed runtime defects and security/config correctness before opportunistic abstraction. Consolidate only with verified, reusable contracts and migration tests; then complete the outstanding workflows and certify the real application.


## 11. Additional research cross-check (2026-10-10)

The sources below inform the **design direction**, not claims that Cluster already implements their practices. Framework borrowing must remain proportional to the small self-hosted first-party application.

| Reference | Verified guidance | Cluster decision / what *not* to conflate |
|---|---|---|
| [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Deny by default and validate permissions on every request | Tool navigation/feature flags are *not* an authorization boundary; include resource and field scope on all pathways. |
| [OpenFeature flag evaluation and provider lifecycle](https://openfeature.dev/specification/sections/flag-evaluation/) | Evaluation APIs have provider state and lifecycle; status/error semantics are explicit | Borrow clear status/invalidations. **Cluster's studio-wide tool disable is stronger than a feature flag:** its runtime-owned jobs and subscriptions must actually stop. No need to adopt an external flag system. |
| [OpenFeature hooks](https://openfeature.dev/specification/sections/hooks/) | Structured before/after/error/finally hooks with defined order | Inspires bounded lifecycle and diagnostics interceptors, not arbitrary extensibility scripts. |
| [Design Tokens Format Module 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) | Stable Community Group interchange format and typed design tokens | One canonical semantic token source for CSS and Qt; **not** a W3C Recommendation or a mandate to reproduce all token tooling. |
| [Google SRE configuration design](https://sre.google/workbook/configuration-design/) | Make configuration changes attributable, validated, observable and reversible where practical | Converge onto the existing Cluster publication journal, conflict handling and safe boot config rather than building a parallel Settings backend. |

## 12. Rollup definition of done and ordering guardrails

**A release closure must contain: (1)** fixed code or explicit scoped deferral; **(2)** tests that exercise the original defect/unfinished path; **(3)** no authorization/data-loss regressions; **(4)** dependency-backed build evidence; **(5)** runtime/platform evidence where that item claims runtime support; **(6)** updated canonical ledger with source path and package/revision ID.

**Blocking order:** TD0 correctness first. TD1 and TD2 overlap on configuration and availability policies. TD3/TD4 should adopt a small number of representative tools before a bulk migration. TD5 runtime testing begins early, with final certification after the v1 workflow scope is complete. TD6 user-workflow slices may proceed as soon as their relevant shared contract is stable. TD7 retirement only follows verified replacements.

**Do not substitute:** a screenshot for API security evidence; TypeScript parsing for executable compilation; a device self-report for native attestations; a concealed navigation entry for disabling compute; an elegant descriptor for fully functioning code; a preproduction roadmap discussion for a release requirement. The world has enough of those substitutions.

**Source artifact policy:** `Cluster-v0.546(1).zip` remains untouched by this planning revision. This is the master **planning** artifact; it must be updated again when source implementation or certification changes its status.


## 13. Implementation ledger update: TD0 Pass 1 (2026-10-11)

**Base:** Cluster 0.546.0 source. **Product semver unchanged:** this is an uncertified TD0 source checkpoint.

| Item | Status | Evidence |
|---|---|---|
| TD-00 Appearance resolver initialization | **Source patched / targeted tested** | `visual-system.ts` uses `settings` rather than uninitialized `instance`; executable test covers empty and legacy/canonical inputs. |
| TD-00 Accent text contrast | **Source patched / targeted tested** | WCAG relative-luminance contrast ratios compare light/dark candidates, and default blue chooses dark text. |
| TD-00 Operating-system reduced motion floor | **Source patched / targeted tested** | Explicit Full cannot override OS reduced-motion; None remains stronger. |
| TD-05 Inter font selector (small corrective subset) | **Source patched / contract tested** | `typography-contract.css` has distinct Inter stack; visual rendering remains uncertified. |
| TD-01 Configurable tool availability IDs | **Source patched / targeted tested** | Central map of six studio-controlled switches; Scheduler `scheduler` is used by central middleware. |
| TD-02 Runtime lifecycle / optional workers | **Open** | No worker ownership or real start/stop implementation in this pass. Disabled request paths are gated, but no idle CPU reduction is certified. |
| TD-03 Settings concurrency, inheritance, authority | **Open** | Existing CAS machinery preserved; adoption by Tool/People writers remains incomplete. |
| TD-09 Runtime/build certification | **Open** | No Node 24/React/Prisma/PostgreSQL/native Windows environment, no browser screenshot certification. |

**Regression executed:** New TD0 test, source registry tests, inherited visual/shell assertions, Studio conflict assertions, Inventory/Vault and Forms source checks. AST and import source scan excludes historical `recovered/` sources and expected generated Prisma output.

**Next implementation:** TD1 write contract for Tool Config and People shared Settings with expected per-field originals and conflict-safe UI; TD2 tool-owned worker registration and measurable disable/re-enable behavior. Keep disabled-state API enforcement while draining/pausing jobs in a controlled fashion.


## 14. TD1 Pass 1: Settings Authority implementation (2026-10-11)

**Source checkpoint:** `Cluster-v0.546.0-TD1-Pass1-Source.zip`; product version remains 0.546.0. Inherits TD0 Pass 1.

- **Source patched, targeted tested:** canonical six-tool config-to-Studio-storage mapping shared across the renderer and server; removed one duplicate mapper.
- **Source patched, targeted tested:** Tool Config saves only edited fields with database-truth `exists/value` preconditions. Same-field administrator collision returns 409; unrelated settings survive. Unversioned tool writers are rejected.
- **Source patched, targeted tested:** Tool snapshot effective values reconcile against persisted field baselines; UI keeps edits when a conflict occurs and does not discard unsaved fields on quick availability toggles.
- **Source patched, targeted tested:** People profile-field writer requires an expected baseline; GET for People managers exposes an authorized, uncached editing snapshot.
- **Source patched:** Library sensitive offline-cache Tool Configuration setting is no longer stripped by the server schema.
- **Regression evidence:** TD1 9/9, TD0 9/9, prior CAS 11/11, config writer 23/23. 991 active TS/TSX files parsed with zero syntax errors; zero unresolved relative imports (except expected absent generated Prisma artifact).
- **TD1 still open:** one owner/scope/inheritance-aware setting descriptor and validation registry; all writer inventory; application impact previews; selective cache epoch; owner display and reset/override UX; actual PostgreSQL + Windows crash/DB-file/reload certification.
- **TD2 still open:** tool-owned workers/listeners with real stop, pause/drain and restart semantics.

See `TD1_PASS1_IMPLEMENTATION.md` and `TD1_PASS1_VALIDATION.md`. This is **not** release-certified and does not change native binaries or database schema.

## 15. TD1 Pass 2 / TD2-owned scheduler foundation (2026-10-11)

**Source checkpoint:** `Cluster-v0.546.0-TD1-Pass2-TD2-Foundation-Source.zip`. Maintains the TD1 Pass 1 foundation and product version 0.546.0.

- **TD1 — partial progress:** declared the Studio-owned storage fields exposed in Tool Configuration and surfaced their cross-tool impacts to the editor. No scope rewrite or inheritance engine claimed.
- **TD2 — first runnable owner slice:** owner-aware background timer suspension/resumption, per-task `owner`/`suspended` diagnostics, exact-generation registration safety, Calendar automation scan enqueue owner, settings-driven local runtime updates, startup state reconciliation, and skip of already queued Calendar scans when disabled.
- **Regressions:** targeted real-timer owner suite, TD1, TD0, Tool Registry, config-writer, and settings-conflict checks pass. Full TS/TSX parser validation has zero syntax failures. Source-level checks are not production certification.
- **TD2 remains open:** event subscriptions, live streams, other tool-owned jobs and handlers, multi-process availability propagation, in-flight drain/cancel semantics, job queues, Client preload/prefetch, and measured idle resource consumption.

See `TD1_PASS2_TD2_FOUNDATION_IMPLEMENTATION.md` and `TD1_PASS2_TD2_FOUNDATION_VALIDATION.md` for scope and constraints.


## 16. TD2 Pass 2 — Durable job pause and multi-switch propagation (2026-10-11)

**Source checkpoint:** `Cluster-v0.546.0-TD2-Pass2-Durable-Ownership-Source.zip`. Maintains TD0, TD1 Passes 1–2 and TD2 foundation; product version still **0.546.0**.

- **Now source-implemented:** all six configurable Studio tool flags propagate to local owner availability on boot, on Settings commit and protected Settings publication; changed status re-enables dormant timers without needless rearming.
- **Calendar durable jobs:** SQL claim excludes `automation.calendar-scan` while disabled. A claim-race or handler-entry-race defers the job using lease-fenced queue changes and refunds attempts, rather than marking skipped work completed. Re-enabling wakes the worker.
- **Eventual multi-process fallback:** a periodic fresh-database availability reconciliation runs every 60 seconds (plus scheduling delay). This is not instantaneous distributed job fencing or universal cross-node revocation.
- **Verification:** new durable owner test suite 9/9; inherited TD1P2 8/8, TD1 9/9, TD0 9/9, tool registry 9/9, Settings writer 23/23 and Settings conflict 11/11. Active TS/TSX parses cleanly; no full dependency-backed typecheck/DB/Windows proof.
- **Still open:** full owned-job inventory, cross-process synchronous fencing, cancellation/drain for in-flight jobs, listener/webhook/SSE shutdown, frontend prefetch suspension, tool-owned measurements and native/PostgreSQL certification. `TD2_PASS2_DURABLE_RUNTIME_IMPLEMENTATION.md` and `TD2_PASS2_DURABLE_RUNTIME_VALIDATION.md` record details.

**Do not mark TD2 complete.** This is a durable queue and Settings availability integration slice, not whole-tool shutdown certification.

## 17. TD1/TD2 Pass 3 — close unfinished Settings and scheduler work (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-TD2-Pass3-Source.zip` (same product version; no migration/native rebuild). Continues TD2 Pass 2, not a separate framework.

| Debt item | Result | Evidence | Remains |
|---|---|---|---|
| TD1 Tool Config shared Studio settings | **Source-implemented, targeted tested:** before/after values with explicit admin acknowledgement; server rejects direct API changes that omit acknowledgement and returns affected keys | `CLUSTER_LINKED_STUDIO_TOOL_FIELDS`, `clusterToolStudioChangeImpact`, `admin-tool-routes.ts`, `AdminToolControls.tsx`, new closeout test | True inheritance/provenance/typed setting schema, real multi-admin PostgreSQL/browser validation |
| TD2 owned timers | **Source-implemented, targeted tested:** active interval/adaptive callbacks get `AbortSignal`; suspend/stop/stopAll abort; re-enable avoids duplicate adaptive wake and restores interval timer | `background-tasks.ts`; new race tests | Other owned listeners, worker subscriptions, long-running handlers, distributed fencing |
| TD2 Calendar timer | **Source-implemented, targeted tested:** check abort and owner before enqueue | `server-job-runtime.ts`; new wiring check | Already executing durable scan transaction cancellation; end-to-end DB/Windows proof |
| TD5 release certification | **Open:** static/source validation only | `TD1_TD2_PASS3_VALIDATION.md` | Full Node 24 dependency-backed build, PostgreSQL multi-process, Windows/Qt/browser, measured CPU/requests |

**Remaining priorities:** Before TD3 or new features, complete a verifiable ownership inventory and safe suspend/restart for existing genuinely tool-owned background work; finish TD1 setting definitions and provenance before starting broad UI redesign. Do not mislabel cooperative abort as a hard kill of in-flight external/DB work.

## 18. TD2 Pass 4 — Library durable work ownership (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass4-Library-Durable-Ownership-Source.zip` (continues TD1/TD2 Pass 3, product version unchanged).

| Existing debt | Progress | Evidence / limit |
|---|---|---|
| TD2 durable owner policy | **Source implemented / targeted tested:** owner registry for Calendar scan, Library transfer finalization, Library derivative generation | `job-tool-ownership.ts`; do not infer other work from type prefixes |
| TD2 tool disable | **Source implemented / targeted tested:** disabled Library jobs excluded at SQL-claim input and deferred when disabled during claim or async authorization | `server-job-runtime.ts`, `job-worker.ts`, executable seven-case suite; DB execution remains untested |
| TD2 operational visibility | **Source implemented:** paused type lists exposed by worker and runtime snapshots | No UI certification or production CPU measurement |
| TD1 configuration authority | **Preserved, still open:** canonical typed Settings inheritance and effective provenance | Previous CAS and Studio acknowledgement work remains intact |
| TD2 in-flight shutdown | **Open:** executing Library jobs drain, but are not forcibly cancelled | Avoid tearing down file/database commits; certify long-running uploads and TTL |
| TD2 multi-process | **Open:** eventual reconciliation, not immediate distributed job fence | Needs PostgreSQL and 2-process test |
| TD5 certification | **Open:** no complete Node 24 build, PostgreSQL or Windows/Qt runtime proof | Static scan and executable mock-queue tests only |

**Regression:** seven new Library owner checks plus inherited TD0/TD1/TD2/Settings/Tool Registry tests. See `TD2_PASS4_LIBRARY_VALIDATION.md`. **Next:** finish truly tool-owned subscriptions and remaining Settings definition/provenance debt before new frameworks.

## 20. TD2 Pass 5 — Owned subscription lifecycle and Library cache safety (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass5-Owned-Subscriptions-Source.zip`; inherits TD2 Pass 4 without a database migration or native binary change. TD2 remains **partially complete**.

- **Implemented/tested:** BackgroundTaskRegistry now owns disposable event listeners as well as timers, including suspend/resume, stop/unregister, failure visibility, and bounded retries on ordinary Settings reconciliation. Existing healthy listeners and timers are not restarted by repeated no-op reconciliations.
- **Implemented/tested:** Library's cross-process `library.context.invalidate` listener suspends with the Library tool and reconnects on enable. Its per-user context and tree caches are invalidated at lifecycle boundaries to avoid showing stale projections after missed events.
- **Diagnostics:** Admin health/status payloads list active/suspended owned listeners, separate from background timer state.
- **Shared system safety:** General storage lifecycle, upload staging retention, security audit, and unrelated maintenance remain independent of Library's tool availability.
- **Evidence:** `TD2_PASS5_OWNED_SUBSCRIPTIONS.md`, `TD2_PASS5_VALIDATION.md`, new `techdebt:td2:subscriptions` suite 7/7, inherited checks 92/92. Active TS/TSX parser zero errors.
- **Still open:** wider owned listener/workers inventory; active-transfer draining; long-disable staging retention tests; immediate cross-process change publication; full Settings inheritance/provenance; typechecked Node 24/PostgreSQL/Windows runtime certification. No idle CPU reduction is asserted absent measurements.

**Ordering:** keep closing TD1/TD2 gaps with real consumer migrations and tests before starting new framework initiatives.

## 21. TD2 Pass 6 — Paused Library Transfer Upload Retention (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass6-Upload-Retention-Source.zip`. Inherits Pass 5, same product version; no migration or native binary changes.

- **Fixed in source / targeted tested:** `pruneExpiredUploads()` preserves expired completed local/direct staged uploads referenced by `QUEUED` or `RUNNING` Library transfer-finalization jobs. Background job status and indexed dedupe identity determine retention, not unreliable payload parsing.
- **Safe cleanup:** unrelated expired sessions still expire, even beyond long runs of held uploads; deletion is bounded and job-reference lookup failure blocks deletion. Terminal jobs release holds.
- **Regression evidence:** nine new tests; inherited TD0/TD1/TD2, configuration and module registries continue passing. `TD2_PASS6_VALIDATION.md` and `TD2_PASS6_UPLOAD_RETENTION.md` give precise scope and limitations.
- **TD2 still open:** atomic enqueue/prune fencing under multiple PostgreSQL processes, monitoring/expiration for indefinitely held uploads, other owned workers and event consumers, immediate distributed tool-state publication, and measured idle workload savings.
- **TD1 still open:** canonical typed Settings definitions, inheritance and provenance, effective-setting propagation, and live persistence/rollback certification.

Do **not** claim complete disabled-tool shutdown or production-grade upload-retention correctness based solely on mocked persistence tests. Complete the existing TD1/TD2 work before beginning TD3.

## 22. TD1 Pass 3 — Tool Config setting provenance (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass3-Setting-Provenance-Source.zip`, based directly on TD2 Pass 6, same product version and unchanged native binaries/database schema.

- **TD1 implemented, targeted tested:** Tool Config GET/PUT now includes per-field `stored` versus `resolved` setting-source metadata derived from the same database truth preconditions already used for safe writes. Persisted keys and Studio/Tool ownership are explicit; null values remain distinct from missing rows.
- **TD1 UI:** Admin Tool Config exposes a collapsible setting-source inspector and accurately marks Studio policy and resolved defaults. The original Studio change acknowledgment and conflict-safe saves remain intact.
- **Verification:** six new focused cases plus inherited TD0–TD2, Settings conflict and configuration writer tests; tool registry checker and TS/static relative-import scanner pass (generated Prisma artifact absent). See `TD1_PASS3_SETTING_PROVENANCE.md` and `TD1_PASS3_VALIDATION.md`.
- **No inheritance claims:** The source marker `resolved` is a fallback when an AppSetting row is absent, not a Project/User inherited override or user-preference precedence. Stored null may still normalize through existing defaults.
- **Still open TD1:** typed setting definitions/validation authority, scoped inheritance and effective-value precedence, setting reset semantics, change notification propagation, PostgreSQL/Windows certification.
- **Still open TD2:** other tool-owned workloads, storage retention fencing across processes, availability propagation guarantees and actual idle resource measurements.

Keep TD1 and TD2 **open**. Do not start TD3/TD4 while these partially implemented systems remain unfinished.

## 23. TD1 Pass 4 — Tool Config typed definitions and projection convergence (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass4-Tool-Config-Definitions-Source.zip`. Continues TD1 Pass 3 on top of TD2 Pass 6 without migration or native binary modification.

- **Implemented and regression-tested:** All 87 configurable controls across Timeline, Tickets, Calendar, Scheduler, Library and Packets now expose a canonical, dependency-free type/constraint definition. The existing canonical persisted keys and Studio ownership remain authoritative.
- **Server:** Builds Tool Config Zod validators from the shared contract once per route registration, retaining full input validation, edited-key CAS and Studio-wide acknowledgement requirements. Removes the separate six hard-coded server schemas.
- **Renderer:** Uses the same shared default projection as the server and the same numeric range constraints for all 21 numeric fields, without bundling Zod into the client contract.
- **Testing:** A focused executable suite checks exact key coverage, default validity, numeric and enum boundaries, existing fallback semantics, server/renderer adoption and no new stored setting aliases. Inherited TD0/TD1/TD2 tests remain open certification evidence, not production readiness.
- **TD1 remaining:** Full Settings registry beyond the six Tool Config editors; scope-specific inheritance and override resets, effective-value propagation/invalidation and runtime certification under real PostgreSQL.
- **TD2 remaining:** Owned lifecycle enrollment outside Calendar/Library, cross-process availability fencing, paused-job monitoring and measured idle resource savings.
- **TD5 gate:** Full dependency-backed Node 24 build, PostgreSQL and Windows/Qt/browser runtime tests still required.

## 24. TD1 Pass 5 — Safe saved-value reset at existing Tool Config scope (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass5-Atomic-Setting-Reset-Source.zip`, based directly on TD1 Pass 4. No native or migration changes.

- **TD1 implemented / targeted tested:** Tool Config can remove an explicit database-backed setting using a server-side CAS reset, under the existing advisory lock and transaction, instead of permanently writing a copied default value. Deleted keys return to their resolved defaults; `null` is handled as a stored value.
- **Security and cross-tool impact:** Reset endpoint only permits canonical fields of the six configurable tools; requires an administrator and exact saved-value precondition. Studio-owned settings require server-enforced impact acknowledgement, and stale values return a 409 conflict without erasing another admin's write.
- **UI:** Source inspector offers reset for explicitly saved values, confirms operation, retains unrelated drafts, refreshes provenance and notifies existing tool-setting listeners. Deleted keys are stripped from stale cached snapshot inputs.
- **Regression evidence:** Executable reset suite plus inherited TD0/TD1/TD2 and Settings conflict suites, tool registry and static TS parse. See `TD1_PASS5_VALIDATION.md`. Tests use a transactional mock and route harness; **no live PostgreSQL/Fastify certification**.
- **TD1 remains open:** Full scoped Project/User inheritance, locked overrides, general Settings registry outside the six Tool Config editors, immediate distributed propagation, practical two-admin PostgreSQL/browser tests and release certification.
- **TD2 remains open:** remaining runtime-owned listeners/workers, distributed job fencing and verified resource savings.

**Next:** Finish scope and authority design for the settings that genuinely need Project/User overrides, then implement real storage/permissions/resolution with a complete test matrix. Do not claim the current Studio-scope reset equals multi-scope inheritance.

## 25. TD1 Pass 6 — Cross-process Studio Settings change hints (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass6-Distributed-Settings-Source.zip`, based directly on TD1 Pass 5; no migration or native executable change.

- **TD1 source-implemented, targeted tested:** Studio Settings writes now publish a value-free change hint to the existing Cluster coordination bus, and each remote server process re-reads authoritative DB Settings and reconciles tool availability promptly. Multiple hints during a read are coalesced; reads are applied in order; remote refresh failures do not spin or fail the original committed write. Shutdown prevents late application.
- **Fallback preserved:** 60-second authoritative DB reconciliation remains in place for dropped notifications and server restarts. No guarantee of instantaneous distributed revocation/fencing is claimed.
- **TD1 data correctness:** Fixed Scheduler zero-day `editWindowDays`/`lockAfterDays` resolution to preserve valid explicit zero values rather than replace with defaults.
- **Evidence:** `TD1_PASS6_DISTRIBUTED_SETTINGS_PROPAGATION.md`, `TD1_PASS6_VALIDATION.md`, new 10-case `techdebt:td1:distributed` suite, 129 inherited assertions and nine tool-registry checks; source parsing and archive integrity verified.
- **Still open:** Actual project/user/device inheritance (persisted and permission-scoped), locked override policies, complete Settings registry, real PostgreSQL two-process propagation/permission-revocation and Node 24/Windows certification. TD2 tool-owned runtime enrollment and atomic durable job fencing remain open.

**Next:** Choose a genuinely per-Project/User setting subset, define authority/lock semantics and implement real scoped persistence and consumer behavior end-to-end. Avoid inventing inheritance that the UI cannot apply. Continue extending TD2 runtime ownership of optional work and measuring savings, without starting TD3 prematurely.

## 26. TD1 Pass 7 — First real Project-scoped setting consumer (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass7-Project-Calendar-Inheritance-Source.zip`; parent TD1 Pass 6, product version unchanged.

**Delivered in source:** Database-backed Project override for `calendar.defaultView` only, with composite identity, FK cascade, revision-checked writes and resets, provenance (`studio`/`project`), admin Tool Config editor and authenticated Calendar consumer. Unlike the earlier provenance display, this is an actual inheritance layer with a concrete UI behavior. A missing Project record inherits the current Studio Calendar default; a reset deletes the override rather than pinning a value.

**Boundaries:** Admin-only writes, authorized Project read, no permissions or tool-availability override, no User/device scope or policy locks. Requires new Prisma migration; it has not been applied against live PostgreSQL here. Cross-process propagation of new Project overrides to already-open client views is not immediate; Calendar refetches on entry and Project-context change.

**Evidence:** `TD1_PASS7_PROJECT_CALENDAR_INHERITANCE.md`, `TD1_PASS7_VALIDATION.md`, new focused test suite plus inherited TD0–TD2 suites and source scan. Full Node 24, live PostgreSQL with concurrent admins, Windows/Qt/browser visual tests and CPU/requests benchmarking remain open.

**Next:** Complete scoped User settings and explicit parent-lock semantics for a separately reviewed small allowlist, rather than exposing arbitrary Tool Config settings; close TD2 distributed worker fencing and remaining owner lifecycle enrollment. Do not start TD3 before evaluating the remaining half-implemented foundations.

## 27. TD1 Pass 8 — User Calendar preference inheritance (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass8-User-Calendar-Inheritance-Source.zip`; direct parent TD1 Pass 7. No new schema migration or native modification.

- **Source implemented:** Effective Calendar view now resolves `User (explicit) > permitted Project override > Studio default`; the personal preference uses the existing `User.preferences` storage. The API authenticates and checks Project access before returning the effective preference, preserving the older Project revision/provenance contract.
- **Account Settings:** The new Navigation choice supports personal default views or **Follow Project / Studio**; reset removes the preference key entirely. Account's previous fallback Week value no longer gets persisted as an accidental personal override when saving unrelated preferences. Concurrent preference saves use an optimistic JSON-string predicate to reject stale writes (409) instead of silently overwriting another session.
- **Calendar consumer:** Reads effective defaults on entry/context switch and after acknowledged personal preference changes in the same renderer. Ad-hoc manually selected Calendar views remain usable. Offline queued writes do not prematurely trigger authoritative re-read.
- **Evidence:** `TD1_PASS8_USER_CALENDAR_INHERITANCE.md`, `TD1_PASS8_VALIDATION.md`, 12 new executable tests, inherited TD0–TD2 suites, parser/static scanner and source-package integrity verification.
- **TD1 not closed:** General typed Settings registry outside current Tool Config, parent-lock policies, device scope if needed, reviewed broader field enrollment, and live Project migration/PostgreSQL/Windows certification. No inference that security or enablement flags can inherit.
- **TD2 not closed:** Distributed worker fencing, remaining owner subscriptions/workers and resource-use measurements.

**Next:** Complete the narrow remaining TD1 inheritance policy and real multi-admin integration tests, then finish TD2 active-work ownership and distributed queue fencing. Do not promote source tests to production certification.

## 28. TD1 Pass 9 — Project Calendar parent-default lock (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass9-Project-Calendar-Parent-Lock-Source.zip`, directly based on TD1 Pass 8. No new tool or general-purpose Settings framework.

- **Source implemented:** The actual Project `calendar.defaultView` override can now explicitly lock the inherited *default-view precedence* against personal Calendar preferences (`lockUserOverride: boolean`, false by default). Locked Project value takes priority; without a lock, the existing User → Project → Studio order is unchanged. Manual in-session view switching remains possible. Tool availability and access-control authority are unaffected.
- **Persistence:** New additive Prisma migration adds the boolean policy field to the existing Project override table. View + lock are stored together and guarded by the existing optimistic revision; reset removes both together. New API writes require an explicit lock choice. Old rows are unlocked by default.
- **UI:** Admin Tool Config exposes lock alongside Project default-view settings, shows an accurate explanation, and preserves the chosen lock in edits. The inherited Settings-source explanation now recognizes the User Calendar override from Pass 8.
- **Tests:** Ten new runtime-harness assertions and extended inherited Project route checks; 15 inherited TD0–TD2 regression commands, tool registry, syntax audit and isolated strict shared-contract typecheck passed. See `TD1_PASS9_PROJECT_CALENDAR_PARENT_LOCK.md` and `TD1_PASS9_VALIDATION.md`.
- **Still open TD1:** Other reviewed non-security fields, a general Settings contract beyond six Tool Config editors, device scope only if a real use case requires it, and PostgreSQL/Node 24/Windows certification. Project changes do not instantly push into already-open Calendar pages; they apply at effective-view fetch time.
- **Still open TD2:** Broader owned worker/listener enrollment, distributed fencing/atomic retention safety and resource-use measurements. TD3 and TD4 are not started.

**Next:** Stop expanding policy layers by speculation. Validate real PostgreSQL migration/Project lock CAS with multiple administrators, then close TD2's remaining execution lifecycle gaps and measured idle costs. Source-level tests are not release certification.


## 29. TD2 Pass 7 — Authoritative tool-owned durable job execution gate (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass7-Authoritative-Execution-Gate-Source.zip`, based directly on TD1 Pass 9. Does not start TD3 or add a new framework.

- **Confirmed gap:** Queue claim exclusion and pre-handler disable protection used per-process tool availability. Other processes could commit a disable before local coordination/reconciliation applied it.
- **Source implementation:** `DurableJobWorker` now supports an optional async execution gate. Server runtime wires the pre-handler gate to forced authoritative Studio Settings reads **only for explicitly enrolled Calendar/Library durable jobs**, using the existing job ownership and tool availability registries. In a stale-process scenario the job is deferred through the existing lease-fenced, retry-preserving path rather than misreported as successful. A failed Settings read fails closed for owned jobs.
- **Coverage:** Calendar scans, Library transfer-finalization and Library derivative-generation. No availability checks added to core retention, notification, audit, backup or unrelated maintenance jobs. Existing in-flight Library transfer completion policy preserved.
- **Evidence:** Nine new focused tests verify worker execution, stale-local state, healthy re-enable, authorization-order behavior, canonical runtime wiring, failed authoritative reads, and unaffected shared jobs. All inherited TD0–TD2 test scripts and tool registry checks passed; see `TD2_PASS7_VALIDATION.md`.
- **Limits:** This guards the execution boundary but does not atomically fence arbitrary handler side effects against a disable committed *after* verification. Full live PostgreSQL two-process certification, cross-process lease fencing, Node 24 build, CPU/network measurements, and remaining owner registration are still open. TD1 inheritance still only covers approved Calendar view settings.

**Next:** Live multi-process PostgreSQL integration tests and explicit in-flight side-effect fences where safe, then finish TD2 remaining owner registrations; postpone TD3 until TD1/TD2 closeout is genuinely proven.

## 30. TD2 Pass 8 — In-flight optional job checkpoints (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass8-InFlight-Availability-Source.zip`, direct parent TD2 Pass 7.

- **Confirmed gap:** The previous authoritative Settings check occurred only before a job handler began. A remote disable occurring mid-handler could leave additional independent derivative work running.
- **Source implementation:** Existing durable worker context exposes `throwIfToolUnavailable()` to recheck local and authoritative owner availability at retry-safe boundaries, reporting unavailable owners through the preexisting lease/retry-preserving deferral path. No new service or database schema.
- **Enrolled consumers:** Library transfer finalization checks *before* its storage commit region and deliberately completes that region if a disable occurs later. Library derivatives check between units and before record publication, and propagate control-flow deferrals without writing false failure results. Calendar retains its existing pre-handler guard; shared maintenance is unaffected.
- **Evidence:** Eight new executable harness assertions; all prior TD0–TD2 scripts, tool registry and static source checks pass. See `TD2_PASS8_INFLIGHT_AVAILABILITY.md` and `TD2_PASS8_VALIDATION.md`.
- **Limitations:** Safe-boundary checks are cooperative; they do not atomically fence a PostgreSQL transaction against a concurrent disable, kill an in-progress FFmpeg task, or prove exactly-once transfer side effects. Actual PostgreSQL multi-process tests, Node 24/Windows runtime, idle-resource measurements and remaining owner enrollment are still open. TD1 wider inheritance/certification remains open.

**Next:** Integration-certify durable execution against PostgreSQL and complete the remaining TD1/TD2 functionality before TD3.


## 31. TD2 Pass 9 — Unique claim lease fencing (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass9-Claim-Lease-Fencing-Source.zip`, parent TD2 Pass 8.

- **CONFIRMED gap:** A process-wide `leaseOwner` value permitted an older execution to match a new claim belonging to the same worker. Mutations did not consistently require a valid, unexpired lease; numerical attempts alone are insufficient because deferral restores the attempt counter.
- **Source implementation:** Generate a unique per-claim ownership token, retain process identity separately in attempt history, fence renewal/progress/deferral/success/failure on token + attempt + live lease, and verify the claim at safe in-flight availability checkpoints. Rejecting a stale completion no longer increments successful-job metrics.
- **Evidence:** 9 new tests for SQL contract and worker behavior; all 21 available technical-debt/tool-registry validation commands pass. See `TD2_PASS9_CLAIM_LEASE_FENCING.md` and `TD2_PASS9_VALIDATION.md`.
- **Limits:** Test harness uses a controlled database mock, not real PostgreSQL. This does not provide transactional exclusion between an arbitrary external side effect and a concurrent tool disable. TD1 broader scope certification; TD2 remaining workers/listeners, data-store fencing, actual multi-process tests and idle CPU/network measurement remain open.

**Next:** Live PostgreSQL two-worker reclaim and disable-race tests, full Node 24 compilation with generated Prisma and Windows smoke testing; then finish owner enrollment before considering TD2 complete.

## 33. TD1 Pass 10 — Settings writer read-version closeout candidate (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass10-Account-Writer-Closeout-Source.zip`, based directly on TD2 Pass 9; product version unchanged.

- **Fixed real stale-tab issue:** Account Settings used a fresh-transaction CAS, which did not reject saves based on an older *page-load* read. `GET /api/me/preferences` now provides an opaque DB-truth fingerprint, and full-form PATCH submits the originally loaded fingerprint. The server returns 409 for intervening updates, even when there is no race in the PATCH transaction; committed responses advance the version. Focused 8-case suite exercises stale read, live concurrency, accent-only conflict, reset and draft behavior.
- **Settings writer review:** Explicit test inventory catches newly introduced unreviewed Studio Settings writers. Existing per-field Tool/Studio/People preconditions, advisory-locked configuration import, crash journal and optional single-field preference PATCH remain intact. Six writer-guardrail tests.
- **Inheritance scope:** Calendar's Studio -> Project -> User default is complete in source with Project lock and reset. No generic inheritance of permissions, tool enablement, or security settings. Additional non-security settings require individual justification and tests; speculative Device-wide inheritance is excluded from TD1 mandatory scope.
- **Evidence:** `TD1_PASS10_SOURCE_CLOSEOUT.md`, targeted executable suites, inherited TD0–TD2 regression runs and verified source manifest/patch replay. **TD1 is a source-level closeout candidate only.** Full dependency-backed Node 24 build, live PostgreSQL Project migrations/CAS, cross-process propagation, browser/Windows testing and crash-recovery certification still block formal completion.
- **TD2 remains open:** unowned background services, end-to-end distributed execution fencing, resource-cost measurements and real PostgreSQL multiprocess validation.


## 34. TD1 Pass 11 — Two-column Account CAS and PostgreSQL certification gate (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass11-CAS-Certification-Source.zip`, direct parent TD1 Pass 10.

- **CONFIRMED correctness gap fixed:** Original Account read fingerprint includes user preferences and personal accent but `updateMany` fenced only preferences. A concurrent accent-only update after the fresh read could be reverted. The Prisma update condition now includes both columns. Two executable accent-race tests enforce conflict response and no overwrite.
- **Certification tooling:** Added isolated-schema PostgreSQL 17/18 test for the two TD1 Project Setting migrations, parallel revision CAS, lock/reset, Project deletion cascade and two-column preference CAS. The harness needs an explicitly authorized disposable DB and installed `pg`; in this environment its execution remains BLOCKED. See `TD1_PASS11_SOURCE_CLOSEOUT.md` for exact command and scope.
- **Source checks:** 26/26 previous technical-debt/Settings/tool-registry/config recovery commands passed, including 10/10 account checks; no full Node24 build or live PG here. Native binaries unchanged, no new migration.
- **Remaining release gate:** Full Prisma deployment on fresh PostgreSQL, two authenticated browser/server processes, offline replay, config journal fault injection and Windows/Qt tests. TD1 remains **source-level closeout candidate, not release-certified**; TD2 remains open.

## 35. TD2 Pass 10 — Shutdown-safe pending claims and drain (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass10-Shutdown-Claim-Drain-Source.zip`, direct parent TD1 Pass 11.

- **CONFIRMED runtime race fixed in source:** `stop()`/`drain()` previously waited for active handlers but could miss PostgreSQL claims awaiting completion. A late claim could start a handler even after shutdown began.
- **Delivered:** The worker tracks outstanding claim batches, releases a claimed-but-unstarted job with the already-fenced, retry-preserving queue deferral path when stopping, and waits for claim-release completion before awaiting active work. Claim failures and lost leases do not become fake successes. Already-committing transfers finish safely.
- **Evidence:** Six executable new shutdown-race assertions, 27/27 inherited + new tech-debt/registry/static source commands; see `TD2_PASS10_SHUTDOWN_CLAIM_DRAIN.md`, `TD2_PASS10_VALIDATION.md` and regression log. Source hashes and patch replay verified.
- **Limitations:** Live PostgreSQL multi-process cancellation, restart and worker reclaim untested. DB query could still block shutdown if PostgreSQL is unresponsive; host watchdog remains necessary. Full Node 24/Windows compilation and measured resource savings remain outstanding. Source work does not guarantee exactly-once external side effects.
- **TD1:** source-level closeout candidate pending certification; unchanged. **TD2:** remains open. Continue enrolling explicitly tool-owned runtime consumers and run real PG/Windows shutdown tests before declaring it complete.

## 36. TD2 Pass 11 — Calendar event bridge and long-scan ownership (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass11-Calendar-Automation-Ownership-Source.zip`, direct parent TD2 Pass 10.

- **Confirmed remaining execution:** Scheduled Calendar evaluation could continue scanning 5,000 events after disabling Calendar, and the separate Studio automation event bridge still processed Calendar activity despite the disabled tool. The common bridge cannot simply be stopped because Project/Ticket/custom-field automation must stay available.
- **Source implementation:** Owned Calendar durable scan now receives `throwIfToolUnavailable()` and checks at entry, bounded 64-record intervals, and exit; its event-driven branch checks fresh authoritative Studio state before querying Calendar. Disabled Calendar activity does not trigger optional automation, while Project/Ticket triggers still work. DB Settings lookup failures do not silently grant execution.
- **Semantic choice:** Missed *activity-driven* Calendar events are not replayed on re-enable; the queued durable Calendar scan is preserved. No surprise historical automation burst. At most 63 additional scan items can run between checks. Already-committing work is not forcefully rolled back.
- **Evidence:** Eight executable focused tests, inherited TD0–TD2 suites, source syntax audit and registry checks. See `TD2_PASS11_CALENDAR_AUTOMATION_OWNERSHIP.md` and `TD2_PASS11_VALIDATION.md`.
- **Still open:** Remaining tool-owned consumers, stronger in-flight side-effect fencing where possible, PostgreSQL two-process tests, Node 24/Windows runtime and actual idle resource measurements. TD1 stays source-complete but pending certification. TD3 is not started.

## 37. TD2 Pass 12 — Durable claim admission serialization (2026-10-11)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass12-Claim-Admission-Source.zip`, direct parent TD2 Pass 11.

- **CONFIRMED claim concurrency race:** Two `runBatch()` callers could both see an empty `active` set while database claim requests were pending and each launch a handler, exceeding the configured worker concurrency. The Pass 10 shutdown fix tracked outstanding claims but did not prevent multiple batches being admitted simultaneously.
- **Delivered:** One in-flight claim cycle per worker instance; overlapping admission requests return zero instead of competing. Added `pendingClaimBatches` diagnostics. No change to background job schema, lease fencing, retry policy, tool availability or shared maintenance execution.
- **Evidence:** Four new executable claim-admission tests: blocked PostgreSQL claim, refilling after handler exit, recovering from a claim error, and draining an unstarted claim during shutdown. Inherited TD0–TD2 and tool-registry checks also pass. See `TD2_PASS12_CLAIM_ADMISSION.md` and `TD2_PASS12_VALIDATION.md`.
- **Limitations:** This enforces **per-worker local** admission, not cluster-global job budgets. No live PostgreSQL or Node24/Windows certification, measured idle resource savings or exactly-once guarantees. TD1 release certification remains pending; TD2 stays open for other runtime consumers and real-world validation.

## 38. TD2 Pass 13 — Tool-owned collaboration streams and request gate (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass13-Collaboration-Ownership-Source.zip`, direct parent TD2 Pass 12.

- **Confirmed gap:** Closing optional Calendar/Library scheduling did not proactively close their collaboration SSE streams; collaboration resource-access caching could serve a prior `allowed` decision after the tool was disabled.
- **Implemented:** Explicit ownership only for Calendar, Library, Scheduler and Timeline collaboration rooms; on Studio switch enabled→disabled, close relevant SSE streams and clear their presence/cache. All collaboration HTTP requests and ongoing stream reauthorization check the active tool owner before using cached permissions. Project/Board/Whiteboard/Build/QA/Release rooms remain independent. Initial SSE snapshot cleanup is attached before its asynchronous projection and is idempotent.
- **Validation:** New 8-case runtime/access contract suite, 25 inherited checks (26/26 commands); source static syntax and registry checks pass. See `TD2_PASS13_COLLABORATION_OWNERSHIP.md` and `TD2_PASS13_VALIDATION.md`.
- **Still open:** This is not atomic cross-process shutdown; database Settings coordination remains eventually consistent. No production SSE soak, live PostgreSQL distributed testing, Node 24/Windows build or measured performance delta. Shared collaboration maintenance and other cross-tool systems are deliberately unaffected. TD1 remains source-complete pending certification.

**Next:** Enroll/audit remaining optional services with clear ownership; verify cross-process stream revocation and durable queues under real PostgreSQL; record network/CPU/DB baselines for disabled vs enabled tools before certifying TD2.

## 39. TD2 Pass 14 — Ticket automation event ownership (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass14-Ticket-Automation-Ownership-Source.zip`, direct parent TD2 Pass 13.

- **CONFIRMED gap:** The Studio activity bridge and Project automation event subscriber both handled Ticket activity even after `ticketsEnabled=false`. Calendar had a fresh kill-switch check, but Ticket processing did not. The shared listeners cannot simply be shut off: they must continue handling ordinary Project, non-Ticket Board, and custom-field events.
- **Source implementation:** `server-automation-job-runtime.ts` supplies one fresh Ticket availability callback using the existing local owner state and authoritative Studio Settings. The Studio automation bridge skips explicit Ticket activity *before* querying the Card and checks generic Card activity after classifying a Ticket. The Project automation subscriber applies the same distinction before evaluating/enqueueing rules. DB availability failures fail closed for Ticket-specific work. No new runtime service, permission model or schema.
- **Preserved behavior:** Project-created automation and non-Ticket Card/Board automation keep running; no unnecessary Ticket Settings lookup on unrelated events. Disabled activity is not replayed on re-enable. Existing queued `automation.project-rule` and `automation.studio-action` jobs are **not yet dynamically classified and suspended based on their embedded trigger contexts**, so full Ticket shutdown is not claimed.
- **Evidence:** 12 new executable checks for disabled/enabled Ticket paths, Card classification, unrelated work, failed Settings and canonical wiring. All 28 inherited/new tech-debt, static, and tool-registry validation commands pass. See `TD2_PASS14_TICKET_AUTOMATION_OWNERSHIP.md`, `TD2_PASS14_VALIDATION.md` and regression log.
- **Remaining TD2:** Dynamic ownership of queued generic automation actions, other optional consumers, cross-process races, real PostgreSQL/Node 24/Windows certification, and actual CPU/network/database savings. TD1 remains source-complete pending release certification.

**Next:** Audit queued automations with resource context and keep background queue preservation semantics; test two-process disables on PostgreSQL and measure steady-state idle utilization before calling TD2 complete.


## 40. TD2 Pass 15 — Context-aware queued Ticket automation ownership (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass15-Queued-Ticket-Automation-Source.zip`, direct parent TD2 Pass 14.

- **CONFIRMED pending gap from Pass 14:** New Ticket events were guarded, but already-queued `automation.project-rule` and `automation.studio-action` jobs were mixed with ordinary Project/Board work and still eligible to execute when Tickets was disabled. Blocking the generic job type would incorrectly stall unrelated automation.
- **Delivered:** `job-tool-ownership.ts` now identifies Ticket-dependent generic jobs by trigger, Ticket/Card source classification, or Ticket-creation action overrides. The durable worker accepts an optional payload-aware availability gate, runs it against authoritative Studio Settings before handler execution and again at explicit handler checkpoints, and preserves deferred jobs without consuming attempts. Normal Project/Board automation does not read Ticket policy in this gate.
- **Current rule guarantee:** The Project durable executor also inspects the currently stored rule actions (including nested branches and deferred overrides) before creating an automation run, so an originally non-Ticket event that creates a Ticket is deferred while Tickets is disabled. Missing or failing Ticket-policy checks fail closed without converting policy pauses into retry errors. Studio action jobs are checked using their recorded Ticket event context.
- **Evidence:** New 12-case executable contextual ownership suite; all 28 inherited and new registry/technical-debt validation commands passed. Static audit reports 993 active TypeScript files, zero syntax diagnostics, and one expected missing generated Prisma relative import in the lean archive. See `TD2_PASS15_QUEUED_TICKET_AUTOMATION.md`, `TD2_PASS15_VALIDATION.md`, and regression log.
- **Limitations:** Payload-specific jobs are checked **after SQL claim** and use durable deferral with a cooldown; they are not excluded by type at SQL claim time because the queue is shared. Already-running multi-action automation and external side effects are not atomically rolled back on tool disable. Direct/manual automation execution paths need separate policy review. No live PostgreSQL/Node24/Windows certification or measured disabled-state CPU/network savings. TD1 stays source-complete pending certification; TD2 remains open.

**Next:** Audit remaining optional background owners, improve durable mixed-context admission if measured as noisy, then run real PostgreSQL multi-server disable/re-enable + lease/shutdown tests, Windows/Node24 certification, and resource measurements before closing TD2.


## 41. TD2 Pass 16 — Cross-tool automation authority and ownership inventory (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass16-Cross-Tool-Automation-Source.zip`, parent TD2 Pass 15.

- **Resolved source gap:** Project automation was able to create Calendar, Timeline and Scheduler objects while their tools were disabled. Runtime Job and Project execution gates now classify the original event and actual nested rule actions, then fail closed before any new run/action commit. Ticket behavior stays protected. Studio queued Calendar actions also perform an immediate direct-executor check, with retry-preserving deferral.
- **Ownership CI inventory:** All 21 currently registered durable handlers are explicitly classified: 16 shared, 2 contextual and 3 tool-owned. Classification is audit evidence, not a claim that every service or process has tool-owned lifecycle.
- **Validation:** 15 new cross-tool checks and owned-handler inventory check; inherited regression and static source commands passed. See `TD2_PASS16_CROSS_TOOL_CLOSEOUT.md` and `TD2_PASS16_VALIDATION.md`.
- **Important bounds:** A conditional branch targeting a disabled tool causes conservative preflight deferral even when it would not be selected. A tool disabled after the final preflight can still race with a multi-action run, and already committed external effects are not reversible. No live PostgreSQL two-server test, full Node24/Windows build or measured CPU/network savings. **TD2 remains open for production/runtime certification**; source hardening cannot be equated with a certified shutdown lifecycle.

**Next:** Run the attached TD2 certification checklist on actual PostgreSQL + Windows/Node24, fix any failures as part of TD2, capture comparative idle-resource measurements, then determine whether TD2 merits formal closure. Do not promote the next Appearance phase merely because source assertions are green.

## 42. TD2 Pass 17 — Standalone media worker fail-closed control and draining (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass17-Media-Worker-Control-Source.zip`, parent TD2 Pass 16.

- **CONFIRMED gap:** The separately hosted media worker started with `active` control posture and retained stale `active` after its control query failed, while three periodic intervals continued during shutdown draining. This differs from the main application's tool-owned durable job runner, and should not be solved by disabling shared media processing whenever Library is disabled.
- **Implemented:** Added testable `MediaWorkerControl` for authoritative, single-flight directive refresh, fail-closed loss of control, 15-second freshness, and permanent draining on shutdown. The media worker now stops heartbeat/directive/retention intervals and interrupts its idle wait before durable job draining. Active commit operations retain safe completion semantics. Shutdown exceptions exit as errors instead of success.
- **Evidence:** Ten executable new media control tests, inherited TD0–TD2 regressions, tool registry and TypeScript static audit. See `TD2_PASS17_MEDIA_WORKER_CONTROL.md` and `TD2_PASS17_VALIDATION.md`.
- **Open:** Cross-process PostgreSQL worker races, Node 24 full build, Windows native supervision/child process exit, and actual enabled/disabled idle CPU/network/SQL comparisons. The 15-second maximum directive age is a bounded safety measure, **not atomic revocation**. TD2 remains uncertified; TD1 remains source-complete pending certification.

**Next:** Complete TD1/TD2 live certification on the real supported runtime; fix defects those tests discover before moving into TD3 Appearance.

## 43. TD2 Pass 18 — Media directive fail-closed read and periodic shutdown safety (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass18-Media-Directive-Shutdown-Source.zip`, direct parent TD2 Pass 17.

- **CONFIRMED fail-open boundary:** The Pass 17 media controller correctly handled thrown control-read errors, but the actual Prisma-backed `mediaWorkerDirective()` swallowed failed queries and returned `active` for missing/invalid rows. Pass 18 makes the real directive read reject on failed, missing, or malformed authority, so the controller enters maintenance instead of continuing claims.
- **Confirmed shutdown gap:** Stopping heartbeat/directive/retention intervals did not wait for those callbacks if already in flight. The worker now tracks/coalesces periodic operations, stops claims synchronously and drains periodic I/O before terminal heartbeat writes and Prisma disconnect. Already-committing media work finishes safely.
- **Evidence:** 12 new executable regressions, 33 inherited/new validation commands, isolated strict TS control-module compile, manifest/archive/patch checks. See `TD2_PASS18_MEDIA_DIRECTIVE_AND_SHUTDOWN.md` and `TD2_PASS18_VALIDATION.md`.
- **Still open:** Live PostgreSQL directive failure/multi-process testing, Node24 full build, Windows worker supervision and process-tree cleanup, and actual CPU/SQL/network idle measurements. Waiting for hung database callbacks can delay shutdown; retain host watchdog. **TD2 not yet production certified.**

**Next:** Run the TD2 certification checklist on a disposable fully provisioned Cluster environment, repair any observed failures, then decide whether to close TD2. Avoid declaring success from only source tests.

---

## TD2 Pass 19: Consolidated scheduler reliability and diagnostic evidence (2026-10-12)

**Baseline:** TD2 Pass 18 source. **Scope:** One connected runtime hardening package across the resource governor, owned-task scheduler, operator diagnostics and repeated regression/performance evidence. This does not close live PostgreSQL, Windows or Node 24 certification.

### Implemented

1. **Resource-governor self-recovery:** sampler exceptions no longer silently kill the rescheduling loop. Errors are logged and retried, with aggregate health (`samples`, `failures`, `consecutiveFailures`, timestamps and next sample) kept for authorized Operations health diagnostics.
2. **Lifecycle fencing for telemetry:** `stop()` and `start()` invalidate earlier generations; old database/queue completions may not update the governor's admission capacity or rearm a dead loop. An overlapping stale startup sample is not counted as a fresh success.
3. **Queue-pressure recovery:** failed queue count queries fall back to cached queue state without stamping it as a successful database reading; the next sample can retry.
4. **Background-owned execution evidence:** per-owner runtime summaries of armed timers, active subscriptions, callback attempts, cancellations, failures, elapsed task duration and overlap/pressure deferrals. Owner state is visible without inventing a CPU-usage estimate.
5. **Honest cancellation accounting:** cooperative owner-shutdown callbacks that actually abort are counted as cancellations, not successful active work or false failures. An unrelated error after cancellation remains an error.
6. **Admin-scoped diagnostics:** the sampler and detailed per-tool runtime summaries are returned on authenticated Operations health endpoints, not the public `/health` endpoint.
7. **Executable measured scheduler smoke test:** real timers demonstrate that Calendar/Library owned callbacks stop when disabled, unowned core work continues, and callbacks resume when tools are enabled. This measures only synthetic callback activity, **not** live CPU, network or SQL savings.

**Tests:** all inherited TD0–TD2 commands, a strict isolated TypeScript check of `background-tasks.ts`, owner/sampler race tests and controlled idle-scheduler measurements. Exact execution results are in `TD2_PASS19_VALIDATION.md` and `TD2_PASS19_REGRESSION_RESULTS.json`.

**Still open:** real PostgreSQL competing-worker and coordinated disable/re-enable tests; full Node 24 dependency-backed compilation; Windows process shutdown and recovery; running-Cluster per-tool CPU/query/network before-and-after measurements. TD1 remains a source-closeout candidate and TD2 remains source-hardened but **not certified**. Do not move the release certification gate on the strength of these tests alone.


## TD2 Pass 20: Cross-process recovery and ambiguous commit hardening (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass20-Queue-Recovery-Multiprocess-Source.zip`. Direct parent Pass 19. **Status: source implemented and test-verified, live certification still OPEN.**

- **Fixed execution and persistence safety defects:** unobserved async job execution rejections, ambiguous successful acknowledgements wrongly followed by FAIL, stale historical RUNNING attempt rows on expired reclaims and exhausted retries, incorrect failed-vs-lease-lost metrics, and unnecessary duplicate lease/cancellation database polling per claimed job. Files: `apps/server/src/domains/jobs/job-worker.ts` and `apps/server/src/domains/jobs/job-queue-service.ts`.
- **Expanded integration evidence:** 37/37 inherited/new validation commands, six focused fault tests, four SQL-boundary recovery tests, and a five-scenario IPC fault harness using two independent OS Node worker processes. The IPC harness was rerun six additional times successfully. Synthetic queue authority is not PostgreSQL.
- **Prepared actual SQL certification:** an opt-in PostgreSQL 17/18 disposable-schema harness uses the real `BackgroundJobQueue` SQL with two separate `pg` connections and tests competing claims, lease/attempt history, and disabled deferral. Requires explicit environment consent and dependencies; **not executed in this environment**.
- **Next required certification:** run both TD1 and TD2 PostgreSQL harnesses on disposable PostgreSQL; Node 24 dependency-backed build/Prisma generation; Windows native-host/media-worker shutdown; real application CPU/SQL/network and tool-toggle runtime tests. TD1 remains source complete and TD2 remains source hardened, not release certified.
- **See:** `TD2_PASS20_QUEUE_FAULTS_AND_CERTIFICATION.md`, `TD2_PASS20_VALIDATION.md`, `TD2_PASS20_REGRESSION_RESULTS.json`.


## TD2 Pass 21: Workspace-scoped distributed admission and SQL contention certification (2026-10-12)

**Baseline:** TD2 Pass 20. **Status:** source-tested, still **NOT certified against live PostgreSQL, Node 24 or Windows**.

- **Fixed a distributed workspace admission race:** a single SQL `FOR UPDATE SKIP LOCKED` correctly fenced each candidate job row but did not serialize *workspace-wide* running-count and running-cost limits across different jobs or queues. Replaced admission with a single candidate row lock, existing transaction-scoped advisory lock keyed by workspace ID, and a fresh conditional claim statement after acquiring the lock. All attempt cleanup, fencing, and recording remain transactional. A claim transaction acquires no more than one workspace advisory lock.
- **Expanded executable coverage:** eight contention cases with transaction/advisory/row-lock simulation and 12 successful repeat runs; inherited regression matrix 38/38. Added a maintained npm test command. The existing two-OS-process IPC fault suite still passes.
- **Expanded optional live PostgreSQL certification:** the disposable-schema harness now exercises same-workspace concurrency and cost across separate queues, independent workspaces, and the READ COMMITTED requirement. Live harness was not executed in this environment.
- **Tradeoff:** a candidate preflight adds one database read per claim, plus contention on workspace advisory locks; benchmark query volume, tail claim latency and throughput in real PostgreSQL. Admissible work can wait for the next poll after another claim wins a workspace limit.
- **Certification still open:** PG17/18 live SQL and concurrency; Node24 installed-dependency compile + Prisma; Windows shutdown; full-server enabled/disabled CPU/SQL/network measurement. Do not advance TD2 to certified/closed or TD3 to started from these source tests.

See `TD2_PASS21_WORKSPACE_CLAIM_CERTIFICATION.md` and `TD2_PASS21_VALIDATION.md`.

## TD2 Pass 22: Bounded exhausted-job reconciliation and integrated certification gate (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD2-Pass22-Bounded-Recovery-Certification-Source.zip`, direct parent TD2 Pass 21. **Status:** tested source checkpoint; TD1/TD2 release certification remains **OPEN**.

- **Confirmed hotspot:** each durable `claim()` transaction previously dead-lettered *all* globally expired retry-exhausted jobs in one unbounded, locking update, even when claiming from a different queue. Under a post-crash backlog this could cause large database write bursts and competing transactions to block.
- **Bounded cleanup:** select at most 64 oldest eligible rows with `FOR UPDATE SKIP LOCKED`, dead-letter exactly those rows and reconcile RUNNING attempt history transactionally. Remaining rows are handled by later claims. Retains the existing workspace admission, unique lease ownership, retry, and tool-disable logic. This limits write size/lock contention per claim but does not establish actual throughput or CPU savings.
- **Evidence:** six new deterministic recovery scenarios (64-row cap, 300-job backlog convergence, independent concurrent claimers, transaction rollback, queue independence, no terminal rewrites). Updated inherited SQL boundary tests. Expanded opt-in real PostgreSQL harness with 150 exhausted records and 64 → 128 → 150 assertions.
- **Consolidated certification:** adds a guarded CLI preflight and opt-in combined TD1 SQL / TD2 SQL / Prisma validation / full build gate, plus five credential/consent safety tests. It cannot mark Windows supervision or full-server performance certified. `40/40` regression and tool registry checks pass on Node 22; 994 TS/TSX syntax scan clean.
- **Unresolved release gates:** live PostgreSQL 17/18 concurrency and failed-lock validation, Node24 installed-dependency build/Prisma generation, Windows native process shutdown/recovery, production enabled-vs-disabled CPU/DB/network, and real queue p95 latency/throughput. PostgreSQL wasn't available in this environment, so no live SQL success is claimed.

See `TD2_PASS22_BOUNDED_RECOVERY_AND_CERTIFICATION.md`, `TD2_PASS22_VALIDATION.md` and `TD2_PASS22_REGRESSION_RESULTS.json`. **Keep TD2 open** until the remaining gates have positive runtime evidence. TD3 not yet started.


## TD2 Pass 23: Crash-safe cancellation reconciliation and committed-enqueue wake isolation (2026-10-12)

**Parent:** TD2 Pass 22. **Checkpoint:** `Cluster-v0.546.0-TD2-Pass23-Cancellation-Recovery-Source.zip`. **Status:** source-tested; TD2 certification remains **OPEN**.

- **Closed orphan state defect:** an expired RUNNING lease with cancellation requested and remaining retries could never be reclaimed and was omitted from the exhaustion-only sweep. The existing bounded claim-transaction recovery now finalizes orphaned cancellations, optionally scheduled queued cancellations, and retry-exhausted leases in one 64-row SKIP LOCKED cleanup. Cancellation wins if both exhaustion and cancellation are present. Final job state and RUNNING attempt history commit atomically.
- **Avoided premature cancellation:** still-valid leases are left to the current executor's cooperative cancellation path; expired noncancelled leases with retry budget stay eligible for ordinary reclaim. Shared job admission, workspace locks, ownership tokens and tool availability are unchanged.
- **Post-commit wake safety:** the optional external queue wake publisher can no longer turn a successful committed enqueue into an exception if publishing throws synchronously, rejects asynchronously or its warning logger throws.
- **Evidence:** 16-case bounded/mixed orphan recovery suite (10 added cases), 15 repeat runs, 10 two-OS-process fault repeats, 40/40 inherited/static/registry commands. Real PostgreSQL harness expanded with orphan recovery, attempt outcomes, leased and queued cancellation, followed by normal reclaim. This live SQL remains **not run** here.
- **Certification remains:** real PostgreSQL 17/18 recovery/lock tests, Node 24 dependency-backed build/Prisma, Windows controlled shutdown/restart, full-server disabled-tool CPU/SQL/network/queue throughput measurements. No full TD1/TD2 or TD3 status promotion.

See `TD2_PASS23_ORPHAN_CANCEL_RECOVERY.md`, `TD2_PASS23_VALIDATION.md`, `TD2_PASS23_REGRESSION_RESULTS.json`.


## TD3 Pass 1: Semantic palette and visual inheritance foundation (2026-10-12)

**Parent:** TD2 Pass 23. **Checkpoint:** `Cluster-v0.546.0-TD3-Pass1-Appearance-Foundation-Source.zip`. **Status:** TD3 IN PROGRESS, source-tested (NOT runtime certified). User explicitly chose to proceed with TD3 before the outstanding TD1/TD2 certification, which remains on the release gate list. Supersedes the *sequencing* admonitions in earlier implementation notes, not the certification requirements.

- One canonical two-mode, 20-role semantic palette feeds the Web runtime via `--cluster-semantic-*` and Qt-native chrome through a generated QML singleton, with exact 8-digit alpha semantics conversion and a stale-generated-file CI check. Existing Qt palette literals for native surface/background/text/status defaults are now token references; high-contrast and status-palette adaptations remain behavioral overrides.
- `resolveVisualInstance()` implements an explicit, bounded 32-layer parent graph rather than silently ignoring `parentId`; duplicate, missing, reserved, or cyclic nodes are rejected. Studio/user/device persistence is NOT newly claimed by this change.
- Native textfield/combobox/button and representative Web toggle/preview now share an accessible semantic focus-ring role. Text/light muted contrast corrected for the newly shared palette; focus 3:1 and text 4.5:1 baseline token contrast are checked. Support both OS reduced motion and user `reduced`/`none` preferences in sample preview.
- Account Settings live shell preview derives semantic colors plus draft background, pattern, shell surface, glass, radius and accent values independently of the global appearance, with local data selectors. Web theme changes immediately republish CSS tokens. Comfortaa, the original background patterns/accents and existing Studio/Account settings remain unchanged.
- **Evidence:** 33 targeted tests, 43/43 inherited/extended validation commands, native 40-token exact parity, strict targeted TypeScript compilation, 994-source static audit with 0 syntax errors. **Excluded:** compiled Qt/native runtime, real browser screenshots, DPI/mobile/a11y hands-on, full installed dependencies, production performance.
- **Next:** converge shared input/button/popover/menu/inspector controls, layered CSS ownership, interactive previews and real screenshot/a11y regression evidence before retiring styling fossils. TD3 remains OPEN.

See `TD3_PASS1_APPEARANCE_FOUNDATION.md`, `TD3_PASS1_VALIDATION.md` and `TD3_PASS1_REGRESSION_RESULTS.json`.


## TD3 Pass 2: Shared UI primitives and legibility (2026-10-12)

**Parent:** TD3 Pass 1. **Checkpoint:** `Cluster-v0.546.0-TD3-Pass2-Shared-Controls-Readability-Source.zip`. **Status:** TD3 IN PROGRESS. This is a substantial source/Chromium fixture pass, not a completed application-wide UI certification.

- Shared action/context menus now use one enabled-item keyboard navigation policy with Arrow/Home/End and predictable disabled/empty handling. Split menus can open using arrow keys. Select and MultiSelect handle missing/unavailable active options without skipping the first choice; MultiSelect trigger ties to its open listbox.
- Shared navigation-style buttons use `aria-current` instead of `aria-pressed`; `aria-disabled` link activation is suppressed and removed from Tab order. Focus on common controls is restored to a 2px visible ring, retiring a legacy global 1px `!important` override.
- Raised minimum legibility of shared Web primary labels (13px), secondary metadata (12px), relevant menu hit targets and spacing. Native Qt buttons/combos/switches gain minimum 13px labels; Qt buttons use medium weight. The canonical select stylesheet no longer has an `!important` workaround; one source owns all select-menu variations. Production focus token uses semantic light/dark accessible defaults.
- Browser evidence: 4 **static shared-control fixture** screenshots using the actual production CSS cascade in Chromium, in light/dark at 1440px/390px. No horizontal body overflow; all menu names/options >=13px, descriptions >=12px, focused control outline >=2px. This is not the running React application or Qt desktop.
- **Continue TD3:** app-shell/Sidebar/Taskbar alignment and clipping, popup stacking and portals, modal/inspector keyboard behavior, scaled text/coarse touch, real Web/Qt screenshot parity and design-system retirement. TD1/TD2 live certification deferred by user decision, not certified or cancelled.

See `TD3_PASS2_UI_PRIMITIVES_AND_READABILITY.md`, `TD3_PASS2_VALIDATION.md`, `TD3_PASS2_CHROMIUM_VISUAL_METRICS.json` and `TD3_PASS2_REGRESSION_RESULTS.json`.

## TD3 Pass 3: Surface material, shell and portaled modal refinements (2026-10-12)

**Parent:** TD3 Pass 2. **Checkpoint:** `Cluster-v0.546.0-TD3-Pass3-Material-Shell-Modal-Source.zip`. **Status:** TD3 OPEN, source/static browser tested; not native, database or installed-dependency runtime certified.

- Added subtle, neutral, theme-aware microtexture/elevation to outlined and glass panels; preserved Flat, high-contrast, forced-color and reduced-transparency safeguards. Fixed light-theme first-paint fallback and retired competing legacy CSS priorities.
- Improved canonical shell labels and coarse-pointer targets; did not change persisted layout defaults, navigation authority or new icon dependencies.
- Portaled floating surfaces now identify their owning modal; Escape/focus/trap/isolation favor the top owned surface. Cancelled stale modal autofocus tasks.
- 45/45 inherited commands passed; 12/12 new source-contract checks; six executable modal-focus DOM cases; seven new shell/material and four controls static Chromium fixtures. No full app/Qt screenshot certification.

**Next:** full running UI screenshots at multiple DPI and phone widths, Inspector/drawer/overlay and modal stacks, real app keyboard/screen-reader pass, plus TD1/TD2 live PostgreSQL + Windows certification (deferred, not skipped).
See `TD3_PASS3_MATERIAL_AND_MODAL_REFINEMENT.md` and `TD3_PASS3_VALIDATION.md`.

## TD3 Pass 4: Portaled mobile inspectors, layered menus, responsive material surfaces (2026-10-12)

**Checkpoint:** `Cluster-v0.546.0-TD3-Pass4-Inspectors-Responsive-Material-Source.zip`. Directly follows TD3 Pass 3. Real source changes include body-portaled compact master/detail overlays, accessible keyboard resizing and constrained saved sizes, safer topmost floating dismissal and continued subtle texture adoption across inspectors/drawers. Static desktop/phone Project Library screenshots packaged separately, clearly labeled as fixtures. Details and evidence: `TD3_PASS4_INSPECTORS_RESPONSIVE_MATERIAL.md` and `TD3_PASS4_VALIDATION.md`.

**State:** TD3 source implementation progressed, **not certified**. TD1/TD2 Windows/PostgreSQL runtime gates remain open. Next prioritize real app/Qt screenshots and actual nested overlay focus testing, followed by targeted browser/device fixes, not a broad appearance redesign or new icon pack.


## TD3 Pass 6 — Appearance 3.2 integrated into existing shell (2026-10-12)

**Source-implemented, not runtime-certified.** This is a continuation of TD3 Passes 1–5, not a competing visual overhaul. Keep Pass 5's user-selectable floating/full-width sticky taskbar. Add one optional docked/floating sidebar preference, shared surface depth/texture settings, isolated Appearance live preview, and in-page Theme/Materials/Layout/Motion/Presets navigation. The same sidebar/taskbar components, auth, authorization, sync, tool ownership, and browser/Qt visual authority remain canonical. Preserve dark/light contrast, mobile drawers, keyboard access and reduced-effects modes. See `TD3_PASS6_FLOATING_SHELL_APPEARANCE_32.md` for source/test evidence and the remaining browser/Qt certification requirements.

## TD3 Pass 7 — Shell material controls + action menu consistency (2026-10-12)

Continues the existing TD3 Pass 6 baseline, **source implemented, not fully runtime certified**. User Appearance now supports icon size, panel-border definition and desktop scrollbar prominence, with user preference schema, renderer resolver and persisted key lists updated consistently. High-contrast overrides prevent border/scrollbar visibility regressions. Shared action/context menus converge on common keyboard traversal and separation of destructive options. Appearance categories match document order and sticky taskbar offsets. Eight static Chromium production-CSS preview scenarios plus 45 inherited regression commands and 22 new source assertions pass. Details: `TD3_PASS7_MATERIAL_CONTROL_MENU_REFINEMENT.md`. Still requires actual signed-in React, Qt, Windows DPI and keyboard interaction certification before calling TD3 closed.


## TD4 Pass 1 (2026-10-12) — Shared commands and workflow reliability

**Evidence:** `TD4_PASS1_SHARED_ACTIONS_CREATE_RELIABILITY.md`. This moves **FD-07 / FD-17 / CD-14 / CD-19** forward and addresses a Command Palette stale-result correctness gap; it does **not** certify those broad rows as complete. Implementation includes a synchronous single-intent Create latch, idempotency headers on ten server create mutations, default Create & Open and explicit Create Another, shared asynchronous action-menu execution with visible uncertain-error feedback, once-per-open drawer initialization, and stale/aborted remote result suppression. The code preserves existing server authorization and durable idempotency receipt handling. Targeted tests and inherited regressions passed. Full dependency-backed build and live browser/PostgreSQL/Windows/Qt certification remain open under **CD-21**, **RV** and **TD5**. Next TD4 work must tackle adoption across actual Project, Library and People actions, permission-safe projections and end-to-end integration tests, rather than another Appearance expansion.


## TD3 Pass 8: Resizable workspaces and touch context interactions (2026-10-12)

**Parent:** v0.546.0 TD4 Pass 1 (includes TD3 Pass 7). **Status:** source implemented and static tests passing; not runtime certified. See `TD3_PASS8_RESPONSIVE_LAYOUT_INTERACTION_HARDENING.md` and `TD3_PASS8_SOURCE_VALIDATION.json`. Fixed missing-persistence default width on shared rail/split; added storage-denial protection, root-relative responsive bounds and accurate divider ARIA, keyboard rail resize, and touch long-press cumulative movement guard. Kept existing floating/docked navigation options, material settings and TD4 command/search changes. Revalidated 45 inherited commands (with P4 sizing assertion updated to the new effective-range contract), 21 TD4 tests, 27 focused tests, 6 Chromium static layout cases, and full source parsing. **Still open:** real React/Qt mounted application, Windows DPI/assistive technology and installed-dependency/PostgreSQL certification.

## TD3 Pass 9: Modal owner inheritance, dynamic floating isolation and overlay stacking (2026-10-12)

**Parent:** TD3 Pass 8 (already contains TD4 Pass 1). **Status:** source implemented and direct Chromium helper tests passing; full app certification **OPEN**. Fixed overlapping background popovers above modal dialogs by converging floating/modal z-layer order; made isolation react to late-created portals while preserving original inert/ARIA state; nested body-portaled anchors keep the correct modal owner; backdrop dismiss now stops at the floating layer first, and suspended menus cannot steal focus. Evidence: `TD3_PASS9_OVERLAY_INTEGRATION.md`, `TD3_PASS9_SOURCE_VALIDATION.json`, `TD3_PASS9_INHERITED_REGRESSION_RESULTS.json`, `TD3_PASS9_PREVIEW_METRICS.json`. 45 inherited commands, 21 new contracts, 15 browser helper scenarios and 6 static CSS preview scenarios passed. Still requires Node24 dependency-backed build, actual authenticated React focus/browser testing, Windows 100/125/150% DPI, native Qt and screen reader certification.


## 2026-10-13 | TD1/TD2 closeout and certification-roadmap split

The TD1/TD2 implementation contract is closed for the bounded Studio and configured-tool scope above. Fixed: automation Studio Settings rule CAS without optional version fallback; initial create-race returns 409; direct Ticket automation activation now checks tool availability; Studio queued work rechecks availability at its final action boundary, preserving durable deferral without a false failure record. See `TD1_TD2_IMPLEMENTATION_CLOSEOUT.md`. **This entry does not assert target-platform verification.** The backlog of OS/PostgreSQL/browser checks has been removed from implementation-phase blocking and copied to `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.


## TD3 Pass 10 — Shared picker, mobile drawer and dynamic modal isolation implementation (2026-10-13)

**Parent:** TD1/TD2 implementation closeout. **Status:** TD3 implementation continues; no release qualification gate in this roadmap.

Implemented a canonical enabled-option identity/navigation helper and integrated it into Select, searchable Combobox and MultiSelect. Fixed opening arrow behavior, live-filter state, disabled/empty results, screen-reader active option linkage, Enter selection and input caret key handling. Closed mobile drawer Escape/focus-return/responsive transition/disclosure gaps and restored a pointer dismissal backdrop compatible with modal accessibility isolation. Background modal siblings mounted after opening now become inert and restore original state at close. Full notes in `TD3_PASS10_PICKER_DRAWER_MODAL_INTEGRATION.md`.

**Development evidence:** 46/46 inherited commands; 31/31 new picker/drawer assertions; 9/9 Chromium executed production modal-isolation helper cases; 4/4 static CSS preview scenarios. TD1 and TD2 implementation status remains CLOSED.

**Next TD3 implementation:** finish the remaining local-control migrations, canonical menu ownership, and Qt source-level UI parity. Windows/runtime release certification is documented separately and is not a closure condition in the implementation roadmap.


## TD3 Pass 11: Main workspaces and shared interaction convergence (2026-10-13)

**Parent:** TD3 Pass 10. **Status:** implementation advanced; release certification remains on its separate roadmap. Shared metric action semantics, search toolbar keyboard/focus behavior, race-safe history actions, and actual Home/People responsive source contracts were repaired. A 24-shot light/dark desktop/phone representative preview gallery covers Home, Projects, Library, People, Calendar, Boards, Settings and shared UI elements. 46/46 inherited regressions, 21/21 new focused checks and 4/4 Chromium responsive checks passed; 1,051 TS/TSX syntax clean and 3,189 renderer relative imports resolved. Details: `TD3_PASS11_MAIN_WORKSPACE_AND_INTERACTION_REFINEMENT.md`. TD1/TD2 implementation remains CLOSED.



## TD3 Pass 12: Project-tab replacement search implementation (2026-10-13)

**Parent:** TD3 Shell Regression Audit (includes TD1/TD2 closeout, TD3 Pass 11, TD4 Pass 1). **Implementation delivered:** the existing Command Palette's controlled input is portaled into the real taskbar Project Tabs slot. Project tabs remain mounted but inert and visually transition away; closing search reverses the transition without disturbing project tab state. The real shared command/discovery engine renders its existing results in a body-portaled floating dropdown directly under the taskbar search field, not a second modal/search input. Escape, outside click and close actions dismiss the dropdown; utility buttons My Work, Tickets, Transfer Center, notifications, and account remain in their own slots. Layout uses both user-selectable floating and full-width taskbar modes and preserves phone-width search access. Reduced motion bypasses the transition. The source contract and static production-CSS Chromium fixture are checked; production/runtime certification remains separate. See `TD3_PASS12_TASKBAR_SEARCH_IMPLEMENTATION.md`.

**Remaining TD3 implementation** (not certification): audit/migrate remaining workspace-local menus and controls onto shared components and improve Qt source-side parity where currently divergent.


## TD3 Pass 14: Menu/People/Qt interaction convergence (2026-10-13)

**Parent:** TD3 Pass 13. **Implementation delivered:** synchronous floating-menu dismissal fence during action execution; protected recovery Undo/Dismiss; touch long-press ghost-click suppression; invalid nested People directory buttons removed while retaining identity accent and separate presence; quick profile focus return/stale async guard; Qt ComboBox delegate index and accessible target height; native high-contrast surface-gradient suppression. Regression checks and source-CSS fixture previews documented in `TD3_PASS14_MENU_PEOPLE_QT_HARDENING.md`. **TD3 remains in progress** for remaining local-control migrations, CSS owner convergence and Qt source-level parity. Release certification belongs to a separate roadmap and is not a TD3 implementation gate. TD1/TD2 implementation remains closed.

### TD3 Pass 15 implementation checkpoint (2026-10-13)

**Implemented in source:** taskbar Quick Ticket immediate single-intent/idempotency + guarded close + stale lookup isolation; common disclosure owner for People/Projects Data Tools; Qt control keyboard accessibility. Existing business tools, resource identity styles, project-tab Search, and taskbar utilities preserved.

**Still TD3 implementation:** remaining workspace-specific action menu migrations, overlapping CSS ownership cleanup without loss of detail, incomplete Qt source parity. These are **not** release-certification gates. See `TD3_PASS15_WORKSPACE_CONTROL_CONVERGENCE.md`.

### TD3 Pass 16 implementation checkpoint (2026-10-13)

**Implemented:** Seven workspace disclosure surfaces on the canonical disclosure component (People filters, Board relationships, Whiteboard relationships/server history, Project relationship creation/history, Library custom metadata); preserved their underlying commands/records and responsive domain-specific grids. Shared scoped inline-menu dismissal and keyboard behavior now power section overflow and Project resource browsing, replacing app-global closing logic. Fixed shared disclosure focus/zero-count semantics and People filter layout ownership; narrowed native Qt App Settings minimum width. Source regression and illustrative CSS preview evidence: `TD3_PASS16_SHARED_DISCLOSURE_NAV_CONVERGENCE.md`. **TD1 and TD2 remain implementation-closed; release certification is not a TD3 implementation gate.** Remaining implementation is legacy action-owner migration, selective CSS owner cleanup, and feasible native Qt source parity.

### TD3 Pass 17 implementation checkpoint (2026-10-13)

Five Tickets/Project disclosure panels converged onto `ClusterDisclosureGroup`; disabled native disclosure semantics hardened; Project overview team preserves People per-user color/presence identity; Project restricted-share settings now use properly associated labels. All existing taskbar/search utilities and Appearance settings are preserved. Development source checks recorded in `TD3_PASS17_PROJECT_TICKETS_IDENTITY_CONVERGENCE.md`. **TD3 remains open only for actual implementation; release certification is separate.**

### TD3 Pass 18 · Cross-workspace disclosure and native label convergence (2026-10-13)

**Parent:** TD3 Pass 17. Twelve legacy expandable sections across Projects, Builds, QA, Notifications, Library governance, Project Access and the Viewer now consume `ClusterDisclosureGroup` without discarding their evidence, metrics, private metadata or permissions. Added shared disclosure chevron / reduced-motion behavior and native Qt ComboBox textRole-aware labels and accessible option names. Source regression coverage and source-CSS fixtures recorded in `TD3_PASS18_CROSS_WORKSPACE_DISCLOSURE_CONVERGENCE.md` and `TD3_PASS18_REGRESSIONS.json`. **TD1/TD2 remain implementation-closed; TD3 remains open only for further source implementation, not release certification.**

### TD3 Pass 19 implementation (2026-10-13)

**Source implemented:** canonical portaled Projects filter controls with viewport/mobile/Escape/outside dismissal; seven Operations/Admin disclosures, People team context + permission bundles, and Project Type advanced settings converged onto `ClusterDisclosureGroup` without losing data/evidence/permissions. Tightened the owning CSS and Qt control accessible names/roles/states. Development regressions and source-CSS illustration metrics: `TD3_PASS19_FILTERS_ADMIN_PEOPLE_QT_CONVERGENCE.md`. **TD3 stays open only for actual remaining source implementations; release certification is separate.** TD1/TD2 implementation stays closed.

## TD3 Pass 20: Resource browser and QA/Build filter convergence (2026-10-13)

**Implementation only.** Portaled Board/Whiteboard resource Browse; single-flight window actions; removed the hidden duplicate Builds filters while retaining the canonical visible bar; QA uses shared disclosure; unique input labels and scoped CSS cleanup. Preserve all taskbar, People identity, and appearance contracts. Source and targeted checks: `TD3_PASS20_RESOURCE_NAV_QA_BUILDS.md`, `TD3_PASS20_REGRESSION_RESULTS.json`, `TD3_PASS20_SOURCE_SCAN.json`. Release certification remains separate.

### TD3 Pass 21: Viewer command/menu convergence (2026-10-13)

**Implemented:** viewer command overflow migrated to canonical floating/menu ownership with focus, mobile sheet, action busy/error behavior; toolbar and keyboard routes share synchronous single-flight command admission; failed shortcut commands show user-facing status. No native binary or schema change. See `TD3_PASS21_VIEWER_COMMAND_CONVERGENCE.md`. TD1/TD2 remain closed; certification is separate. TD3 stays open for remaining action/CSS/Qt implementation.


## TD3 Pass 22: Navigation and evidence convergence (2026-10-13)

Migrated CompactSectionNav overflow to the shared portaled floating surface, preserving group/active/detail navigation and responsive behavior; standardized menuitemradio keyboard focus; converged Admin/desktop evidence and capture disclosures; fixed stale Admin audit filter response ownership. Full development notes: `TD3_PASS22_NAVIGATION_EVIDENCE_CONVERGENCE.md`. TD1/TD2 remain implementation-closed. Preserve animated taskbar Project Tabs search, My Work/Tickets/Transfer Center, and People identity accents/presence. Release certification is separate.

## TD3 Pass 23: Taskbar notification/presence action integrity (2026-10-13)

Implemented newest-request-wins notification preview, server-acknowledged read state, immediate single-flight guards for notification and presence actions, visible failure feedback, live-stream projection ownership and bounded reconciliation. Taskbar shell/People identity preserved. See `TD3_PASS23_TASKBAR_ACTION_RELIABILITY.md`. TD1/TD2 remain implementation-closed; release certification separate.

## TD3 Pass 23: Taskbar notification/presence action integrity (2026-10-13)

Implemented newest-request-wins notification preview, server-acknowledged read state, immediate single-flight guards for notification and presence actions, visible failure feedback, live-stream projection ownership and bounded reconciliation. Taskbar shell/People identity preserved. See `TD3_PASS23_TASKBAR_ACTION_RELIABILITY.md`. TD1/TD2 remain implementation-closed; release certification separate.

## TD3 Pass 24 · Admin action integrity (2026-10-13)

Operations incident workflows and Studio Setup/Configuration controls now share synchronous mutation admission, newest-response ownership and explicit pending feedback. Incident creation and timeline notes reuse stable server idempotency keys on uncertain retries. Confirmed incident actions preserve status across silent health refreshes. See `TD3_PASS24_ADMIN_ACTION_CONVERGENCE.md`. TD1/TD2 implementation remains closed; certification is separate.

### TD3 Pass 25 · Transfer Center and job progress (2026-10-13)

Transfer Center commands now use one synchronous action gate, reject outdated native refreshes, report failed native/offline actions, and retry only transports with actual failures. Import/export job progress uses one job-ID-scoped polling lifecycle and pauses hidden-page work. Source notes: `TD3_PASS25_TRANSFER_JOB_FEEDBACK.md`. TD3 remains open for remaining actual UI implementation only. TD1/TD2 are implementation-closed; runtime release certification stays separate.

### TD3 Pass 26 implementation checkpoint (2026-10-13)
Shared copy controls and Desktop/browser clipboard result handling are source implemented; one-time credential, recovery, People/contact, partner-link, and table copy paths now report confirmed results. This is **implementation tracking**, not release certification. Remaining TD3 scope: other independent copy/actions, demonstrated CSS conflicts and Qt parity. See `TD3_PASS26_COPY_INTEGRITY.md`.


## TD3 resumed after premature TD6 execution (2026-10-14)

Active phase returned to **TD3**. The intervening TD6/CD-01 authenticated Forms draft implementation remains in source unchanged but does not set execution order. TD3 source repairs: Account menu clipboard/desktop detach now use canonical confirmed-outcome command execution; detached resource Copy uses existing ActionButton error feedback; native Server Profiles keyboard/accessibility and destructive confirmation; Save & switch failure recovery; opaque reduced-transparency surfaces. `TD3_RETURN_ACTION_NATIVE_CLOSEOUT.md` and `IMPLEMENTATION_ROADMAP_R27.md` contain the bounded scope and outstanding source audit. This is development-source work, not native runtime certification.


## TD3 R28 viewer command and sidebar conflict evidence (2026-10-14)

Viewer system-action failures that previously resolved `void` now propagate to the shared command executor, retaining retryable overflow menu. PDF text copy consumes canonical clipboard. Native App Settings and Server Profiles report action failures. A confirmed order-dependent sidebar min-height conflict was removed with measured desktop 38px/mobile 44px browser fixture evidence. Source tests: `TD3_R28_IMPLEMENTATION_AUDIT.md`, `TD3_R28_REGRESSION_RESULTS.json`. TD3 still open; no fabricated Qt/Windows runtime acceptance. Intervening authenticated Forms draft implementation remains preserved but TD6 is not active.

## TD3 R30 source implementation closeout (2026-10-14)

Current status above supersedes historical *TD3 OPEN* markers in the archival timeline. Finite R29 closeout owners were resolved/dispositioned through R30 Desktop Native Services negative-result confirmation and single-flight controls; Git Workstation immediate mutation locking and accurate post-commit refresh warnings; People metrics and Select-padding computed CSS ownership; no-change verification for chat dock, Select shadow and Admin responsive subnavigation; QML source-contract inventory (89/89). Inherited 29/29 source regression scripts passed. This is source **implementation** closeout, not runtime certification. Details in `TD3_R30_SOURCE_IMPLEMENTATION_CLOSEOUT.md` and `IMPLEMENTATION_ROADMAP_R30.md`.


## TD4 R32 Library server matching selection (source checkpoint)

Bounded 200-item server-authoritative Library search matching with shared filter ownership, repeatable-read scope, Personnel Records exclusion and independent bulk-write denial, selection persistence under same-query refresh, and fail-closed overflow. See `TD4_R32_SERVER_MATCHING_SELECTION_IMPLEMENTATION.md`. This does not close TD4; larger async jobs, collection matching and wider resource/action/search adapters remain. Runtime certification is separate.


## TD4 R33 Collection matching selection (source checkpoint)

Shared Manual and Smart Collections now select a complete authorized up-to-200 result across unloaded pages via server-owned repeatable-read snapshot, live collection-grant and revision revalidation, Records filtering and canonical item ACL. Bulk mutation remains independently protected by revisions, locks and authorization; larger durable jobs and provider/action/search adapters remain TD4 work. See `TD4_R33_COLLECTION_SELECTION_IMPLEMENTATION.md`; release certification separate.


## TD4 R33 Collection matching selection (source checkpoint)

Shared Manual and Smart Collections now select a complete authorized up-to-200 result across unloaded pages via server-owned repeatable-read snapshot, live collection-grant and revision revalidation, Records filtering and canonical item ACL. Bulk mutation remains independently protected by revisions, locks and authorization; larger durable jobs and provider/action/search adapters remain TD4 work. See `TD4_R33_COLLECTION_SELECTION_IMPLEMENTATION.md`; release certification separate.


## TD4 R34 Durable Library background metadata jobs (source checkpoint)

Server-authoritative workspace matching (up to 1,000 accessible items) now has preview/confirmation, queue intent dedupe, immutable ID/revision snapshots, 20-item transactional metadata chunks, current identity/ACL/Records/locks/revision revalidation, atomic activity and resume checkpoints, progress/cancel feedback, and tool-disable ownership. This implements a bounded non-destructive tag/untag/pin/unpin workflow, not unbounded archive/delete/move, collection-aware durable jobs, or release certification. See `TD4_R34_DURABLE_LIBRARY_BULK_IMPLEMENTATION.md`; TD3 remains source-closed.


## TD4 R34 Durable Library background metadata jobs (source checkpoint)

Server-authoritative workspace matching (up to 1,000 accessible items) now has preview/confirmation, queue intent dedupe, immutable ID/revision snapshots, 20-item transactional metadata chunks, current identity/ACL/Records/locks/revision revalidation, atomic activity and resume checkpoints, progress/cancel feedback, and tool-disable ownership. This implements a bounded non-destructive tag/untag/pin/unpin workflow, not unbounded archive/delete/move, collection-aware durable jobs, or release certification. See `TD4_R34_DURABLE_LIBRARY_BULK_IMPLEMENTATION.md`; TD3 remains source-closed.


## TD4 R35 Collection-aware durable metadata operation (source)

R34's bounded durable metadata queue now supports shared Manual/Smart Collections with current editor grants, revision-pinned complete matching, separate file ACL/Records exclusion, and collection revocation/revision revalidation on every transaction chunk. The current UI now exposes the safe workflow to collection editors/owners, not viewers. See `TD4_R35_COLLECTION_DURABLE_BULK_IMPLEMENTATION.md`. TD4 remains open, TD3 source closed; runtime certification remains separate.


## TD4 R36 bounded durable Library archive and unarchive (source only)

R35's collection-aware durable metadata worker now supports file-only archive/unarchive (restores Archive → Active, not Trash) across up to 1,000 authorized search or Manual/Smart Collection matches. Shared server preview/queue selection filters folders and non-leaf objects; the worker independently rechecks child relations, Personnel Records, active edit locks, contributor ACLs, collection grants/revisions, and individual CAS revisions in every atomic checkpointed chunk. No blob movement or destruction. See `TD4_R36_FILE_ARCHIVE_IMPLEMENTATION.md` and `IMPLEMENTATION_ROADMAP_R36.md`. TD3 remains closed; TD4 and its provider/adapters/larger hierarchy lifecycle workload remain open. Release certification remains separate.


## TD4 R37 | Serializable hierarchy mutation safety (source only)

Hardened existing bounded interactive Library hierarchy operations with in-transaction actor/destination/descendant/Records/locks/revisions revalidation, atomic activity evidence and committed-but-unreconciled storage warnings. No change to durable file-only Archive worker or 200-item interactive cap; TD4 provider adapters and durable tree-wide operations remain unfinished. See `TD4_R37_HIERARCHY_TRANSACTION_HARDENING.md` and `IMPLEMENTATION_ROADMAP_R37.md`.


### TD4 R38 | Durable physical-file reconciliation after Library hierarchy mutation (source)

After R37, post-commit `rename()` could overwrite a destination on POSIX and synchronous reconciliation could occupy the move HTTP request. R38 introduces exclusive-copy / CAS file reconciliation, retains old bytes for separate orphan management, schedules the existing `library.storage.reconcile` job after commit, adds admin repair/status endpoints, and shows progress in Library. See `TD4_R38_STORAGE_RECONCILIATION_IMPLEMENTATION.md`. Remaining TD4 hierarchy-wide async lifecycle and resource/action/search adapters are unchanged; production certification remains separate.

### TD4 R39: Library post-commit storage scheduling source convergence (October 14, 2026)

Single-item Library moves/folder-title edits and mounted folder renames no longer synchronously walk stored files after their row update; they use the R38 durable repair queue, preserve the committed state and partial warning, and display repair progress through the existing Library UI. Bulk/Admin repair scheduling uses the same source owner. Distinct mutations must not be blindly deduped into an ID-paginated scan in flight. Details, tests and unimplemented portions are in `TD4_R39_LIBRARY_STORAGE_QUEUE_CONVERGENCE.md`. TD4 remains open; TD3 stays source-closed.

## TD4 R40 source implementation update — Library orphan evidence audit (2026-10-14)

An administrator-only, read-only durable Library storage audit is connected across server queue, reference resolver, filesystem inventory and Library UI. It protects current item, historic version and derivative references; skips symlinks/internal paths; bounds scans; reports aged unreferenced *review candidates*, not destruction permission. No deletion, quarantine or auto-cleanup implemented. TD4 remains open for audited disposition, large tree operations and resource/action/search providers. TD3 remains closed. See `TD4_R40_LIBRARY_ORPHAN_AUDIT.md`.

## TD4 R41: destruction and orphan-review safety (October 14, 2026)

Removed a confirmed race that physically deleted Library blobs after the destruction transaction's last-reference check. Database destruction and its activity evidence now share one Serializable transaction; physical bytes remain for separate audited disposition. Added admin-only live recheck for completed audit-sample candidates (fingerprint, symlink/containment, age, all canonical item/version/derivative references, queued/running Library jobs), permanently read-only and explicitly *not* deletion authorization. See `TD4_R41_LIBRARY_DISPOSITION_REVIEW.md` and `IMPLEMENTATION_ROADMAP_R41.md`. TD4 still requires a write-fenced retention/provenance disposal system, large hierarchy jobs and canonical provider adapters/events. TD3 remains closed.

## TD4 R42: authorized resource-change provider read path (October 14, 2026)

The existing Resource Change SSE/REST API now applies current Library/Records access rules rather than generic project permissions to `library`/`file` changes, fails closed when access evidence is unavailable, verifies card/calendar project association, and rechecks live session and workspace role before each delivered batch. Idle streams revalidate session authority. This addresses concrete change-feed privacy defects but is **not** TD4 provider enrollment or full event federation closeout. See `TD4_R42_RESOURCE_CHANGE_VISIBILITY.md`. All R40/R41 destruction/disposition protections remain; physical cleanup, hierarchy background jobs and shared adapters stay open.

## TD4 R43: Enrolled resource-change providers (2026-10-14)

Enrolled Board/Whiteboard/Timeline canonical change visibility adapters and corrected administrator Card/Calendar fast-path bypass of record existence. Preserves R42 Library/Records/session filtering. Other provider/event/action/search/lifecycle contracts, large hierarchy operations and retention-aware blob disposal remain open. See `TD4_R43_PROVIDER_ENROLLMENT.md`, `IMPLEMENTATION_ROADMAP_R43.md`. TD3 remains source-closed, runtime certification separate.

## TD4 R44 continuation note (source implementation only)

Enrolled Project and the four Delivery records (Build, QA Plan, QA Session, Release) in the resource-change authorization registry. Provider identity snapshots now resolve authoritative Project parents and Project-level access rules for enrolled kinds. R43/R42 mock authorization semantics reconciled with the current server contract. See `TD4_R44_PROVIDER_AUTHORIZATION_CONVERGENCE.md`. Remaining providers, typed event producers, shared action/search adapters, provider lifecycle, tree-wide durable operations and retention-governed disposal stay open. No release-certification claims.

## TD4 R45 | Studio resource-change privacy boundary (2026-10-14)

Enrolled Studio Form, Form submission, public Application and Packet invalidations through database-backed providers; introduced fail-closed audience context for live change-feed reads and independent Packet Library ACL checks. Source-only regression validation; no database migration or native binary update. Remaining TD4 Source Control/People providers, shared adapters and typed events, lifecycle integration, durable large hierarchy jobs, and retention-governed disposal remain explicitly open. See `TD4_R45_STUDIO_PROVIDER_BOUNDARIES.md` and `IMPLEMENTATION_ROADMAP_R45.md`.

## TD4 R46: Source Control provider and Review queue authorization (2026-10-15)

Enrolled SourceRepository, SourceCommit, and SourceReview under canonical change-feed providers with active ProjectSourceBinding checks (including multi-Project repositories) and current Project Access Rules; removed a fail-open Project Access Rule query fallback in Source Review queue. Focused provider + live route-handler mock regressions cover protected scopes and revoked access. See `TD4_R46_SOURCE_PROVIDER_AUDIT.md`. TD4 remains open for other providers, typed events/Search/Action/lifecycle, durable hierarchy jobs and retention-governed storage disposal. TD3 remains source-closed; full runtime/production certification is separate.

## TD4 R47: command Search privacy adapter convergence (2026-10-15)

Command Search now uses strict, current Library ACL inheritance for indexed Library records, excludes Personnel Records attachments even for workspace administrators, and enforces Packet folder access and Studio audiences before the generic admin shortcut. Strict ACL/audience/database failures do not become grants. The existing batch-ranking admission loop now batches protected-Records reads; it still reauthorizes each visible result on each Search request. See `TD4_R47_SEARCH_DOMAIN_VISIBILITY_AUDIT.md` and `IMPLEMENTATION_ROADMAP_R47.md`. The shared Action adapters, other providers, lifecycle, large hierarchy jobs and retention-governed blob disposal remain unfinished. TD3 remains closed; runtime certification separate.

## TD4 R48–R51 follow-up | authorized consumers, lifecycle and typed change transport (2026-10-15)

R48 removed the renderer's stale permission-sensitive Search cache and restored standalone-resource action availability. R49 connected TD2 tool disable/re-enable to authorized change-feed admission and mounted-workspace resets. R50 enrolled People identity and governance broadcasts/assignments with current audience and lifecycle checks. R51 repairs restored-server future cursors, serializes durable outbox sequence inserts with a PostgreSQL transaction-scoped advisory lock, and gives SSE invalidations an explicit validated wire/domain-event version contract across server and renderer. See `IMPLEMENTATION_ROADMAP_R51.md`, `TD4_R51_TYPED_EVENTS_CURSOR_RECOVERY_AUDIT.md` and regression evidence. TD4 remains open; neither the advisory-lock source audit nor selected mocks certifies live PostgreSQL behavior, and the remaining Library disposal/tree and resource/provider work remains assigned.

## TD4 R59 | Domain-event ordering and assignment identity (2026-10-15)

The durable outbox now protects per-resource sequence order across claim, backoff and concurrent workers while letting unrelated resources progress. Typed assignment replay verifies stored resource identity and the Activity producer normalizes global versus scoped resource addresses. Same-ID retries verify causal metadata. Existing resource-kind index reused; no schema migration. Development source tests, not runtime certification. See `TD4_R59_EVENT_ORDERING_AND_IDENTITY.md`, `TD4_R59_EVENT_OWNER_MATRIX.md`, and `IMPLEMENTATION_ROADMAP_R59.md`. TD4 provider lifecycle, full Action/Search adapters, Library hierarchy, governed disposal and certification remain open.

## TD6 F08 — CD-04 governed People return-to-studio (2026-10-18)

The completed Offboarding case now supports a one-time, authorized, version-guarded and audited **Return to Studio** with the original person identity preserved. A confidential Personnel Record records the new decision separately from immutable prior offboarding evidence. Returning staff remain disabled pending new credentials/roles; scoped permissions, MFA/device/Discord tokens are reset, old Project/Library/Inventory/Package authority is not automatically restored. The former People profile Archive/Restore toggle and separate archived-identity activation paths are blocked. Source transaction-harness tests and inherited F01–F07 checks passed; PostgreSQL, Windows/Qt and full release certification remain deferred. CD-04 still needs expiry, renewal, entitlement lifecycle and broader onboarding integrations. See `IMPLEMENTATION_ROADMAP_TD6_F08.md`.

## TD6 F10 status (2026-10-18)

Source-implemented governed temporary Project-level member AccessRule issuance and bounded extension (independent reviewer, 180-day resource window capped by identity access, additive behavior, deny/exclusive policy preservation), Studio Settings UI, direct profile/API bypass protection, confidential evidence, notification decisions and migration. TD6 CD-04 is **still not source-closed**: Inventory license/seat entitlements, Package entitlement deployment, Library distribution policies, delegated access controls and full offboarding entitlement disposal still require implementation. Certification gates remain deferred under the implementation-first instruction. See `IMPLEMENTATION_ROADMAP_TD6_F10.md`.
