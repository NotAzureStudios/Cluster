# Cluster v0.505.0 — Phase 10 RC17 — WIP57

## Project Workspace Overhaul + Master Source Reconstruction — Pass 1

### Master source reconstruction

WIP57 begins a new source-rich master lineage instead of continuing to treat the Windows Lean release as if it were a complete repository.

- WIP56 `app/bootstrap` remains authoritative for current TypeScript/TSX/CSS/Prisma/server/web/shared code.
- Recovered native source families from Cluster Master v0.482.0:
  - Qt/C++ Desktop
  - Go host
  - Go server launcher
  - Go update helper
- Old audits, deployment templates, docs, and tests are preserved under `recovered/v0.482.0/` as reference only.
- No old route, contract, alias, compatibility shim, or legacy project identity was overlaid onto modern WIP56 application code.
- Source provenance is recorded in `SOURCE_PROVENANCE.json`.

The recovered native sources are intentionally marked **not forward-ported / not runtime-certified**. Current WIP56 native binaries remain the behavioral reference until source parity is rebuilt and tested.

### Project detail hierarchy overhaul

The Project Overview was reduced from a permanent wall of subsystems into a workspace landing surface.

New hierarchy:

1. Project identity/status header
2. Current work
3. Compact Project pulse
4. Attention + upcoming milestones
5. Collapsible Team & recent activity
6. Collapsible Controls & project data

Removed from the always-visible Overview:

- permanent type-aware operating-model panel
- permanent production-flow panel
- permanent delivery command-center block
- permanent ownership panel
- permanent activity panel
- permanent controls/metadata panels
- workflow handoff block

Workflow handoff now lives under **Plan** as a collapsible secondary section.

### Project header cleanup

- Removed low-value asset-count summary from the header.
- Replaced the large metadata strip with four concise identity facts:
  - target
  - team
  - setup readiness
  - last updated
- Priority remains visible but subordinate to Project identity/status.
- Project action groups now wrap intentionally under constrained widths.

### Responsive behavior

The new Project surfaces include explicit behavior for:

- wide desktop
- narrow desktop
- tablet
- mobile
- long Project names/descriptions
- intrinsic button label sizing
- action wrapping without overlap

### Validation

- 909 active TS/TSX files parsed
- 0 syntax diagnostics
- 488 renderer TS/TSX files checked
- 0 unresolved relative imports
- 105 active CSS files checked
- 0 delimiter errors
- no new non-environment TypeScript diagnostic signatures in modified Project files versus WIP56
- recovered native source kept outside current certification claims

Runtime/DPI certification is still required.

---

## Projects Portfolio + v1 Integration Foundation — Pass 2

### Projects portfolio default surface

- Reduced the permanent portfolio metric strip from seven signals to five high-value signals: Shown, Needs attention, Due soon, Pinned, and Readiness.
- Moved Source, Schedule, and Priority into an explicit **More filters** disclosure with an active-filter count.
- Kept Sort on the primary toolbar.
- Kept Saved Views, analytics, projections, formulas, import/export, and table tooling available rather than deleting power-user capability.
- Simplified Project rows around identity, stage, readiness, status/schedule, health, and direct actions.
- Removed permanent per-row Board counts and tag dumping.
- Comfortable rows retain compact context for priority, people, setup readiness, client, and target date.
- Added responsive behavior for filter disclosure and calmer rows at narrow desktop/tablet/mobile widths.

### Shared workstation source-control contract

Added `packages/shared/src/workstation-source-control-contracts.ts` with protocol version 1 and a source-control-shaped contract for runtime/repository/file status, sync, history, checkout-style operations, commits, locks, diff, and Cluster deep-link actions.

The authority direction is now explicit: **Unreal -> Desktop Workstation service -> Git/Git LFS**. Unreal is not allowed to grow a separate Git executor or credential store.

### Unreal Engine integration foundation

Added `integrations/unreal/ClusterSourceControl` with:

- an Editor-only Unreal plugin descriptor
- Build.cs/module source
- loopback Workstation runtime probe
- initial configuration for Desktop endpoint and binary-asset locking policy
- integration README and parity guardrails

This is a source scaffold, **not yet a registered/certified `ISourceControlProvider`**. Provider state/operations, LFS locking, history/diff, and actual Unreal runtime certification remain required.

### Discord integration foundation

Added `integrations/discord-bot` with:

- application-command manifest
- global/test-guild registration tool
- `/cluster status` and `/cluster help` foundation
- reserved `Create Cluster Ticket` message-context command
- Gateway client using Guilds intent only
- Cluster health client

Ticket creation and private Project operations remain disabled until Discord identity linking can be authorized through Cluster.

