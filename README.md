# Cluster

Cluster is Azure Studios' private studio workspace and server platform. This repository contains the **development source**, not a prebuilt Windows installation.

## Source layout

| Directory | Contents |
| --- | --- |
| `apps/server` | API, background work and PostgreSQL/Prisma implementation |
| `apps/web` | Browser client |
| `apps/desktop-qt` | Native C++/Qt desktop client |
| `apps/*-go` | Native server, updater and workstation helpers |
| `packages/renderer` | Shared application UI and workspaces |
| `packages/shared`, `packages/api-client` | Shared contracts and API access |
| `integrations` | Discord and game/tool integrations |
| `tools` | Windows packaging, native builds, tests, release checks |
| `config` | Source toolchain and release-candidate metadata |

## Development and release checks

Use the toolchain pinned in `config/toolchain-versions.json`, including Node.js 24.20.0, and the commands declared in `package.json`. This source tree is **not** a complete Windows server installation.

```sh
node tools/scripts/cluster-repo-hygiene-check.mjs
node tools/scripts/cluster-rc-preflight.mjs
npm run toolchain:check
```

The first two are dependency-free source checks. Full verification requires the appropriate Node, PostgreSQL, Qt, Go and Windows environments. Do **not** assume the source-only checks certify the installer, server startup, media playback or backup recovery.

**Release blocker:** `package-lock.json` is currently missing. Dependency-backed reproducibility cannot be certified until a lockfile is generated with the pinned toolchain, validated and committed. A normal `npm install` is not a reproducible release build.

The authoritative release metadata for a checked-out revision is `config/release-candidate.json`. Release notes and older roadmap documents in this repository are historical; their filenames are not evidence that a newer release is already merged. The current GitHub source and external RC73/RC74 bundles must be compared before importing any candidate. Do not overwrite `main` with a ZIP snapshot.

## Contribution workflow

Cluster is proprietary and this repository must remain private. Make changes on feature or import branches, preserve Git history, run focused regression checks and review diffs through pull requests. Do not commit credentials, user Library data, databases, local server installations or distribution binaries.

See [Git workflow](docs/development/GIT_WORKFLOW.md) for the import and review process.
