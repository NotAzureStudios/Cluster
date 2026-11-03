# Cluster

**Cluster** is Azure Studios' private, self-hosted studio workspace for project management, collaboration and production. It brings Projects, Boards, Tickets, Whiteboards, Timeline, Calendar and time tracking, Library storage and media viewers, Packets documentation, QA/builds, people management and studio administration into one system.

**[Latest stable release](https://github.com/NotAzureStudios/Cluster/releases/latest)** · [Install](docs/INSTALLATION.md) · [Release notes](https://github.com/NotAzureStudios/Cluster/releases/latest) · [Documentation](docs/README.md)

## Download

The links below **follow GitHub's latest stable release automatically**. You won't need to edit the README every time the version changes.

| Download | Use |
| --- | --- |
| **[Download latest Cluster Server installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe)** | Windows x64 Server, API, hosted Web and native Server Manager |
| **[Download latest Cluster Desktop](https://github.com/NotAzureStudios/Cluster/releases/latest)** | Under **Assets**, choose the Windows Desktop installer |
| [Portable Desktop download](https://github.com/NotAzureStudios/Cluster/releases/latest) | Under **Assets**, choose the portable Desktop ZIP |

GitHub supports permanent direct-download links when a release asset has the same filename. The Server installer already uses the stable name `Cluster-Installer.exe`. The currently published Desktop file names contain their native version, so their links go to the **latest release page** instead of guessing a future filename. [Release naming policy](docs/development/RELEASE_ASSET_NAMING.md).

## Install

1. Download the latest Server installer and put it in a new, writable folder on your Windows Server.
2. Run it, configure the native Server Manager and complete initial Owner setup.
3. Connect through the hosted Web UI or the separate Desktop application.

Use the [current Windows installation guide](docs/INSTALLATION.md) for setup, file verification and data-preservation instructions. For existing deployments, back up PostgreSQL data and Library files before replacing anything.

The published Windows binaries are not currently signed with a trusted publisher certificate. See [Windows code signing](docs/development/WINDOWS_CODE_SIGNING.md) for the internal and publicly trusted signing options. Signing is independent of whether the compiled application passes real Windows installation and runtime checks.

## Components

| Product | Description |
| --- | --- |
| **Cluster Server** | Fastify API, PostgreSQL/Prisma data, background tasks, Library file services, hosted Web and native Windows Server Manager |
| **Cluster Web** | Browser interface for authorized studio users |
| **Cluster Desktop** | Native C++/Qt client with isolated Server profiles, tray and desktop integration, native notifications and workstation/file capabilities |
| **Integrations** | Studio integrations including Discord, configured independently |

**Versioning:** Cluster's suite/Server version follows the latest release. The Qt Desktop binary has its own version. Use the [latest release notes](https://github.com/NotAzureStudios/Cluster/releases/latest) for component versions, build provenance and SHA-256 hashes.

## Develop from source

This is a private source repository. Use the pinned toolchain versions in [`config/toolchain-versions.json`](config/toolchain-versions.json), including Node.js **24.20.0**, Prisma **7.9.1**, PostgreSQL **18.6**, Go **1.27.1**, and Qt **6.11.2** for native Desktop builds.

```sh
git clone https://github.com/NotAzureStudios/Cluster.git
cd Cluster
git switch development
node tools/scripts/cluster-release-lockfile-check.mjs
npm ci --no-audit --no-fund
npm run db:generate
npm run build
```

To start a configured **development** environment (not the studio's installed Server), use `npm run dev`. The committed root `package-lock.json` covers the six npm workspaces; use `npm ci` for reproducible builds.

For a Windows Server release build, use the pinned toolchain and [distribution profile](docs/development/DISTRIBUTION_PROFILES.md). The native build and release verification pipeline are maintained separately from README downloads.

## Repository

| Path | Contents |
| --- | --- |
| `apps/server/`, `apps/web/` | API and browser app |
| `apps/desktop-qt/` | Native Qt Desktop |
| `apps/*-go/` | Windows-native Server/workstation components |
| `packages/` | Shared contracts, API client and React renderer |
| `integrations/` | Optional studio integrations |
| `tools/`, `config/` | Release/build tooling, tests and pinned configuration |
| `docs/` | Installation, operations, developer and release documentation |

Changes go through reviewed development work and then `main`. Published release tags preserve their original source and binary provenance. Historical fixes remain available in the Git history and corresponding release notes.

## Documentation and policies

[Installation](docs/INSTALLATION.md) · [Documentation index](docs/README.md) · [Latest release notes](https://github.com/NotAzureStudios/Cluster/releases/latest) · [Server recovery](docs/development/NATIVE_WINDOWS_SERVER_RECOVERY.md) · [Local development](docs/development/LOCAL_SETUP.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Support](SUPPORT.md)

**Access:** Proprietary internal-use Azure Studios software. Repository access does not grant redistribution rights.
