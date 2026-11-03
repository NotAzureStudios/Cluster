# Cluster 1.0

**Private, self-hosted studio workspace for Azure Studios.** Cluster combines projects, boards, tickets, whiteboards, timelines, calendars, time tracking, Library files, Packets documentation, QA/builds, people management, and studio administration. It includes a browser client, a native Windows Desktop client, and a Windows Server Manager.

**Latest published release:** [Cluster v1.0.0](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0) · [Installation guide](docs/INSTALLATION.md) · [Release notes](docs/releases/CLUSTER_1_0_0.md)

> **Release scope:** Cluster 1.0 is an owner-approved **private studio release**. Both Windows installers and the portable Desktop ZIP were compiled and hash-verified in GitHub Actions. These packages are **unsigned** and have **not** passed real-workstation installation, upgrade, restore, or recovery acceptance. Preserve existing data and do not overwrite a running Server. See the [release notes](docs/releases/CLUSTER_1_0_0.md) for the precise limitations.

## Install Cluster 1.0

**Windows x64** is the packaged target. You do not need to clone this repository to install the application.

| Download | Purpose |
| --- | --- |
| [Cluster-Installer.exe](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Installer.exe) | Installs the portable **Cluster Server** and its web/API components |
| [Cluster-Desktop-Installer-0.482.0-windows-x64.exe](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Desktop-Installer-0.482.0-windows-x64.exe) | Installs the separate native **Cluster Desktop** client |
| [Cluster-Desktop-0.482.0-windows-x64.zip](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Desktop-0.482.0-windows-x64.zip) | Portable Desktop alternative, not a Server installer |

**New installation:** follow the [Windows Server and Desktop setup instructions](docs/INSTALLATION.md). The Server must be running and reachable before users can connect through Desktop or a browser. Accounts are created by the studio administrator.

**Already running Cluster?** Do **not** place the 1.0 installer over your existing Server installation until you have a verified PostgreSQL and Library backup and a tested upgrade procedure. Automatic update application and rollback have not been accepted.

> The suite release is **1.0.0**. The packaged Server still reports its original **RC50 / source `0.546.0`** internal build identity, and native Desktop reports **`0.482.0`**. The binaries were not rebuilt or silently relabeled after publishing. They are separate product versions and must not be confused with the release title.

## Product layout

| Component | Purpose |
| --- | --- |
| **Cluster Server** | Fastify API, PostgreSQL/Prisma data, background jobs, storage, native Server Manager and hosted Web UI |
| **Cluster Web** | Browser-based shared React interface served by the Server |
| **Cluster Desktop** | Qt 6.11 native host for shared UI, isolated server profiles, tray integration and native file/workstation capabilities |
| **Integrations** | Discord and production-tool integration sources, configured separately |

Desktop does not include a Server, database, or Server update feed. The Web and restricted Portal routes are served from the Server deployment, not through separate downloadable desktop installers.

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