### Reconstructed source tooling

Promoted selected historical native build helpers into current `tools/scripts/` under explicitly reconstruction-scoped commands. Added source-reconstruction, integration-foundation, and WIP57 Pass 2 assertion gates. Historical tooling remains reference-only unless deliberately promoted.

### Pass 2 static validation

- 909 active TS/TSX files parsed
- 0 syntax diagnostics
- 488 renderer TS/TSX files checked
- 0 unresolved relative imports
- 105 active CSS files checked
- 0 delimiter errors
- reconstruction audit passed
- integration foundation audit passed
- Unreal/native runtime certification still required
- Project runtime/DPI certification still required



---

## Projects Lifecycle + Workstation Source Modernization — Pass 3

### Project identity and creation

Project creation now treats identity as a first-class v1 contract rather than overloading one display name.

- Added explicit `externalName`, `codename`, and JSON-backed `aliases` / previous names.
- Added Prisma migration #88 for the new Project identity fields.
- Internal Project name remains canonical; public/external naming is separate rather than replacing it.
- The primary Shared Create flow is deliberately short: internal name, purpose/type, Production Profile, and Project Lead.
- External/public name, codename, aliases, status, dates, presets, starter tooling, client metadata, access, and other secondary configuration remain available under Advanced configuration.
- Project data/query/search projections now include the modern identity fields so the additional names are useful rather than decorative schema luggage.

### Project lifecycle boundary

Project terminal states no longer behave like ordinary status-dropdown mutations.

- Added an explicit Project lifecycle endpoint for cancel/reactivate.
- Cancellation requires a reason and emits a dedicated audit/activity event.
- Completion remains owned by the existing Closeout/approval flow.
- Generic Project PATCH rejects direct completion/cancellation transitions and rejects direct reactivation from cancelled state.
- Revision fencing remains in place for lifecycle mutations.
- The Plan workspace now exposes lifecycle actions without turning the Overview back into dashboard soup.

### Native Workstation source-control service

Added `apps/workstation-go` as the forward-port target for modern Desktop/Unreal workstation behavior.

- loopback-only HTTP service using an ephemeral port
- per-launch cryptographically random bearer token
- restrictive per-user discovery record
- explicit protocol/schema versioning
- repository/workspace trust boundaries
- repository discovery/attach/init/status/details/diff/history
- Git mutation operations and cancellable long-running operations
- clone/fetch/pull/push
- Git LFS health/policy/track/prune/locks
- Unreal-oriented checkout/lock operations
- bounded native secret scanning with tests proving detected secret material is not echoed back
- no shell command-string execution path for Git

The Qt Desktop source now has a `WorkstationServiceManager` and the recovered capability broker delegates modern Workstation/Git capabilities to the helper instead of attempting to grow a second Git implementation inside the renderer process.

### Unreal Workstation discovery/security

The Unreal integration no longer assumes a fixed TCP port.

- Reads the per-user Desktop Workstation discovery record.
- Rejects non-loopback endpoints.
- Authenticates requests with the local bearer token.
- Verifies discovery schema and source-control protocol compatibility.
- Keeps Git credentials and Git execution outside Unreal.

The plugin is still **not yet a complete/certified Unreal `ISourceControlProvider`**. State mapping, operation adapters, history/diff surfaces, LFS lock UX, and Unreal runtime certification remain Pass 4 work.

### Discord production authority

The Discord work moved beyond a transport-only scaffold while preserving Cluster as the authority.

- Server-side Discord production service owns protected command/action authorization.
- Linked Discord identities are resolved to Cluster users before Project-private work.
- Message-context Ticket creation is permission checked and idempotently linked to its Discord source message.
- `/cluster status` is Project/channel scoped and permission checked.
- Inbound interactions use durable inbox/action-receipt records.
- Outbound Project routes support event-class/priority filtering and delivery evidence.
- Gateway sidecar now acts only as a transport relay to Cluster.
- Gateway relay uses a separate 32+ character shared secret and a self-authenticated server endpoint.
- No privileged Gateway intents are required.

### Source/toolchain modernization

Recovered source is now being upgraded while it is promoted.

- Added machine-readable `config/toolchain-versions.json` and `npm run toolchain:check` drift enforcement.
- Official native rebuild baseline: Go 1.27 language line, Qt 6.11.2, CMake 3.31+ with policy compatibility through 4.4, C++20.
- Current private runtime constants were forward-ported into source: Node 24.20.0 and PostgreSQL 18.6-1.
- Go release scripts use `GOTOOLCHAIN=local`, `-trimpath`, and disabled VCS stamping so packaging does not silently download compilers or bake local paths into binaries.
- Recovered Qt Desktop deliberately remains versioned `0.482.0` until native behavior parity and runtime certification are actually complete.

