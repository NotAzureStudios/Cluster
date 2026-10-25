# Cluster v0.505.0 RC17 WIP57 Source Reconstruction

This tree is reconstructed from two inputs:

- **Canonical modern application source:** RC17 WIP56 Windows Lean `app/bootstrap`.
- **Recovered source-only foundation:** Cluster Master v0.482.0 source archive.

## Authority rules

1. WIP56 wins for all overlapping TypeScript/TSX/CSS/Prisma/server/web/shared paths.
2. Recovered v0.482.0 code must not reintroduce removed aliases, compatibility shims, old project-type identities, deprecated routes, or duplicate data authority.
3. Native source families missing from the lean package are restored under `apps/` so future work can forward-port and recertify them:
   - `apps/desktop-qt`
   - `apps/host-go`
   - `apps/server-launcher-go`
   - `apps/update-helper-go`
4. The old toolchain, deployment templates, docs, audits, and tests are retained under `recovered/v0.482.0/` as reference only. They are **not** current certification evidence and are not wired into the active root package scripts.
5. Current native binaries from WIP56 remain the behavioral reference until recovered native source is forward-ported and runtime-tested.

## WIP57 direction

The first active product change on this reconstructed master is the Project workspace overhaul: reduce permanent dashboard bulk, keep current work prominent, keep tools reachable through compact navigation, and move secondary/history/governance information deeper without changing authorization or data authority.

## WIP57 Pass 2 active reconstruction

Selected v0.482 build helpers have now been promoted into `tools/scripts/` under explicitly reconstruction-scoped commands. They remain provisional until they successfully build source-parity native artifacts. The historical originals remain under `recovered/v0.482.0/`.

New v1 integration source lives under:

- `integrations/unreal/ClusterSourceControl` — Unreal Editor source-control provider foundation.
- `integrations/discord-bot` — Discord application/bot foundation.
- `packages/shared/src/workstation-source-control-contracts.ts` — canonical Unreal/Desktop workstation SCM wire contract.

The intended source-control authority is **Unreal Editor → Cluster Desktop Workstation service → Git/Git LFS**. Unreal must not become a second independent Git executor or credential store. The recovered Qt source does not yet implement the current Workstation/Git capability set present in the modern renderer contracts; that gap is now a required native forward-port task.

Discord is an interface to Cluster, not an authority. The Pass 2 bot uses application commands with only the Guilds gateway intent and keeps private/write operations gated until Discord identity linking can be evaluated through Cluster authorization.



## WIP57 Pass 3 modernization

The reconstruction is now capability-forward-porting instead of merely preserving recovered source.

- Added `apps/workstation-go` as a dedicated native Workstation/Git/LFS broker.
- Added Qt `WorkstationServiceManager` source and capability-broker delegation into the helper.
- Added a machine-readable toolchain contract and drift checker.
- Forward-ported current release runtime pins into the recovered launcher source.
- Promoted Project identity/lifecycle changes into the canonical modern application tree, including Prisma migration #88.
- Extended the Discord integration so the Cluster server owns authorization/idempotency while the Gateway process remains a transport-only sidecar.
- Hardened Unreal discovery around authenticated ephemeral loopback rather than a fixed port.

Recovered native source is still not called parity-complete. The Qt application keeps its historical 0.482.0 project version until a current toolchain build, native capability comparison, Windows process/DPI validation, and integration runtime pass succeed.

## WIP57 Pass 4 source promotion

Source reconstruction now includes the first full Unreal `ISourceControlProvider` implementation backed exclusively by the dedicated Workstation SCM service. The Workstation protocol gained trusted repository resolution from a project path and complete requested-file states so the Unreal editor does not need repository discovery logic or a second Git implementation.

The source-authority rule remains unchanged: recovered/native source is promoted capability by capability, with current runtime binaries retained until the promoted source is built using the declared official toolchain and passes behavioral parity. Qt Desktop therefore remains on the explicit `0.482.0` version hold.

## WIP57 Pass 5 source convergence

The reconstructed source now owns a canonical cross-workspace `ProjectSnapshot` projection rather than allowing Portfolio, Project Detail, Home, My Work, and Operations to derive the same readiness/health/schedule facts independently. The projection is request-aware, external-safe, and reuses canonical Calendar visibility.

The dedicated Workstation source-control service has also moved beyond synchronous request/response primitives. Its canonical protocol now exposes repository-scoped background operation start/status/cancel plus path-aware history and validated revision-aware diff. These capabilities are intentionally implemented in the Workstation broker so Unreal and Qt/Desktop can share one Git/LFS authority.

This does not remove the native parity hold. Official Go 1.27, Qt 6.11.2, Windows process/DPI, and Unreal 5.8 certification are still required before promoted native source replaces the current behavioral-reference binaries.

## WIP57 Pass 6 source modernization

