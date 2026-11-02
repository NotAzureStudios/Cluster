# Cluster 1.0 client lanes and release integration

> **Status:** Repository coordination policy. Creating a branch does not split the executable, certify a release, or alter a deployed Cluster installation.

## Current authoritative baseline

- Private source: `NotAzureStudios/Cluster`.
- `development`: active source integration branch and required PR destination.
- `main`: reviewed baseline, GitHub default branch.
- Tracked release identity remains **1.0.0-rc.50** / source **0.546.0** at the time of this branch setup.
- External RC73/RC74 archives have **not** been imported or reconciled. Do not rename the Git revision RC74 or install it on a server just because a later archive exists.
- `ReleaseCanidate` is a historical, misspelled branch behind `main`; keep it untouched until retention/cleanup is explicitly approved.

## Active component work lanes

All four lanes originate from `development`. They are **parallel work lanes inside one monorepo**, not separately versioned products.

| Branch | Owning area | Key paths | Boundary |
| --- | --- | --- | --- |
| `client/web` | Browser, mobile/tablet-responsive web, external portal presentation | `apps/web/`; web-only glue | No duplicate shared workspaces or backend policy |
| `client/desktop-qt` | Windows Qt host, desktop shell, multiwindow, native/offline/workstation features | `apps/desktop-qt/`; workstation helper and desktop packaging paths | Shared renderer/API contracts stay shared |
| `server/windows` | Node API, Prisma/PostgreSQL, workers, Windows supervisor, installer, update, operations, gateway | `apps/server/`; server Go/native and installer paths | Server authorization remains authoritative |
| `platform/shared` | Shared UI primitives, renderer, API client, types/contracts, design tokens, common behaviors | `packages/renderer/`, `packages/shared/`, `packages/api-client/` | One implementation for cross-client UX and data semantics |

`integrations/`, generic `tools/`, `config/`, and `docs/` are cross-cutting. Use a short-lived `feature/*`, `fix/*`, `chore/*`, or `import/*` branch from `development` when a change does not naturally belong to one lane.

**No native mobile branch for 1.0:** Phone and tablet behavior currently belongs to the responsive Web client. **No separate portal fork:** the external portal is part of the Web surface with server-enforced authorization and constrained routes. **No separate server database:** all clients use the same API and canonical PostgreSQL-backed authority.

## Promotion and integration

1. Begin from the latest `development`; branch owners may use their named lane or a focused task branch.
2. Keep changes scoped. A contract or UI change shared between Web/Qt belongs in `platform/shared`, coordinated with its consumers.
3. Open PRs into `development`, never directly from a client lane into `main`.
4. Require source hygiene, relevant focused tests, security/permissions review when affected, and successful build checks for every changed target. Include manual verification evidence where automation cannot exercise Windows/Qt.
5. After merging to `development`, update all published work lanes from the new integration tip through a normal merge or clean fast-forward. **Never force-push the shared lanes.**
6. Promote `development` to `main` through a reviewed integration PR only after the release gate passes.
7. Cut a `release/1.0-rc` stabilization branch **later**, from a reconciled and tested `development`; do not cut it from historical `ReleaseCanidate` or label RC50 source as a newer release.

Client lanes must not carry incompatible migrations, drift in API schema, separate permission decisions, or copied shared renderer implementations. Each merged change must preserve the other supported clients or explicitly document an intentional compatibility gate.

## Surface acceptance gates

| Surface | Minimum 1.0 gate |
| --- | --- |
| **Shared platform** | Type-check shared packages; canonical contracts and version negotiation; permission-safe data projections; UI primitives, keyboard access, appearance/DPI; consistent errors |
| **Web** | Production bundle, browser startup/login/logout, Projects/Library/Calendar, upload/download/preview, desktop and mobile/tablet responsive layouts, keyboard and accessibility |
| **Qt Desktop** | Native Windows x64 build, auth/server selection, Qt renderer parity, offline queue, transfers, workstation/Git integration, multiwindow and DPI tests at 100/125/150%; version compatibility |
| **Windows Server** | Pinned toolchain/reproducible builds, installer/launcher/supervisor, PostgreSQL 18 migrations, start/stop/update/rollback, networking/TLS, backup/restore, permission and file-download security, resource pressure, 24-hour endurance |
| **Cross-client** | Same user/session/permissions across Web and Qt; stale-client writes blocked; server healthy/degraded/offline/recovery states honored; real multi-user collaboration and transfer recovery |

## Highest-priority 1.0 blockers

1. **Source reconciliation:** import RC73/RC74 only from independently verified complete source, with a reviewed comparison against Git `development`.
2. **Reproducibility:** generate, validate, and commit `package-lock.json` with pinned Node/npm; release and CI installs must use `npm ci`.
3. **Client-specific build jobs:** create real Web, Qt and Windows Server build/packaging jobs with artifacts attached to the tested commit; source-only syntax checks are insufficient.
4. **Native Desktop parity:** resolve the `config/toolchain-versions.json` `desktop.parityVersionHold` only after Qt source and runtime tests prove parity.
5. **Installer and data safety:** no production build performed at ordinary install time; signed/hashed matching artifacts; clean installation, upgrade, rollback, backup/restore and failure recovery verified.
6. **Transfers and viewer reliability:** direct/download permission enforcement, resume/retry and media/PDF/3D playback on actual Windows/browser sessions.
7. **End-to-end release evidence:** authenticated multi-user, performance/request count, Windows DPI, networking and operational runbooks; resolve P0/P1 before stable.

**Release status vocabulary:** `Unimplemented`, `Source-complete`, `Build-verified`, `Runtime-verified`, `Certified`, or `Deferred to 1.1`. A source test cannot advance a requirement to `Certified`.

## Avoid

- Copying `packages/renderer` into separate Web and Qt branches as permanent forks.
- Creating dedicated branches for hypothetical clients.
- Making `main` an automatic deployment target before acceptance.
- Deleting/renaming existing historical branches in the course of this organization pass.
- Quietly increasing version numbers or claiming RC74 source is present in the repo.
- Shipping installer ZIPs, data, credentials, databases, or runtime artifacts in normal Git commits.

Related documents: `REPOSITORY_LAYOUT.md`, `../development/GIT_WORKFLOW.md`, `../development/RELEASE_CHECKLIST.md` and `../../config/release-candidate.json`.
