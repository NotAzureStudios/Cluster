# Cluster local development and validation

This guide describes **source development**, not installing a verified Cluster release. It is based on the existing GitHub checkout and its scripts; it does not claim the full build has run here.

## Toolchain

Consult `config/toolchain-versions.json` before setup. The tracked candidate currently declares:

| Component | Pinned or recommended version |
| --- | --- |
| Node.js | 24.20.0 |
| PostgreSQL | 18.6 |
| Prisma | 7.9.1 |
| Qt | 6.11.2 |
| Go | 1.27.1 |
| CMake | 4.4.4 recommended |

Windows-native, Qt and portable installer builds require their dedicated platform toolchains. The Qt desktop is on its documented **0.482.0 parity hold**, even though the shared source package version is `0.546.0`.

## Checkout and source checks

```sh
git clone https://github.com/NotAzureStudios/Cluster.git
cd Cluster
git switch development
node tools/scripts/cluster-repo-hygiene-check.mjs
node tools/scripts/cluster-rc-preflight.mjs
npm run toolchain:check
```

The RC preflight without `--built` checks file presence, candidate identity and metadata alignment; it does **not** exercise a running server or native binaries.

## Dependency-backed development

The repository uses npm workspaces. With the correct toolchain and a configured local database/server environment:

```sh
npm install
npm run db:generate
npm run dev
```

`npm run dev:server`, `npm run dev:web`, `npm run build:server`, `npm run build:web` and `npm run verify` exist for targeted tasks. See root `package.json` for other focused regression commands.

**Current blocker:** no committed `package-lock.json`. Dependency installation is not reproducible, and `npm ci` will not work until an aligned lockfile exists. Do not treat an unpinned `npm install` as a release pipeline. Generate and verify the lockfile on the pinned Node/npm environment and then adopt `npm ci` for CI and packaging.

Server settings are represented by the checked-in example at `apps/server/config/cluster.config.example.json`. Keep populated settings, external credentials and data roots outside Git. Do not substitute the example's localhost URLs or insecure development values for an exposed production deployment.

## Native builds and release acceptance

The source includes `apps/desktop-qt/CMakeLists.txt`, Go modules, `tools/installer/`, and Windows build scripts. The source-only workflow does not exercise these components. A release needs its own clean Windows build, Node dependency validation, Prisma/PostgreSQL migration checks, native binary smoke tests, install/update/rollback testing, and application-level access controls/transfer checks.

Never run upgrade or recovery operations against live user data without a separate verified backup and rollback path. Do not promote `config/release-candidate.json` merely because source checks pass.

See [Git workflow](GIT_WORKFLOW.md) and [snapshot import requirements](SOURCE_SNAPSHOT_HYGIENE.md).
