# Cluster 1.0 distribution profiles

Cluster is **one private monorepo** with separately built products. A Git branch is a source-development lane; a **distribution profile** defines what is installed and how that product is updated.

## Supported profiles

| Profile | Installs | Update channel | Artifact |
| --- | --- | --- | --- |
| `server-windows-x64` | Server Manager, API, Web bundle, required runtimes and PostgreSQL | `main` / `development` | Dedicated Windows Server installer and root launcher |
| `desktop-windows-x64` | Qt Desktop, native helper, private Git/runtime, signed Desktop updater | Desktop-only `stable` / `beta` | CPack NSIS Desktop installer + portable ZIP |
| `web-responsive` | Nothing on the user's PC; static browser frontend hosted by the server | `main` / `development` deployment pipeline | Web frontend assets |
| `portal-web` | No independent server or user-side install; restricted route in Web deployment | Web deployment channel | Same browser frontend assets, separately authorized portal routes |

Desktop is **not** a Windows Server component. It should not obtain the source ZIP, API daemon, native server launcher, Postgres runtime or server update feed. The Web and Portal experiences do not use desktop/Windows installers. The Shared Platform is built into consumer targets, not distributed as another installer.

Current native Qt version is **0.482.0** on an explicit parity hold; source/server version is **0.546.0**. Package and updater versions must not be silently equated.

## Build commands

```sh
npm run release:profiles
node tools/scripts/cluster-platform-release.mjs --profile server-windows-x64 --channel development
node tools/scripts/cluster-platform-release.mjs --profile desktop-windows-x64 --channel stable
node tools/scripts/cluster-platform-release.mjs --profile web-responsive --channel development
node tools/scripts/cluster-platform-release.mjs --profile portal-web --channel main
```

These commands print deterministic **plans** only. To actually build, supply `--build` on a configured runner with the pinned native toolchains, verified npm lockfile, and matching Git branch. The build command then validates the expected product artifacts, hashes each one and writes a local, **unsigned and uncertified** build receipt. A build receipt is not an update feed or a release signature.

Windows Server release distribution requires a separate signed `cluster-server` manifest pinned to the selected `main` or `development` channel. Qt Desktop continues to use signed `cluster-desktop` manifests with `stable` / `beta` channels. Cross-product manifests, architectures and artifact names fail closed.

## Current limitations

- The Git source currently tracks RC50; later RC73/RC74 bundles require verified import.
- The npm lockfile is not committed. `--build` intentionally rejects reproducibility claims without it.
- The legacy Windows Server installer still source-builds on the installation machine. Shipping prebuilt verified runtime packages is a **1.0 release blocker**.
- Qt Desktop's new NSIS step requires CPack + NSIS and an actual Windows/Qt build. It has not been Windows runtime-certified.
- The Server's channel-aware Check Updates only verifies and reports signed metadata; safe unattended download, stop/drain, apply, and restore testing remains incomplete.
- Web and Portal must enforce all authorization through the server, regardless of client-side surface styling.

Nothing in these profiles authorizes deleting existing installations, resetting a database or overriding a newer client/server compatibility hold.
