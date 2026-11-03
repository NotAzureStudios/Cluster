# Cluster

**Cluster** is Azure Studios' private, self-hosted studio workspace for project management, collaboration and production. It brings Projects, Boards, Tickets, Whiteboards, Timeline, Calendar and time tracking, Library storage and media viewers, Packets documentation, QA/builds, people management and studio administration into one system.

**[Server 1.0.4 Windows build](https://github.com/NotAzureStudios/Cluster/actions/runs/41727710185/artifacts/13276086331)** · [Published stable releases](https://github.com/NotAzureStudios/Cluster/releases) · [Install / upgrade](docs/INSTALLATION.md) · [Documentation](docs/README.md)

## Download

**Cluster Server 1.0.4 is built from `main`, but is not yet a published or signed release.** GitHub's general `releases/latest` still points to **1.0.2**; **do not use that older Server installer** to upgrade an installed 1.0.3. The Server and native Qt Desktop have separate build and update channels.

| Download | Use |
| --- | --- |
| **[Download Cluster Server 1.0.4 Windows installer ZIP](https://github.com/NotAzureStudios/Cluster/actions/runs/41727710185/artifacts/13276086331)** | Actual Windows x64 **1.0.4 test build** from commit `6acd48ea`; unzip and use the included `bin/Cluster-Installer.exe`. GitHub Actions artifacts expire (this one: **November 17, 2026**). |
| [All Windows Server build runs](https://github.com/NotAzureStudios/Cluster/actions/workflows/cluster-server-windows-build.yml) | Find the latest successful `main` run and its `cluster-server-unsigned-windows-x64-...` artifact when the above link expires. |
| [Latest **published** Cluster release](https://github.com/NotAzureStudios/Cluster/releases/latest) | Currently **1.0.2**. This is **not** the 1.0.4 Server build. |
| [Published Desktop installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Installer.exe) | Native Windows Qt Desktop client, distributed separately. |
| [Published portable Desktop ZIP](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Portable.zip) | Portable Qt Desktop client. |

The 1.0.4 Server test artifact passed the Windows installer build and clean-install smoke checks. It is **unsigned and not a certified upgrade of a populated 1.0.3 database**. Back up your database and Library before using it. A later signed Server release will be discovered separately through the `server-main` update feed; the GitHub general Latest badge is not that feed.

## Install or upgrade

For a **new** installation, put `Cluster-Installer.exe` in a dedicated writable folder (for example `D:\Cluster-Server\`) and run it. It creates `Cluster\Server` beside itself.

For an **existing** installation, first back up PostgreSQL, Library and configuration, then stop the managed Server and PostgreSQL. **The installer does not discover an existing location**: its location determines its target. If the running Server says `Workspace: C:\Cluster\Server`, the matching installer location is `C:\Cluster-Installer.exe` (the drive root). Run with appropriate Windows permissions. Launch the updated Server from **`C:\Cluster\Server\bin\Cluster Server.exe`**, not an old desktop shortcut or root-level launcher. Drive-root installs intentionally skip refreshing the optional root-level shortcut. Do not run the installer inside `C:\Cluster\Server` or from Downloads, which would target a different folder.

After upgrading, inspect `C:\Cluster\Server\CLUSTER_RELEASE.json` for `releaseCandidate: "1.0.4"` and confirm the Server Manager actually displays 1.0.4. If it still shows 1.0.3, **do not delete any data**: check `C:\Cluster\installer.log`, the EXE location you ran, and which launcher shortcut is opening.

Use the [Windows installation and in-place upgrade guide](docs/INSTALLATION.md) for complete data-preservation and troubleshooting steps. Windows executable Authenticode signing is separate from Cluster's signed update manifest; this 1.0.4 test artifact is not publisher-signed.

## Components

| Product | Description |
| --- | --- |
| **Cluster Server** | Fastify API, PostgreSQL/Prisma data, background tasks, Library file services, hosted Web and native Windows Server Manager |
| **Cluster Web** | Browser interface for authorized studio users |
| **Cluster Desktop** | Native C++/Qt client with isolated Server profiles, tray and desktop integration, native notifications and workstation/file capabilities |
| **Integrations** | Studio integrations including Discord, configured independently |

**Versioning:** The Server source on `main` is currently **1.0.4**; the most recently **published** GitHub release is **1.0.2**. Those are different until the signed Server publisher runs. Qt Desktop has its own binary version. Check the specific [Windows build run](https://github.com/NotAzureStudios/Cluster/actions/runs/41727710185) or [published release](https://github.com/NotAzureStudios/Cluster/releases) for accurate provenance.

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
