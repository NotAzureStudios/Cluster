# Cluster

**Private studio-management platform for Azure Studios.** Cluster brings projects, work tracking, scheduling, files, documentation and studio operations into one self-hosted workspace, with a web client, native desktop integration and a Windows server manager.

> [!IMPORTANT]
> **Source status:** The version currently tracked in GitHub is **Cluster 1.0.0-rc.50** (`config/release-candidate.json`), with source/toolchain version `0.546.0`. Later RC73 and RC74 source bundles exist, but have **not been merged** into this repository. This is a development repository, **not a certified 1.0 release or installer download**. Do not deploy a development checkout over a running Cluster server.

## What's in Cluster?

- **Work:** Projects, Boards, Tickets, Whiteboards, Timeline and connected workflows.
- **Studio operations:** Calendar, scheduling, time tracking, people and administration.
- **Content:** Library, transfers, previews and media viewers; Packets as the knowledge/learning workspace.
- **Production:** QA, builds, source-control integrations and notifications.
- **Clients and infrastructure:** Browser UI, native Qt desktop integration, portable Windows server tooling and Discord integration.

Capabilities listed above describe the source tree; availability and reliability of a particular release candidate still require testing.

## Repository map

| Path | Responsibility |
| --- | --- |
| [`apps/server/`](apps/server/) | Node/Fastify API, background work, Prisma/PostgreSQL models and migrations |
| [`apps/web/`](apps/web/) | Browser entry point and Vite build |
| [`apps/desktop-qt/`](apps/desktop-qt/) | Native C++/Qt host, client-specific platform integrations |
| `apps/*-go/` | Native server, launcher, helper and workstation executables |
| [`packages/renderer/`](packages/renderer/) | Shared React UI, workspaces and presentation logic |
| [`packages/shared/`](packages/shared/) | Shared contracts and types |
| [`packages/api-client/`](packages/api-client/) | Client-side API access |
| [`integrations/`](integrations/) | Discord and Unreal integration sources |
| [`tools/`](tools/) | Source tests, packaging, installers and native build helpers |
| [`config/`](config/) | Toolchain and release metadata |
| [`docs/`](docs/) | Architecture, development guides, design notes and release history |

This is **one monorepo**, not a collection of independently released apps. npm workspaces are declared in [`package.json`](package.json); native Go and Qt projects use their own build tooling.

## Getting started (development only)

**Required for a complete build:** the supported toolchains in [`config/toolchain-versions.json`](config/toolchain-versions.json). Current source specifies Node.js **24.20.0**, PostgreSQL **18.6**, Prisma **7.9.1**, Qt **6.11.2**, Go **1.27.1** and CMake **4.4.4** (recommended). Windows is required for Windows-native release acceptance.

1. Clone the private repository using an account authorized by Azure Studios. Switch to the working branch:

   ```sh
   git clone https://github.com/NotAzureStudios/Cluster.git
   cd Cluster
   git switch development
   ```

2. Review [`apps/server/config/cluster.config.example.json`](apps/server/config/cluster.config.example.json) and the server/database setup requirements. **Do not commit populated credentials, server configuration or database files.**
3. For source-only checks that do **not** install dependencies:

   ```sh
   node tools/scripts/cluster-repo-hygiene-check.mjs
   node tools/scripts/cluster-rc-preflight.mjs
   npm run toolchain:check
   ```

4. On a correctly provisioned development machine, the workspace commands are:

   ```sh
   npm install
   npm run db:generate
   npm run dev
   # Or: npm run build
   ```

   **Reproducibility blocker:** `package-lock.json` is not yet tracked. `npm install` is a temporary **local development** instruction, not an approved release or CI install. After producing and validating the lockfile, use `npm ci` for clean installs and release builds.

These commands have differing prerequisites. The source-only gate is **not** a PostgreSQL, Qt, Windows or installer acceptance test. See [development setup](docs/development/LOCAL_SETUP.md) for requirements and limitations.

## Branches and releases

| Branch | Purpose |
| --- | --- |
| [`development`](https://github.com/NotAzureStudios/Cluster/tree/development) | **Primary working branch.** Source imports, feature work, cleanup and fixes happen here. |
| [`main`](https://github.com/NotAzureStudios/Cluster/tree/main) | Reviewed integration/release baseline. Do not commit directly for routine development. |
| `feature/*`, `fix/*`, `chore/*` | Optional focused branches targeting `development`. |

Use pull requests and checks to promote reviewed changes from `development` to `main`. Do not force-push either long-lived branch. The GitHub default branch is currently `main` by design; that does **not** make it the working branch.

Releases are separate artifacts: verified Windows installers and distributable ZIPs should not be committed as source files. `config/release-candidate.json` is the tracked candidate identity; it does not imply the native installer is certified.

## Documentation and project policies

- [Documentation index](docs/README.md)
- [Repository architecture](docs/architecture/REPOSITORY_LAYOUT.md)
- [Release readiness checklist](docs/development/RELEASE_CHECKLIST.md)
- [Local development and validation](docs/development/LOCAL_SETUP.md)
- [Source control workflow](docs/development/GIT_WORKFLOW.md)
- [Snapshot import checklist](docs/development/SOURCE_SNAPSHOT_HYGIENE.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)
- [Internal support](SUPPORT.md)

## Ownership

**Proprietary, internal-use Azure Studios software.** Repository access does not grant permission to redistribute the code, installable software or assets. This is not an open-source project. 