### Pass 3 validation

- 910 active TS/TSX files parsed
- 0 syntax diagnostics
- 488 renderer TS/TSX files checked
- 0 unresolved relative imports
- 105 active CSS files checked
- 0 delimiter errors
- 44/44 Pass 3 targeted assertions
- source-reconstruction audit passed
- integration-foundation audit passed
- toolchain drift check passed
- Workstation Go tests passed under a temporary Go 1.23 compatibility compile in this environment
- recovered Host and Update Helper Go packages passed compatibility compilation/tests
- recovered Server Launcher passed a Windows cross-build compatibility compile
- official Go 1.27 / Qt 6.11.2 native release builds are still required outside this environment
- runtime/DPI/native/Unreal certification is still required

---

## Unreal Provider + Workstation SCM Contract + UI Action Hardening — Pass 4

### Unreal Engine source-control provider

The Unreal integration has moved from an authenticated transport scaffold to a real provider-shaped source implementation.

- Added `FClusterSourceControlProvider : ISourceControlProvider` and registered it through Unreal modular features.
- Added a Workstation-backed `ISourceControlState` implementation for clean/untracked/added/modified/deleted/renamed/conflicted/ignored state.
- Maps Git LFS lock ownership into Unreal checkout semantics without making Unreal a Git authority.
- Added Workstation-backed Connect, Update Status, Add, Delete, Revert, Check Out, Check In, and Sync paths.
- Check Out requests LFS locking only for lockable assets.
- Revert and successful check-in release locks owned by the current workstation when appropriate.
- No Git credentials or direct Git process execution were added to the Unreal plugin.
- Updated the provider interface for Unreal Engine 5.8 API changes, including the 5.8 final-method boundary and required change-state/source-control methods.

This is **source implementation, not UE 5.8 runtime certification**. The current environment does not contain the Unreal 5.8 editor/toolchain, so a real plugin build and two-workstation runtime test remain hard v1 gates.

### Workstation source-control protocol hardening

- Added `repository.resolve` so Unreal can resolve the most-specific trusted Desktop repository containing the active `.uproject` rather than guessing a repository identifier.
- Repository resolution does not expose raw repository authority outside the authenticated local Workstation boundary.
- Explicitly requested files now receive a source-control state even when clean.
- File-state projections now carry tracked, ignored, binary, lockable, and lock-owner information.
- Added tests for nested trusted repository selection and clean requested-file state.

### Shared action / DPI hardening

- Shared dialog footers now wrap instead of allowing actions to collide.
- Shared action groups and toolbars are bounded to their container width and keep explicit wrapping behavior.
- Shared buttons keep intrinsic desktop sizing while phone-width text actions may wrap instead of shrinking into unreadable slivers or overlapping neighbors.
- Icon buttons retain fixed hit-target geometry.

Real 100% / 125% / 150% Windows DPI testing is still required. Static CSS cannot observe a monitor, tragically.

### Pass 4 validation

- 910 active TS/TSX files parsed
- 0 syntax diagnostics
- 488 renderer TS/TSX files checked
- 0 unresolved relative imports
- 105 active CSS files checked
- 0 delimiter errors
- 88 Prisma migrations (unchanged from Pass 3)
- 36/36 Pass 4 targeted assertions
- source-reconstruction audit passed
- integration-foundation audit passed
- toolchain drift check passed
- Workstation Go tests passed under the available Go 1.23 compatibility compiler with the declared Go 1.27 line restored afterward
- official Go 1.27 / Qt 6.11.2 / Unreal 5.8 native certification remains required

---

## Project Snapshot Convergence + Workstation SCM Operations — Pass 5

### Canonical Project Snapshot authority

Pass 5 introduces one compact, permission-aware Project projection for cross-workspace summary facts instead of allowing every renderer surface to independently calculate readiness, schedule, and health.

- Added `ClusterProjectSnapshot` schema 1 in `@cluster/shared`.
- Added a request-aware server Project Snapshot service.
- Snapshot identity distinguishes internal, external/public, codename, and external-safe display identity.
- External collaborators do not receive internal Project names or codenames through the snapshot.
- The legacy Project collection serializer was hardened at the same boundary so the older summary cannot leak the fields the new snapshot intentionally hides.
- Snapshot readiness is permission-aware and only scores setup checks the requesting user is allowed to know about.
- Calendar projection uses the canonical Calendar visibility evaluator.
- Build/QA health uses compact aggregates rather than returning raw child resources.
- Snapshot includes compact lead/team, schedule, next milestone, next visible Calendar item, delivery, readiness, and health signals.

