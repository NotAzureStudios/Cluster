# Repository architecture and ownership

Cluster's source repository is a **single private monorepo**. Its primary units are applications, shared packages, integrations and build tooling. Prefer improving established boundaries rather than making parallel implementations of the same feature.

## Current directories

| Directory | Current purpose | Change ownership |
| --- | --- | --- |
| `apps/server/` | Fastify application, Prisma/PostgreSQL, API and workers | API, persistence, auth, server-side coordination |
| `apps/web/` | Vite web entry point and build | Browser host and web-specific wiring |
| `apps/desktop-qt/` | C++/Qt desktop host and platform adapters | Desktop-native integration |
| `apps/*-go/` | Native Windows server and workstation tooling | Native helper/launcher executables |
| `packages/shared/` | Shared types and contracts | Cross-application contracts |
| `packages/api-client/` | Shared client API interface | Client transport and API consumption |
| `packages/renderer/` | Shared React product interface | Workspaces, components, UI behavior |
| `integrations/` | Discord and Unreal bridges | External integrations |
| `tools/scripts/` | Source checks, migration/regression utilities, build scripts | Developer/release automation |
| `tools/installer/`, `tools/native/`, `tools/windows/` | Native packaging and Windows implementation | Installer/build/runtime support |
| `config/` | Source toolchain and release metadata | Versioning and release metadata |
| `docs/` | Current development/design docs and historical evidence | Project documentation |

npm workspaces are explicitly declared at the root `package.json`. Go modules and Qt/CMake build targets are also represented in the tree but do not belong in npm workspace declarations simply because they are in `apps/`.

## Working rules

- **Source of truth:** use `development` for active work; keep `main` as a reviewed baseline.
- **Common UI:** prefer the shared renderer rather than implementing separate conflicting business interfaces in native shells.
- **API and authorization:** server-side policies and persistence stay on the server. Front-end conveniences do not replace server checks.
- **Generated versus authored:** keep compiler output, local databases, cached dependencies, installers and user data out of the source tree.
- **Toolchains:** keep `config/toolchain-versions.json`, package manifests, native build definitions and release metadata consistent.
- **Documentation:** put developer guides in `docs/development/`, design decisions in `docs/design/`, past snapshot evidence in `docs/history/`.

## Areas needing later architectural cleanup

The checked source contains a large **flat** `tools/scripts/` directory (hundreds of source checks and build scripts), alongside large server and renderer source areas. That is a maintainability concern but not a safe candidate for a blind bulk rename: numerous scripts and package commands refer to current paths. Group test/build tools by purpose only with import-path and CI migration tests.

Keep active documentation distinct from historical plans. Do not infer a released feature from an old document title.

The repository does **not** need Git LFS for its small current source assets. Add a narrowly scoped `.gitattributes` LFS policy if future Git-tracked art assets, Unreal binaries or large media justify one. Cluster's own Git/LFS service is separate from this repository.
