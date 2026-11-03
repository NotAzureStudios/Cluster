# Develop Cluster 1.0 locally

This guide describes the **source checkout**, not how to install the published application. Use [the Windows installation guide](../INSTALLATION.md) for the release binaries.

## Requirements

- **Node.js 24.20.0**, committed root `package-lock.json`, npm compatible with the pinned Node version.
- **PostgreSQL 18.6** for a running API and development data. **Prisma 7.9.1** is locked in the npm workspace dependencies.
- **Go 1.27.1** for the Windows Server Manager and native helper builds.
- **Qt 6.11.2**, CMake 3.31+ (4.4.4 recommended), a compatible MSVC compiler and NSIS for Windows Desktop packaging.
- Windows x64 for **real Windows native installers**; shared Server/Web TypeScript compilation also runs on Ubuntu.

Check [toolchain configuration](../../config/toolchain-versions.json) for the exact versions before rebuilding.

## Clone and build

```sh
git clone https://github.com/NotAzureStudios/Cluster.git
cd Cluster
git switch development
node tools/scripts/cluster-release-lockfile-check.mjs
npm ci --no-audit --no-fund
npm run db:generate
npm run build
```

`npm ci` is the release-safe installation mode. The committed npm v3 lockfile covers all six workspaces; do not use `npm install` in CI to silently rewrite it. The compiled Server/Web targets and Prisma client are verified on Windows and Linux runners.

## Running a development instance

Configure `apps/server/config/cluster.config.example.json` as the basis of a **separate local configuration**, with local PostgreSQL/database connection settings and new secrets. Keep secrets, `.env`, Library data and database files out of Git.

```sh
npm run dev
```

To build just Server or Web:

```sh
npm run build:server
npm run build:web
```

Do not point development or tests at a running studio Server's database or Library storage.

## Native builds

For a real Windows Server prebuilt candidate on a provisioned Windows toolchain, use the release-profile instructions in [distribution profiles](DISTRIBUTION_PROFILES.md). Qt Desktop is compiled and packaged separately; see [the Desktop README](../../apps/desktop-qt/README.md). Reproducing a build is not the same as completing installation or rollback acceptance.

## Code changes

Submit focused changes to `development`, preserve the committed lockfile, run the relevant package/source checks, and promote reviewed changes to `main` for a subsequent release. The stable `v1.0.0` tag is immutable historical release evidence; **do not alter or force-move it**.
