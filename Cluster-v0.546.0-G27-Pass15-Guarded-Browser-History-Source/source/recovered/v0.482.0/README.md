# Cluster v0.425.0

Cluster is a self-hosted studio operations platform with three product targets from one source tree:

- **Windows Server**: native Go launcher + private Node.js + private PostgreSQL.
- **Linux Server**: native Go launcher + private Node.js + Docker PostgreSQL by default.
- **Desktop App**: native C++20 / Qt host using the shared Cluster React renderer through Qt WebView/WebView2, with native OS integration and isolated per-server browser profiles. No Electron.

## Current toolchain

`config/toolchain-versions.json` is the source of truth for Cluster, Node.js, PostgreSQL, Prisma, Qt, Go, CMake, and Three.js versions. Run:

```bash
npm run versions:verify
npm run dependencies:check
```

The release uses Prisma 7 with the PostgreSQL driver adapter and a generated ESM client under `apps/server/src/generated/prisma`.

## Common commands

```bash
npm install
npm run db:generate
npm run build
npm run audit
```

Desktop setup is automatic:

```bash
npm run desktop:setup
npm run desktop:package
```

On Windows, `desktop:setup` supports either Qt MSVC 2022 x64 or Qt MinGW x64 and caches the detected toolchain in `.cluster/desktop-toolchain.json`.

## Release layout

`npm run package:master` produces one Cluster Master release containing one canonical source archive plus separate Windows Server, Linux Server, and Desktop packaging artifacts. Tagged release CI requires an exact dependency graph, prebuilt server/web output, real PostgreSQL-backed integration tests, migration/upgrade and backup/restore certification, native builds, desktop launch smoke testing, and nested artifact verification before the release is accepted. The final Master also carries the smoke-tested Windows desktop runtime package.

For release work, use `npm run release:preflight` locally and the tagged `.github/workflows/release.yml` certification pipeline for production artifacts.

See `docs/ARCHITECTURE.md`, `docs/SECURITY_ARCHITECTURE.md`, `docs/UPLOAD_CONTENT_SECURITY.md`, `docs/APP_WIDE_ACCESSIBILITY.md`, `docs/ACCESSIBILITY_SETTINGS.md`, `docs/DIRECT_RESOURCE_AUTHORIZATION_REGRESSION.md`, `docs/PRIVACY_POLICY_SYSTEM.md`, `docs/TERMS_OF_SERVICE_SYSTEM.md`, `docs/SERVER_OPERATOR_AGREEMENT.md`, `docs/COPYRIGHT_DMCA_POLICY.md`, `docs/PRIVACY_CONSENT_STORAGE.md`, `docs/PRIVACY_DATA_CONTROL_CENTER.md`, `docs/DATA_INVENTORY_RETENTION.md`, `docs/DESKTOP_UPDATE_SECURITY.md`, `docs/DEPENDENCY_POLICY.md`, and `docs/PRODUCTION_RELEASES_AND_UPDATES.md` for the maintained architecture. Historical per-version architecture notes are intentionally not shipped in the live source tree.

## Desktop server profiles

Cluster Desktop isolates each saved server in its own WebView2 browser-data container. Use **Ctrl+Shift+S** or the tray **Servers** menu to add, switch, rename, reset, recover, or forget server profiles without sharing cookies or local browser state between instances.

## Native capability broker

Cluster Desktop exposes native advantages through a versioned allowlist rather than a generic renderer IPC object. User-selected files and folders are represented by short-lived profile-scoped opaque handles, and protocol 1 has no arbitrary process execution, credential access, raw filesystem path API, capture API, or generic native method invocation. See `docs/NATIVE_CAPABILITY_BROKER.md`.


## v0.425.0 shared component standardization

Cluster now has a small canonical component contract for routine actions and state presentation: `ClusterButton`, `ClusterIconButton`, `ClusterActionGroup`, `ClusterToolbar`, `ClusterField`, and `ClusterStatus`. The first migration targets the shared surfaces with the widest reach: workspace header actions, data-view toolbars, request/error states, application dialogs, destructive confirmation, saved views, and the design-system preview.

A release-blocking shared-component audit freezes raw routine-control and legacy button-class debt at the post-migration baseline so future work can reduce it safely instead of spawning another generation of local button variants. Specialized controls remain purpose-built when generic wrapping would damage semantics or keyboard behavior. See `docs/SHARED_COMPONENTS_PHASE2.md`.

## v0.424.0 CSS architecture foundation

Cluster now treats the renderer cascade as production architecture. Application decomposition modules no longer re-import parent-owned side-effect CSS, the global stylesheet entrypoint documents its ownership order, and the historical application refinement barrel has one explicit owner. Redundant settings range overrides were removed without changing the intended control geometry.

A new release-blocking CSS architecture audit freezes `!important`, raw-color, gradient, and backdrop-filter debt per file, rejects new patch-named style layers, and requires new CSS to start without forced/raw/blur debt. The first verified cleanup lowers `!important` usage to 6,576 while preserving the v0.423.0 production UI contract. See `docs/CSS_ARCHITECTURE_PHASE1.md` and `packages/renderer/src/styles/ARCHITECTURE.md`.

## v0.421.0 enhancement focus

Phase J completes the Power-User + Quality-of-Life pass with executable pinned-tool shortcuts, a global shortcut reference, canonical share links, and retained saved-view/layout productivity primitives.

Phase F completes the Users + Teams + Profiles enhancement pass with workload, hierarchy, permission, account-posture, and profile-completeness context.