The same snapshot now feeds:

1. Projects Portfolio
2. Project Detail / Overview
3. Home Project widgets/briefing
4. My Work assigned Projects
5. Operations Project diagnostics

Detailed Project Overview resource data remains independently permission-filtered. The snapshot is a cross-surface summary authority, not a replacement for detailed resource endpoints.

### Desktop Workstation SCM operation lifecycle

The canonical Workstation source-control protocol now exposes the existing native background-operation engine instead of forcing future Unreal/Desktop clients to block on long Git operations.

- Added `operation.start`, `operation.status`, and `operation.cancel`.
- Async source-control operations are repository-scoped.
- Cancellation uses the operation context and cannot cancel a different repository's operation.
- Supported initial asynchronous work includes repository fetch/pull/push and commit/push workflows.
- `repository.resolve` is now truthfully advertised in runtime capabilities.
- Git remains invoked through structured argument arrays rather than shell command strings.

### Asset history and revision-aware diff

Workstation SCM now exposes the primitives required for Unreal revision/history integration without teaching Unreal how to execute Git.

- Repository history can be scoped to requested paths.
- Single-path history uses Git follow semantics for rename-aware asset history.
- Diff supports validated base/target revisions as well as staged/working-tree diff.
- Revision input rejects option-like or whitespace-bearing arguments before Git invocation.
- Added Workstation tests for path-scoped history, revision-pair diff, and revision validation.

The Unreal provider does not yet expose a complete `ISourceControlRevision` adapter. Pass 5 makes the canonical Workstation capability available for that next provider layer.

### Discord delivery diagnostics hardening

The existing server-authoritative Discord implementation already provided identity authorization, Project/channel routes, Ticket creation, durable action receipts, outbound delivery receipts, retries, and failed-delivery inspection. Pass 5 extends the operational evidence rather than creating a parallel bot stack.

- Delivery summaries distinguish retrying failures from dead-letter failures.
- Failures at/above the configured attempt ceiling are explicitly counted as dead-letter work.
- Manual retry remains an admin-authorized durable background job.
- The Gateway relay still uses zero privileged intents.

### Pass 5 validation

- 911 active TS/TSX files parsed
- 0 syntax diagnostics
- 488 renderer TS/TSX files checked
- 0 unresolved relative imports
- 105 active CSS files checked
- 0 delimiter errors
- 88 Prisma migrations (unchanged from Pass 4)
- 45/45 Pass 5 targeted assertions
- Pass 4 assertions retained: 36/36
- source-reconstruction audit passed
- integration-foundation audit passed
- toolchain drift check passed
- Workstation Go tests passed under a temporary Go 1.23 compatibility language line; the declared Go 1.27 requirement was restored immediately afterward
- official Go 1.27 / Qt 6.11.2 / Unreal 5.8 build/runtime certification remains required
- current native Windows launcher/host binaries remain the behavioral reference until promoted source is officially rebuilt and certified

---

## Unreal Async Operations + Revision Adapter + Desktop SCM Bridge — Pass 6

### Unreal async operation lifecycle

Long-running Unreal source-control work no longer needs to block the editor on synchronous Git work.

- Added a thread-safe Unreal pending-command queue backed by Workstation source-control operations.
- Check In / Sync can start native Workstation operations, poll status outside the editor thread, and complete through the provider `Tick()` path.
- Unreal cancellation is mapped to Workstation `operation.cancel`.
- Workstation timeout/failure/cancel states are returned as explicit Unreal command results.
- The provider still contains no direct Git process execution or Git credential storage.

### Unreal revision/history adapter

- Added `FClusterSourceControlRevision : ISourceControlRevision`.
- Source-control states now own revision history and support numeric/string revision lookup plus current-revision projection.
- Update Status honors Unreal history requests and hydrates path-aware history from Workstation.
- Added Workstation `revision.materialize` to retrieve exact revision bytes into a protected local cache.
- Revision materialization validates revision/path input, uses structured Git arguments, and does not invoke a shell.
- The Unreal revision object asks Workstation to materialize content rather than running Git itself.

### Unreal Engine 5.8 initialization modernization

- Added the current UE 5.8 `FInitResult Init(EInitFlags)` provider path.
- Connection attempt semantics follow the requested initialization flags.
- Initialization returns provider availability and the current provider connection/status settings.
- The legacy `Init(bool)` overload remains implemented for the public provider interface.

### Native Desktop source-control convergence

- Qt `WorkstationServiceManager` now exposes a canonical authenticated source-control action bridge.
- Native Desktop and Unreal can therefore share the same Workstation protocol boundary rather than growing separate Git transports.
- The Qt source version remains on the explicit `0.482.0` parity hold until official rebuild/runtime certification succeeds.

