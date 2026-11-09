# Cluster

**Cluster** is Azure Studios' private, self-hosted studio workspace for project management, collaboration and production. It brings Projects, Boards, Tickets, Whiteboards, Timeline, Calendar and time tracking, Library storage and media viewers, Packets documentation, QA/builds, people management and studio administration into one system.

**[Latest stable release](https://github.com/NotAzureStudios/Cluster/releases/latest)** · [Server installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe) · [Install and upgrade](docs/INSTALLATION.md) · [Documentation](docs/README.md)

## Download

Server and native Qt Desktop are **independently versioned**. The [latest stable release](https://github.com/NotAzureStudios/Cluster/releases/latest) and its build receipts are the authority for currently published component versions.

| Download | Purpose |
| --- | --- |
| **[Latest Cluster Server installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe)** | Windows Server, hosted Web, API and native Server Manager |
| [Latest native Desktop installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Installer.exe) | Independently versioned Windows Qt Desktop |
| [Latest portable Desktop ZIP](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Portable.zip) | Portable Qt Desktop |
| [Release notes and build receipts](https://github.com/NotAzureStudios/Cluster/releases/latest) | Published versions, SHA-256 hashes, signing and upgrade limitations |

**Verify downloads and data safety:** Match SHA-256 against the *same release's* \`Cluster-server-build-receipt.json\` or \`Cluster-desktop-build-receipt.json\`. Unsigned installers and successful clean-install builds do not prove upgrade/rollback safety with populated studio data. Back up PostgreSQL, Library, settings and account credentials before any existing-Server upgrade.

**Historical Server 1.1.1 → 1.1.2 transition:** Server 1.1.2 embedded a new Ed25519 update-verification key, which Server 1.1.1 cannot authenticate through its old signed-update feed. This requires a **manual installer upgrade** from 1.1.1, after verified backups. The 1.1.2 installer was **unsigned**, not a signed \`server-main\` automatic update. Do not bypass signature verification. Newer releases may have different instructions: consult the latest release notes.

See [Windows code signing](docs/development/WINDOWS_CODE_SIGNING.md) and [permanent release asset naming](docs/development/RELEASE_ASSET_NAMING.md).

## Install or upgrade

For a **new** Server, place \`Cluster-Installer.exe\` in a dedicated writable installation-parent directory such as \`D:\Cluster-Server\`. It creates \`Cluster\Server\` beside itself.

For an **existing** Server, first check its real workspace in the running Server Manager. To upgrade \`D:\Cluster-Server\Cluster\Server\`, run \`D:\Cluster-Server\Cluster-Installer.exe\`. To upgrade \`C:\Cluster\Server\`, run \`C:\Cluster-Installer.exe\` with appropriate permissions. The installer does **not** discover existing folders. Running it from Downloads or inside \`Cluster\Server\` can create the wrong installation.

After a verified backup, stop the Server and managed PostgreSQL/Node/Host processes, install from the correct parent, and start the managed \`Cluster\Server\bin\Cluster Server.exe\`. Compare its reported version and \`CLUSTER_RELEASE.json\` with the release you downloaded, then verify login, projects and Library. A drive-root installation can retain a stale shortcut; inspect \`Cluster\installer.log\` rather than deleting any data.

Use the [complete Windows installation and in-place upgrade guide](docs/INSTALLATION.md).

## Components

| Product | Description |
| --- | --- |
| **Cluster Server** | Fastify API, PostgreSQL/Prisma data, background tasks, Library file services, hosted Web and native Windows Server Manager |
| **Cluster Web** | Browser interface for authorized studio users |
| **Cluster Desktop** | Native C++/Qt client with isolated Server profiles, tray and desktop integration, native notifications and workstation/file capabilities |
| **Integrations** | Studio integrations including Discord, configured independently |

**Versioning:** Server and Qt Desktop have independent component versions. Consult the [latest release](https://github.com/NotAzureStudios/Cluster/releases/latest) and its matching build receipts for their actual published identities and hashes.

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