The reconstructed native/integration source now promotes the Unreal provider onto the Workstation background-operation and revision primitives instead of leaving the editor adapter synchronous.

- Unreal Check In / Sync can use the authenticated Workstation `operation.start` / `operation.status` / `operation.cancel` lifecycle, with completion returned to Unreal from provider `Tick()` rather than blocking the editor thread.
- Added a real `ISourceControlRevision` adapter and state-owned revision history.
- Added Workstation `revision.materialize`, which validates the Git revision/path, writes exact revision content into a protected per-user revision cache, and never invokes a shell.
- Added the Unreal Engine 5.8 `FInitResult Init(EInitFlags)` provider path while retaining the legacy initialization overload required by the public interface.
- Promoted a canonical Qt `WorkstationServiceManager::requestSourceControlAction` bridge so future native Desktop Git UI uses the same authenticated loopback source-control protocol as Unreal.

The parity hold remains deliberate. These source capabilities do not replace the current behavioral-reference native binaries until official Go 1.27, Qt 6.11.2, Windows, and Unreal Engine 5.8 compile/runtime certification succeeds.



## Pass 7 promotion rule

Pass 7 continues the source-forward rule: promote modern behavior into the reconstructed native source only when it preserves one canonical authority. Desktop source-control progress/events are therefore implemented as a Qt host bridge over Workstation, not as native Git execution. Discord lifecycle hardening remains server-authoritative. The Qt/Desktop version hold remains `0.482.0` until official native build and runtime parity succeeds.


## WIP57 Pass 8 native parity hardening

Pass 8 turns native parity into an explicit build/runtime identity contract instead of trusting adjacent binaries by filename. Official Workstation builds now produce a version/protocol/toolchain/SHA-256 manifest; Qt verifies that manifest and helper hash before launch, rejects discovery records from the wrong Cluster runtime, and health-probes existing discovery endpoints before reuse.

Desktop source-control packaging also now treats Git itself as part of the product runtime. The Workstation broker prefers a private Git/Git LFS runtime staged beside Desktop and exposes only runtime provenance (`bundled`, `system`, `explicit`, `unavailable`) rather than executable paths. System Git remains a development/recovery fallback. Official Windows package generation is required to stage the pinned private runtime rather than depend on arbitrary PATH state.

The Desktop `0.482.0` source-version hold remains intact. Pass 8 improves reproducibility and clean-machine readiness, but official Go 1.27.1, Qt 6.11.2, Windows process/DPI, Unreal 5.8, and two-workstation LFS certification are still required before parity is declared.

## WIP57 Pass 9 visual authority reconstruction

Pass 9 begins the bounded pre-v1 visual overhaul without changing the native parity boundary. Renderer appearance resolution now has a dedicated `EffectiveVisualContext` authority, background base/pattern configuration is separated, shell surface/taskbar presentation settings resolve through the same path, and accessibility constraints are applied before visual parameters reach components.

The first Shell slice moves Back/Forward and previous-work recovery into compact persistent Taskbar chrome and removes the oversized Home resume card. A procedural Hex pattern joins Grid/Dots/None as a first-class workspace pattern. This is intentionally a source-foundation checkpoint: Sidebar/Taskbar composition primitives and legacy shell CSS fossil removal remain next, followed by the bounded Library 2.0 and Projects 2.0 work documented in `V1_VISUAL_LIBRARY_PROJECTS_POLISH_PLAN.md`.

The Desktop `0.482.0` source-version hold and all Pass 8 native/Unreal/Discord certification boundaries remain unchanged.

## WIP57 Pass 10 checkpoint

The reconstructed master now carries the second visual-polish slice: a real visual master/instance resolver, Shell 2.0 composition primitives, extracted Taskbar history/Project-tab components, live Appearance preview, a shared closed-Inspector grid repair, and the first Library 2.0 explorer/document-scroll/auto-pagination/Collections work.

This remains source readiness only. The modern renderer changes must still be exercised in the packaged Windows runtime at 100/125/150% DPI, and the recovered Qt/Desktop native source remains on its 0.482.0 parity hold.

## WIP57 Pass 11 checkpoint

Library 2.0 now owns first-class manual folder ordering, four layout modes, grouping, saved search scope, tag-aware organization, and server-backed descendant/Project/global search instead of relying on a stripped-down file-picker presentation. The Library -> unified-viewer boundary now carries current generated derivatives and serves derivative bytes through the canonical range-capable stored-resource path.

The active Sidebar and primary Taskbar action chrome have also moved farther onto stable Shell 2.0 composition classes. Legacy popup/account/Ticket styles are deliberately retained only while their markup remains active; this pass does not delete live fallback CSS merely to improve a grep result.

These are source-level repairs. Packaged Windows media playback/seeking, Library ordering, responsive/DPI behavior, and stale-derivative fallback still require runtime certification.
