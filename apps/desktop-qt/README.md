# Cluster Desktop (native Qt client)

Cluster Desktop is the independent native Qt 6.11.2/C++ host for the shared Cluster React interface. It runs the normal workspaces through the shared renderer and adds OS integrations, isolated server profiles, tray controls, native notifications, file operations, resumable transfers, and workstation/Git helpers.

**Published suite:** [Cluster 1.0.0](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0). **Native Desktop binary version:** `0.482.0`. This component identity is intentionally distinct from the Server source version `0.546.0`; both packages were built separately. Published installers are **unsigned** and their runtime behavior has not been installation-certified.

## Install

Download the [Desktop installer](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Desktop-Installer-0.482.0-windows-x64.exe) or [portable ZIP](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Desktop-0.482.0-windows-x64.zip). Follow the [Windows installation guide](../../docs/INSTALLATION.md).

Desktop requires a running Cluster Server; it does **not** ship a database, API daemon, Windows Server Manager, or Server update feed.

## Server profiles

Each saved Server receives an isolated WebView2 user-data directory and a native-data directory keyed by a deterministic SHA-256-derived profile identifier. Local session state, cookies and permission caches are separated by Server. Use the tray or **Ctrl+Shift+S** to open server profiles. Remote Server endpoints require HTTPS by default; loopback HTTP is for local development.

## Windows build

Prerequisites are Node.js 24.20.0 with the repository's root `package-lock.json`, Go 1.27.1, Qt 6.11.2 with WebView, CMake 3.31+ and an MSVC compiler, plus NSIS for a Windows installer. The 1.0 CI builder used a Qt 6.11-aware pinned `aqtinstall` revision and a Windows runner with the available VS 2026 CMake generator.

```powershell
node tools/scripts/cluster-release-lockfile-check.mjs
npm ci --no-audit --no-fund
npm run desktop:reconstruction:package
```

`package-qt-desktop.mjs` builds and verifies a portable Desktop ZIP and, on Windows, a separate NSIS installer. It requires a matching private Git for Windows / Git LFS runtime, workstation helper manifest and product-only file boundaries. The released build used **Git for Windows 2.56.0** and **Git LFS 3.8.1**.

## Runtime/security boundaries

- The Desktop updater accepts **only** signed `cluster-desktop` release manifests on Desktop `stable`/`beta` channels; Server `main`/`development` manifests are not interchangeable.
- A signed manifest, verified download or compiler success is not proof of installed-product health. A real upgrade/rollback still needs runtime acceptance.
- Library mount integration requires a compatible platform mount provider; unsupported providers must not be represented as a working mount.
- Diagnostic records must not expose stored tokens, passwords, Library contents or unrelated Server profiles.

See [distribution profiles](../../docs/development/DISTRIBUTION_PROFILES.md), [release record](../../docs/releases/CLUSTER_1_0_0.md) and [Server/Client install instructions](../../docs/INSTALLATION.md).