### Pass 6 validation

- 911 active TS/TSX files parsed
- 0 syntax diagnostics
- 488 renderer TS/TSX files checked
- 0 unresolved relative imports
- 105 active CSS files checked
- 0 delimiter errors
- 88 Prisma migrations (unchanged)
- 38/38 Pass 6 targeted assertions
- Pass 4 regression assertions: 36/36
- Pass 5 regression assertions: 45/45
- source-reconstruction audit passed
- integration-foundation audit passed
- toolchain drift check passed
- Workstation Go tests passed under the available Go 1.23 compatibility compiler with the declared Go 1.27 line restored immediately afterward
- official Go 1.27 / Qt 6.11.2 / Unreal Engine 5.8 build/runtime certification remains required



---

## Desktop Workstation Event Feed + Discord Lifecycle Hardening — Pass 7

### Desktop / Workstation parity modernization

- Kept the shared React Desktop workspace as the one source-control UI instead of creating a duplicate native QML Git workspace.
- Added an asynchronous active-operation monitor to `WorkstationServiceManager`.
- Native monitoring runs only while Git operations are queued/running/cancelling, emits `workstation.operations.changed`, and stops when the queue reaches terminal state.
- The monitor uses bounded retry on helper failure rather than permanent idle polling.
- Renderer operation reconciliation changed from a 2-second active poll to native events plus a 15-second safety refresh; idle reconciliation is now 60 seconds.
- Runtime metadata advertises `workstationOperationEvents`.

### Workstation progress contract

Background Git work now reports useful stages rather than a generic running state.

Examples include:

- clone planning / cloning / repository registration / finalization
- fetch / pull / push
- LFS fetch / checkout / lock / unlock
- staging / commit / optional push / finalization

Progress remains bounded below 100 until the operation is actually terminal.

### Discord runtime hardening

- Linked Discord identities must resolve to an `ACTIVE`, unexpired Cluster user before protected Discord actions execute.
- Suspended, disabled, privacy-erased, archived, or expired identities cannot retain Discord-side access merely because the Discord link still exists.
- Discord channel routes now require the routed Project itself to remain unarchived.
- Gateway relay authentication supports an optional `CLUSTER_DISCORD_RELAY_TOKEN_PREVIOUS` rotation window while preserving timing-safe token comparison.
- Previous relay tokens are documented as temporary, server-side-only rotation state.

### Certification boundary

Pass 7 still does **not** lift the native parity hold. Official Go 1.27, Qt 6.11.2, Windows lifecycle/DPI, Unreal Engine 5.8, two-workstation LFS, and live Discord guild certification remain required.


---

## Native Parity + Private Git Runtime Hardening — Pass 8

### Workstation build identity/integrity

- Pinned the official Go source floor to **1.27.1**.
- Workstation release builds now produce a companion integrity manifest containing Cluster runtime version, Workstation protocol, Go toolchain identity, artifact byte length, and SHA-256 for Windows/Linux helpers.
- Added `native:workstation:verify` to verify produced helper artifacts against that manifest.
- Workstation exposes deterministic `--version` output and `/health` now includes schema/protocol/version identity.

### Qt / Workstation runtime parity

- Qt now distinguishes the historical Desktop source version hold (`0.482.0`) from the current Cluster runtime version (`0.505.0`).
- Workstation discovery records with the wrong runtime version are rejected.
- Existing discovery endpoints are health-probed before Desktop reuses them.
- Desktop validates Workstation manifest version/protocol and SHA-256 before launching the helper.
- CMake rejects Workstation helper/version/protocol drift during packaging.

### Private Git runtime

- Pinned Windows release baselines: Git for Windows **2.56.0** and Git LFS **3.8.0**.
- Workstation now prefers a private runtime beside Desktop, reports bundled/system/explicit runtime provenance, and keeps system Git as a development/recovery fallback.
- Windows release packaging requires the private Git + Git LFS runtime.
- Added private-runtime verification to the Desktop packaging path.
- Removed stale Qt setup requirements for unused Multimedia/Pdf modules.

### Certification boundary

Pass 8 does **not** lift the native certification hold. This environment cannot install the official Go 1.27.1/Qt 6.11.2 Windows toolchains or run UE 5.8/Windows process/DPI tests. The source now fails earlier and more explicitly when the official packaging/runtime pieces are absent or mismatched.

## Visual Foundation / Appearance Authority — Pass 9

### Canonical visual resolution

