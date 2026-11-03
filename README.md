# Cluster 1.0.1

**Private, self-hosted studio workspace for Azure Studios.** Cluster combines projects, boards, tickets, whiteboards, timelines, calendars, time tracking, Library files, Packets documentation, QA/builds, people management, and studio administration. It includes a browser client, a native Windows Desktop client, and a Windows Server Manager.

**Current source:** **Cluster 1.0.1** on `main` / `development`. **Latest published binaries:** [historical v1.0.0](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0), whose Server installer is known to fail. **A CI-built, hash-verified 1.0.1 Server test installer is now available from [GitHub Actions](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099); it has not passed an actual Windows installation test or been published as a GitHub Release.** [Installation guide](docs/INSTALLATION.md) · [1.0.1 source status](docs/releases/CLUSTER_1_0_1_SOURCE.md)

> **Release scope:** Cluster 1.0 is an owner-approved **private studio release**. Both Windows installers and the portable Desktop ZIP were compiled and hash-verified in GitHub Actions. These packages are **unsigned** and have **not** passed real-workstation installation, upgrade, restore, or recovery acceptance. Preserve existing data and do not overwrite a running Server. See the [release notes](docs/releases/CLUSTER_1_0_0.md) for the precise limitations.

> **Known issue in v1.0.0 Server installer:** The published Windows Server EXE rejects its own prebuilt runtime because its source-only admission step requires an installer script deliberately excluded from the payload. A second source-only smoke step would also fail. See [installer fix PR #31](https://github.com/NotAzureStudios/Cluster/pull/31). **Do not retry or replace existing Server data with the unchanged v1.0.0 EXE.** A corrected **CI test artifact** is available now; no standalone 1.0.1 GitHub Release has been published yet. The separate Desktop artifact is not implicated by this particular failure.

## Install Cluster 1.0

**Windows x64** is the packaged target. The 1.0.1 Server installer has passed the pinned Windows CI build and SHA-256 checks, but **real Windows installation remains untested**. The v1.0.0 Server EXE is broken and must not be used for a fresh installation.

| Download | Purpose |
| --- | --- |
| [Cluster Server 1.0.1 Windows test build](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099) | **Unsigned, hash-verified test artifact.** Download the workflow artifact ZIP; use its `bin/Cluster-Installer.exe` in a new empty folder |
| [Cluster-Installer.exe (v1.0.0, broken)](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Installer.exe) | **Do not install.** Historical release with a confirmed installer defect |
| [Cluster-Desktop-Installer-0.482.0-windows-x64.exe](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Desktop-Installer-0.482.0-windows-x64.exe) | Installs the separate native **Cluster Desktop** client |
| [Cluster-Desktop-0.482.0-windows-x64.zip](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Desktop-0.482.0-windows-x64.zip) | Portable Desktop alternative, not a Server installer |

**New installation:** follow the [Windows Server and Desktop setup instructions](docs/INSTALLATION.md). The Server must be running and reachable before users can connect through Desktop or a browser. Accounts are created by the studio administrator.

**Already running Cluster?** Do **not** place the 1.0 installer over your existing Server installation until you have a verified PostgreSQL and Library backup and a tested upgrade procedure. Automatic update application and rollback have not been accepted.

> **Source versus binary:** `main` now identifies Server, Web and six npm workspaces as **1.0.1**. The already-published **v1.0.0** Server EXE still reports its historical RC50 / `0.546.0` identity and is broken. Native Qt Desktop remains **`0.482.0`** until separately rebuilt and tested. Never relabel old binaries as 1.0.1.

**Verified 1.0.1 test installer SHA-256:** `2719e1b1336144773c0e5ad9b361fae2d73109c08b2495592f04a92ccc9968f7`. Build source commit: `747832c6cdf53a97c0923e045c04c08e8b17d5a0`. Test the installed application before replacing a studio deployment.

## Product layout

| Component | Purpose |
| --- | --- |
| **Cluster Server** | Fastify API, PostgreSQL/Prisma data, background jobs, storage, native Server Manager and hosted Web UI |
| **Cluster Web** | Browser-based shared React interface served by the Server |
| **Cluster Desktop** | Qt 6.11 native host for shared UI, isolated server profiles, tray integration and native file/workstation capabilities |
| **Integrations** | Discord and production-tool integration sources, configured separately |

Desktop does not include a Server, database, or Server update feed. The Web and restricted Portal routes are served from the Server deployment, not through separate downloadable desktop installers.

## Rebuild the Windows Server 1.0.1 installer

The [official pinned Windows CI build](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099) now succeeds with all ten related workflows passing. It produces an unsigned test installer, not an installation-certified public release. A clean Windows x64 developer machine can reproduce the build without touching the installed Server:

```powershell
git switch main
git pull --ff-only origin main
powershell -NoProfile -File .\tools\windows\Build-Cluster-1.0.1.ps1
```

Requires Node `24.20.0`, Go `1.27.1`, Git and internet for `npm ci`. Successful output is under `artifacts/cluster-1.0.1-windows-x64/` with the unsigned EXE, SHA-256 receipt and Server Manager. See [1.0.1 build recovery](docs/releases/CLUSTER_1_0_1_SOURCE.md), including the optional dedicated Windows self-hosted Actions runner route. Do not rename or redistribute the broken v1.0.0 Server EXE as a hotfix.

## Develop from source

Development requires the pinned versions in [`config/toolchain-versions.json`](config/toolchain-versions.json), including **Node.js 24.20.0**, **Prisma 7.9.1**, **PostgreSQL 18.6**, **Go 1.27.1** for native tooling, and **Qt 6.11.2** for native Desktop. Windows native distribution builds also require CMake, MSVC and NSIS.

```sh
git clone https://github.com/NotAzureStudios/Cluster.git
cd Cluster
git switch development
node tools/scripts/cluster-release-lockfile-check.mjs
npm ci --no-audit --no-fund
npm run db:generate
npm run build
```

Use a **configured development environment**, not the studio's production data, for application startup:

```sh
npm run dev
```

The committed root `package-lock.json` is authoritative. Use `npm ci` for reproducible installs; do not regenerate dependencies during a release build. See [development setup](docs/development/LOCAL_SETUP.md), [distribution profiles](docs/development/DISTRIBUTION_PROFILES.md), and [Git workflow](docs/development/GIT_WORKFLOW.md).

## Source map

| Path | Contents |
| --- | --- |
| `apps/server/`, `apps/web/` | API and browser app |
| `apps/desktop-qt/` | Native Qt client |
| `apps/*-go/` | Windows native server and workstation helpers |
| `packages/` | Shared contracts, API client and React renderer |
| `integrations/` | Optional studio integrations |
| `tools/`, `config/` | Build tooling, regression checks, and pinned configuration |
| `docs/` | Installation, operations, development and release notes |

Source changes should enter `development` through focused reviewed pull requests, then be promoted to `main`. The [v1.0.0 tag](https://github.com/NotAzureStudios/Cluster/tree/v1.0.0) is the published source baseline; original binary build SHAs are documented separately.

## Documentation and policies

[Installation](docs/INSTALLATION.md) · [Documentation index](docs/README.md) · [Release notes](docs/releases/CLUSTER_1_0_0.md) · [Server recovery](docs/development/NATIVE_WINDOWS_SERVER_RECOVERY.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Support](SUPPORT.md)

**Copyright / access:** Proprietary internal-use Azure Studios software. Access to this private repository or release artifacts does not grant redistribution rights.
