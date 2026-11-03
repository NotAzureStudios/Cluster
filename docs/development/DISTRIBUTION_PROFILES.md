# Cluster 1.0 distribution profiles

**Published suite:** [v1.0.0](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0). Cluster uses a single private source repository, but Server and Qt Desktop are **different installed products** with different package identities and update channels.

| Profile | Shipped product | Distribution |
| --- | --- | --- |
| `server-windows-x64` | Server Manager, API/Web bundle, native Server runtime and managed PostgreSQL | `Cluster-Installer.exe` |
| `desktop-windows-x64` | Qt Desktop, workstation helper, private Git/LFS runtime and native integration | `Cluster-Desktop-Installer-0.482.0-windows-x64.exe` or portable ZIP |
| `web-responsive` | Browser UI hosted by the Server | Included with Server; no client installer |
| `portal-web` | Server-authorized restricted routes in the Web UI | Included with Server; no separate installer |

**Provenance:** published Server executable package was built from `server/windows` commit `6afcedad7f4452e28e57d34f7ea8af50b7db992d`, using internal RC50/`0.546.0` identity. Published Desktop came from `client/desktop-qt` commit `428f3182e18b0733726f049aa48234bb4688529d` with native `0.482.0` identity. The release tag contains both reviewed changes but was created later. Details and checksums are in [1.0 notes](../releases/CLUSTER_1_0_0.md).

## Build and package

The committed root npm v3 lockfile is required. On a compatible Windows runner with the pinned versions:

```powershell
node tools/scripts/cluster-release-lockfile-check.mjs
node tools/scripts/cluster-platform-release.mjs --list
node tools/scripts/cluster-platform-release.mjs --profile server-windows-x64 --channel development --build
```

A Qt 6.11.2/MSVC/NSIS Desktop build is **separate**, and its native release identity remains `0.482.0`:

```powershell
node tools/scripts/cluster-platform-release.mjs --profile desktop-windows-x64 --channel beta --build
```

Do **not** assume these commands will build on the published `v1.0.0` tag using the historical build branches: the release-profile source-ref guard checks its selected channel and Git revision. The published binaries are already available from GitHub Releases. For future builds, review the channel, update profile and source metadata together, and retain a matching build receipt. The old source branch names used for the 1.0 build are **provenance**, not a public update service.

## Hard boundaries

- Desktop packages must not contain the Server launcher, API, database or Server installer; Server prebuilt payloads exclude Desktop-only helpers.
- The Server's `main`/`development` channel-aware **Check Updates** verifies signed release manifests but does **not** automatically apply or roll back an update.
- Desktop's own `stable`/`beta` signed update manifests remain independent of Server feeds.
- Both **published v1.0.0 installers are unsigned**, although SHA-256 verification and build receipts passed.
- Never treat an artifact name or passing source check as proof of Windows installation, database recovery, update health, authorization, or data preservation.

See [installation](../INSTALLATION.md), [reproducible builds](REPRODUCIBLE_BUILD_1_0.md) and [release verification](RELEASE_CHECKLIST.md).