- Added a dedicated renderer visual resolver and `EffectiveVisualContext` instead of continuing to interpret appearance settings independently inside shell/bootstrap code.
- Background **base** and **pattern** are now separate appearance parameters.
- Added first-class procedural background patterns: none, hex, grid, and dots, with restrained intensity and scale controls.
- Added canonical shell surface parameters for Sidebar and Taskbar plus Project-tab style and real Taskbar-label behavior.
- Accessibility transparency constraints now resolve glass requests to safe opaque/outlined equivalents before components consume them.
- Canonical visual CSS variables/datasets feed the existing shell while the remaining component CSS is migrated.

### Appearance settings convergence

- Appearance now edits background base, pattern, pattern intensity/scale, panel surface, Sidebar/Taskbar surface, Taskbar labels, Project tab style, density, typography, and canonical motion preference from one visual section.
- Fixed a preference-contract mismatch where the renderer exposed `dense` interface density but the server validator rejected it.
- Taskbar label preference is no longer decorative; the Taskbar consumes Auto / Always / Icons modes.

### Shell first slice

- Removed the giant Home Resume/Clear card from active Dashboard markup.
- Back/Forward navigation is now available in the persistent Taskbar rather than being Desktop-only.
- Previous-work recovery is projected through compact Taskbar chrome beside navigation history, with resume and clear actions.
- Added compact/narrow Taskbar behavior for the recovery projection.

### Validation

- 29/29 Pass 9 Visual Foundation assertions passed.
- Pass 4 regression assertions: 36/36.
- Pass 5 regression assertions: 45/45.
- Pass 6 regression assertions: 38/38.
- Pass 7 regression assertions: 26/26.
- Pass 8 regression assertions: 29/29.
- Full `verify:source-foundation` passed.
- Source reconstruction and integration foundation audits passed.

### Boundary

This is the **first** Visual Foundation checkpoint, not the completed appearance overhaul. The next visual slice should decompose Sidebar/Taskbar composition primitives, retire superseded shell CSS/override fossils, and strengthen the parent/instance visual contract before Library 2.0 begins. The broader parent/child/instance architecture discussed for other Cluster domains remains documented direction, not v1 refactor scope.

## Visual Foundation + Shell 2.0 + Library Explorer — Pass 10

Pass 10 deliberately combines a larger visual/shell slice with the first structural Library 2.0 work. It does not claim runtime or DPI certification.

### Shell 2.0

- Added shared shell composition primitives for the Taskbar, Sidebar sections/navigation, and Project rows.
- Split Project-tab behavior into `TaskbarProjectTabs` and history/recovery into `TaskbarHistory` instead of continuing to grow the application taskbar monolith.
- `ApplicationProjectTabs.tsx` is reduced from the Pass 9 ~924-line state to ~834 lines; `ApplicationSidebar.tsx` is reduced from ~209 to ~175 lines while preserving existing behavior.
- Project tabs now have a canonical visual layer, an overflow menu, compact/standard presentation hooks, health/pin state, keyboard tab navigation, and action menus.
- Sidebar rows now consume canonical navigation/project composition primitives while old behavioral classes remain temporarily for unmigrated shell surfaces.

### Appearance parent/instance hardening

- Added `CLUSTER_VISUAL_MASTER`, `VisualInstanceLayer`, exposed visual-instance parameters, and `resolveVisualInstance()`.
- Runtime `EffectiveVisualContext` now resolves through the master visual instance before accessibility constraints are applied.
- Added a live Appearance shell preview showing the effective Sidebar, Taskbar, workspace, surfaces, controls, density, pattern, and shell treatments in context.
- Accessibility remains the final constraint layer rather than a competing appearance authority.

### Shared inspector/layout repair

- Fixed the shared `ClusterMasterDetail` empty state so a closed Inspector actually removes its grid track and hides the empty detail pane.
- This repairs the Library dead-column issue at the primitive level and benefits other master/detail workspaces using the same primitive.
- `ClusterResizableRail` now has a real collapsed state that removes the rail and resize track instead of merely hiding content inside reserved width.

### Library 2.0 structural slice

- Removed the fixed viewport-height Library browser assumption. The Library now participates in normal page/document scrolling.
- Removed the fixed-height virtual-list surface; loaded list rows render into the document and use browser `content-visibility` hints instead.
- Added automatic cursor pagination using an IntersectionObserver sentinel near the bottom of the document, with an explicit manual Load More recovery action.
- Grid layout now uses available container width with `auto-fill/minmax`, so closing the Explorer or Inspector immediately yields more tiles.
- Added a collapsible Library Explorer with persistent independent states for Views, Collections, and Folders plus a full Explorer hide/show control.
- The Explorer rail is sticky on desktop rather than forcing the entire Library into nested scrolling.

### Collections expansion

