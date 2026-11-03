# Cluster

**Cluster** is Azure Studios' private, self-hosted studio workspace for project management, collaboration and production. It brings Projects, Boards, Tickets, Whiteboards, Timeline, Calendar and time tracking, Library storage and media viewers, Packets documentation, QA/builds, people management and studio administration into one system.

**[Latest Cluster release (1.0.4)](https://github.com/NotAzureStudios/Cluster/releases/latest)** · [Download Server installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe) · [Install / upgrade](docs/INSTALLATION.md) · [Documentation](docs/README.md)

## Download

The **[latest GitHub release](https://github.com/NotAzureStudios/Cluster/releases/latest)** is now **Cluster 1.0.4**. Download the Windows Server installer directly from its Assets section. This release carries forward the unchanged Qt Desktop 0.482.0 binaries.

| Download | Use |
| --- | --- |
| **[Download latest Cluster Server installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe)** | Windows x64 Server, API, hosted Web and native Server Manager (**1.0.4**). |
| [Latest Cluster Desktop installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Installer.exe) | Native Qt Desktop **0.482.0** (unchanged). |
| [Latest portable Desktop ZIP](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Portable.zip) | Portable Qt Desktop **0.482.0** (unchanged). |
| [Release notes and SHA-256 receipt](https://github.com/NotAzureStudios/Cluster/releases/latest) | See `Cluster-server-build-receipt.json` and all release assets. |

**Release status:** The Server 1.0.4 installer is **unsigned** and passed a real Windows clean-install smoke test. A populated 1.0.3 database upgrade/rollback is **not yet fully certified**. Back up PostgreSQL, Library, settings and credentials before upgrading. Publishing this direct installer does not create the separate signed `server-main` automatic update feed.

The release format and security guarantees are documented under [Windows code signing](docs/development/WINDOWS_CODE_SIGNING.md) and [permanent release asset naming](docs/development/RELEASE_ASSET_NAMING.md).

## Install or upgrade

For a **new** installation, put `Cluster-Installer.exe` in a dedicated writable folder (for example `D:\Cluster-Server\`) and run it. It creates `Cluster\Server` beside itself.

For an **existing** installation, first back up PostgreSQL, Library and configuration, then stop the managed Server and PostgreSQL. **The installer does not discover an existing location**: its location determines its target. If the running Server says `Workspace: C:\Cluster\Server`, the matching installer location is `C:\Cluster-Installer.exe` (the drive root). Run with appropriate Windows permissions. Launch the updated Server from **`C:\Cluster\Server\bin\Cluster Server.exe`**, not an old desktop shortcut or root-level launcher. Drive-root installs intentionally skip refreshing the optional root-level shortcut. Do not run the installer inside `C:\Cluster\Server` or from Downloads, which would target a different folder.

After upgrading, inspect `C:\Cluster\Server\CLUSTER_RELEASE.json` for `releaseCandidate: "1.0.4"` and confirm the Server Manager actually displays 1.0.4. If it still shows 1.0.3, **do not delete any data**: check `C:\Cluster\installer.log`, the EXE location you ran, and which launcher shortcut is opening.

Use the [Windows installation and in-place upgrade guide](docs/INSTALLATION.md) for complete data-preservation and troubleshooting steps. Windows executable Authenticode signing is separate from Cluster's signed update manifest; this 1.0.4 release is not publisher-signed.

## Components

| Product | Description |
| --- | --- |
| **Cluster Server** | Fastify API, PostgreSQL/Prisma data, background tasks, Library file services, hosted Web and native Windows Server Manager |
| **Cluster Web** | Browser interface for authorized studio users |
| **Cluster Desktop** | Native C++/Qt client with isolated Server profiles, tray and desktop integration, native notifications and workstation/file capabilities |
| **Integrations** | Studio integrations including Discord, configured independently |

**Versioning:** Cluster Server **1.0.4** is now the latest published GitHub release. Qt Desktop **0.482.0** remains independent. The Server 1.0.4 binary comes from [the verified Windows build](https://github.com/NotAzureStudios/Cluster/actions/runs/41727710185); check [release assets](https://github.com/NotAzureStudios/Cluster/releases/latest) for the installer and SHA-256 receipt.

## Develop from source

This is proprietary internal-use source hosted in a publicly visible repository. Use the pinned toolchain versions in [`config/toolchain-versions.json`](config/toolchain-versions.json), including Node.js **24.20.0**, Prisma **7.9.1**, PostgreSQL **18.6**, Go **1.27.1**, and Qt **6.11.2** for native Desktop builds.

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
