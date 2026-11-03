# Cluster 1.0.1

**Cluster** is Azure Studios' private, self-hosted studio workspace for project management, collaboration and production. It brings Projects, Boards, Tickets, Whiteboards, Timeline, Calendar and time tracking, Library storage and media viewers, Packets documentation, QA/builds, people management and studio administration into one system.

**Latest version: [Cluster 1.0.1](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.1)** · [Install](docs/INSTALLATION.md) · [Release notes](docs/releases/CLUSTER_1_0_1.md) · [Documentation](docs/README.md)

## Download and install

The packaged target is **Windows x64**. Install the Server on the studio's Windows Server machine, then connect using the browser or the independent Qt Desktop client.

| Download | Use |
| --- | --- |
| **[Cluster Server Installer (1.0.1)](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.1/Cluster-Installer.exe)** | Installs the managed Server, API, hosted Web UI and native Server Manager |
| **[Cluster Desktop Installer](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.1/Cluster-Desktop-Installer-0.482.0-windows-x64.exe)** | Installs the separate native Qt Windows client |
| [Portable Desktop ZIP](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.1/Cluster-Desktop-0.482.0-windows-x64.zip) | Unpacked Desktop alternative |

1. Download `Cluster-Installer.exe` and place it in a new, writable Server installation folder, such as `D:\Cluster-Server\`.
2. Run it and follow the Server Manager setup. The installer places its managed files in a `Cluster\` subfolder beside the installer.
3. Configure the Server, complete the initial Owner setup locally, and confirm Server health.
4. Open the hosted Web UI, or install Desktop and connect it to the Server address with a studio account.

Read the [Windows installation guide](docs/INSTALLATION.md) for setup paths, checksums, troubleshooting and recovery precautions.

**Windows publisher warning:** These Windows binaries are not Authenticode-signed. The Server executable was compiled in the pinned Windows build pipeline, and the published installer SHA-256 is `2719e1b1336144773c0e5ad9b361fae2d73109c08b2495592f04a92ccc9968f7`. The 1.0.1 Server build has not yet completed an actual workstation installation and startup acceptance test. Verify the file before running it, and back up any existing database or Library data before replacing an installation.

## Components

| Product | Description |
| --- | --- |
| **Cluster Server** | Fastify API, PostgreSQL/Prisma data, background tasks, Library file services, hosted Web and native Windows Server Manager |
| **Cluster Web** | Browser interface for authorized studio users |
| **Cluster Desktop** | Native C++/Qt client with isolated Server profiles, tray and desktop integration, native notifications and workstation/file capabilities |
| **Integrations** | Studio integrations including Discord, configured independently |

**Versioning:** The suite and Server/Web source are **1.0.1**. Native Desktop retains its independent binary version **0.482.0**; it is included in this release unchanged. The [1.0.1 release notes](docs/releases/CLUSTER_1_0_1.md) record the actual binary source commits and SHA-256 hashes.

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

For an independently reproducible Windows Server package, run the [1.0.1 Windows build script](tools/windows/Build-Cluster-1.0.1.ps1) on a clean Windows x64 machine with the pinned tools. The [Windows Actions build](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099) is the verified source for the release Server binary.

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

Changes go through reviewed development work and then `main`. The immutable `v1.0.1` tag identifies this release; prior versions and resolved defects are documented in Git history and earlier release notes.

## Documentation and policies

[Installation](docs/INSTALLATION.md) · [Documentation index](docs/README.md) · [Release notes](docs/releases/CLUSTER_1_0_1.md) · [Server recovery](docs/development/NATIVE_WINDOWS_SERVER_RECOVERY.md) · [Local development](docs/development/LOCAL_SETUP.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Support](SUPPORT.md)

**Access:** Proprietary internal-use Azure Studios software. Repository access does not grant redistribution rights.