- Manual Collections and Smart Collections remain distinct.
- Smart Collections can still be created from the current Library filters/sort.
- Existing Collections can now be renamed or removed from Explorer actions.
- Smart Collections can replace their rule set from the current Library view.
- Collection edits use the existing revision fencing contract.
- Removing a Collection does not delete Library items.

### Pass 10 source validation

- 917 active TS/TSX files parsed with 0 parser diagnostics.
- 493 renderer TS/TSX files checked with 0 unresolved relative imports.
- 107 active CSS files checked with 0 delimiter errors.
- 88 Prisma migrations, unchanged.
- Pass 10 targeted assertions: 39/39.
- Full source-foundation regression remains green through Passes 4–10.
- Native runtime certification, browser visual verification, Windows DPI certification, and Media Viewer/Transfer runtime work remain required.

## Library Organization + Media Pipeline + Shell Fossil Retirement — Pass 11

Pass 11 keeps the larger-pass cadence and combines Library organization, the actual Library-to-unified-viewer resource path, Media Viewer shell cleanup, and another shell migration slice. Runtime/browser certification is still required before calling the media bug closed on packaged Windows.

### Library organization and search

- Added persisted per-folder `manualOrder` plus migration #89 and an indexed custom-order path.
- Added a server-authoritative same-folder reorder endpoint with edit checks, revision increments, cache invalidation, and activity evidence.
- Custom ordering is only draggable in an unambiguous folder view: Custom sort, no active search, and no grouping.
- Added four first-class Library layouts: Grid, Compact Grid, List, and Details.
- Added grouping by file/media type, Project, and review state.
- Added persistent search scope: current folder, folder + descendants, current Project, or entire Library.
- Added first-class tag filtering and expanded text search across title/body/tags/original filename/external URL/metadata.
- Saved Library views now preserve layout, grouping, search scope, filters, query, and sort.
- Fixed Project collaboration projection so a selected Library item passes its actual `projectId` rather than the Library item ID.

### Unified media resource repair

- Library `viewable-resource` now supplies current ready `LibraryDerivative` records to the canonical unified-viewer contract instead of always returning an empty derivative inventory.
- Derivative exposure is fenced to the current source checksum when one exists, preventing stale generated media from becoming the preferred viewer source.
- Added canonical Library derivative -> `ViewableResourceDerivative` mapping and medium-aware preferred derivative selection for video, image, audio, and 3D.
- Library derivative bytes now use the shared `sendStoredResource()` delivery path, gaining the same Range/ETag/private-cache behavior used by canonical stored resources. This is required for seekable audio/video derivatives.
- Managed derivative-root validation remains enforced before file delivery.

### Media Viewer polish

- The Library viewer now opens media-first: the sibling-file rail and metadata context are collapsed by default instead of stealing stage space.
- Added an explicit Details control for Project/status/version/review context.
- Fixed contradictory viewer grid definitions where markup had toolbar + context + workspace but a later stylesheet declared only two rows. The viewer now has explicit two-row and details-expanded three-row contracts.
- Viewer details reset when switching assets so state from one file does not unexpectedly carry into another.

### Shell CSS migration

- Active Sidebar markup is now free of version-stamped presentation classes and consumes the canonical Shell 2.0 layer.
- Primary Taskbar actions now use canonical `cluster-taskbar-action` composition classes for icon, label, badge, and hotkey presentation.
- The retired primary action/label/icon classes are no longer dependencies of active Taskbar action chrome.
- `shell-v2.css` remains free of `!important`; legacy popup/account/ticket internals remain intentionally staged for later migration instead of being wholesale-deleted while still active.

### Pass 11 source validation

- 917 active TS/TSX files parsed with 0 parser diagnostics.
- 493 renderer TS/TSX files checked with 0 unresolved relative imports.
- 107 active CSS files checked with 0 delimiter errors.
- 89 Prisma migrations.
- Pass 11 targeted assertions: 43/43.
- Full source-foundation regression remains green through Passes 4–11.
- Native binaries are not rebuilt by this renderer/server source pass; Windows/DPI/media runtime certification remains required.

## Pass 12 — Transfer Center + Projects 2.0 State Separation

### Global Transfer Center

- Added a first-class Taskbar Transfer Center.
- Projects durable browser uploads and native Desktop uploads/downloads into one global queue projection.
- Exposes pause/resume/retry/remove/cancel controls through the canonical runtimes instead of inventing a third transfer engine.
- Retry-all spans browser offline uploads and native Desktop transfers.
- Taskbar chrome shows upload/download counts and native aggregate progress when measurable.
- Server offline/unreachable/maintenance/draining/restarting/recovery/read-only/incompatible posture is surfaced as held work rather than a generic transfer failure.
- Transfer presentation lives in canonical Shell 2.0 styling with no new `!important` override layer.

### Projects 2.0 — first structural slice

- Project Snapshot health now distinguishes `healthy`, `attention`, `at_risk`, and `blocked`.
- Health thresholds separate ordinary attention from genuine delivery risk and hard blocking conditions.
- Home and My Work consume the new canonical `at_risk` state.
- Project Overview now explicitly separates Lifecycle, Production Phase, Health, Owner, and Integrations before the current-work surface.
- Production Phase derives from the existing Project Control phase records instead of creating another phase field.
- Integration count derives from existing Project integration bindings.
- Fixed the Overview action that attempted to open a nonexistent `connections` Project tab; it now targets the canonical `links` tool.
- The Project `links` workspace is now presented to users as **Integrations**.

### Validation

- Full `verify:source-foundation` passes through Pass 12.
- Pass 12 targeted assertions: 20/20.
- Passes 4–11 remain green.
- Runtime certification is still required for Taskbar transfer interaction, real transfer pause/resume/recovery, Project health presentation, and DPI/responsive behavior.

## Pass 13 — Library Explorer + Projects Readiness Polish

### Library Explorer

- Folder expansion state is now persisted as user state instead of resetting every time the workspace remounts.
- Added explicit **Expand all / Collapse all** controls to the folder tree.
- Expand-all follows the actual nested folder graph and includes file-bearing folders when tree files are enabled.
- Collapse-all retains the Library root so the explorer never collapses into an unusable blank state.
- Added dedicated tree-toolbar styling without creating another fixed scroll container.

### Projects 2.0 polish

- Project Plan now receives the same canonical setup checklist used by Project readiness.
- Plan renders an actionable readiness surface with percentage, completed count, and per-check Ready/Required state.
- Project Integrations workspace now uses Integrations terminology consistently in headers and save/status messaging.
- Portfolio now consumes the canonical `at_risk` Project Snapshot state alongside Home, My Work, and Project Overview.

### Validation

- Pass 13 targeted assertions: 14/14.
- Full `verify:source-foundation` passes through Pass 13.
- No Prisma migration was added in this pass.
- Runtime visual/DPI and real transfer/media certification remain required.

## P16A — Capability Exposure: Library Lifecycle + Access Explanation

P16A exposes mature server authority instead of creating parallel feature state.

- Library Inspector gains a first-class Lifecycle surface for backlinks, retention, holds, destruction evidence, restore, and guarded permanent destruction.
- Project Access uses `/api/access/explain` for authoritative allow/deny reasoning and contributing rules instead of local guessed previews.
- Destructive Library flows remain permission/PIN/evidence aware.
- P16A source gate: 12/12.

## P16B — Workforce Availability Exceptions + Naming Contract

P16B exposes canonical workforce availability exceptions and makes them useful outside the People page.

- People supports unavailable, limited, preferred, and time-off windows.
- Self-service, direct-manager, and elevated management authorization share one server policy.
- Reasons are privacy projected rather than leaked to ordinary viewers.
- Scheduler conflict/readiness consumes the same exception authority; preferred windows are positive planning signals rather than fake conflicts.
- Canonical checkpoint/artifact naming becomes explicit from P16B forward. New artifacts use `v0.505.0 · RC17 · WIP57 · Pxx` identity layers and retire `Phase10` from new filenames.
- P16B source gate: 13/13; naming gate: 8/8.

## P16C — Capability Exposure Closeout

P16C finishes the bounded launch-useful capability exposure work before runtime certification.

- Project Control exposes the canonical Project workflow/resource graph with focus, direction, bounded depth, relationship evidence, and no new graph persistence authority.
- Safe Share, Strip All, and Custom sanitized Viewer exports preview retained/removed/redacted metadata before derivative generation.
- Standard metadata previews are authorized by derivative-export capability; custom category choice remains manage-gated.
- Admin Data/Audit gains an authoritative audit-activity stream with actor, action, resource, exact resource ID, Project, and time filters plus evidence metadata.
- `/api/audit/activity` now honors the already-declared exact `entityId` filter, supports `from`/`to`, and returns actor/Project context needed by the admin evidence surface.
- Active engineering checkpoint advances to `v0.505.0 · RC17 · WIP57 · P16C` / `0.505.0-rc.17+work.wip57.p16c` without invalidating historical P16B gates.
- P16C source gate: 15/15.

### P16 boundary

P16 remains an exposure/consolidation pass. It does not claim Windows runtime, fresh PostgreSQL, DPI, multi-user, process-tree, or request-count certification. Those are P17 gates.
