# Cluster 1.0.0

**Release date:** November 2, 2026  
**Audience:** Azure Studios (private studio deployment)  
**Status:** Version 1.0, owner-approved initial distribution. Not a claim of independently certified installation or signed binaries.

Cluster 1.0 brings together Projects, Boards, Tickets, Whiteboards, Timeline, Calendar/time tracking, Library/media viewers, Packets, QA/builds, people/admin operations, the browser workspace, Windows Server Manager, and native Qt Desktop.

## Packages

These independently built Windows x64 distribution assets were produced from reviewed source commits that were subsequently incorporated into the Cluster 1.0 source tree:

| Asset | Internal build identity | Compiled source commit | SHA-256 |
| --- | --- | --- | --- |
| `Cluster-Installer.exe` | Server RC50; Node/Prisma source `0.546.0` | `6afcedad7f4452e28e57d34f7ea8af50b7db992d` | `7c2766dc56e2f9369ef6f16742ae9500c8447eedd1aa0196a38a42afc4b88807` |
| `Cluster Server.exe` | Native Server manager RC50 | `6afcedad7f4452e28e57d34f7ea8af50b7db992d` | `b8dc630f6c230c9c0d4e7bacf79d9855f8512fc80cd586cdd4c7246ffab33a33` |
| `Cluster-Desktop-Installer-0.482.0-windows-x64.exe` | Native Qt Desktop `0.482.0` | `428f3182e18b0733726f049aa48234bb4688529d` | `0e983320e440ff0b25cd56b8e14b6fcc76d565188e59245ca90923ec58537a05` |
| `Cluster-Desktop-0.482.0-windows-x64.zip` | Portable Qt Desktop `0.482.0` | `428f3182e18b0733726f049aa48234bb4688529d` | `30b0d3cd64ea2c787a4eb87bfb5ba5bb50b19dd566e89a70746dee8f15242862` |

The **Cluster 1.0.0** label describes the suite's first studio release. Component version strings remain their independently built identities, and the release source tag is a later consolidation commit. Do not claim the binary hash or source commit is identical to the tag.

Both Windows builds completed on GitHub-hosted runners. The Server installer package was built with a private Node runtime bootstrap and hash-bound receipt; the Desktop build used Qt 6.11.2, official Git for Windows 2.56.0 and Git LFS 3.8.1. Receipts are attached for both products.

## Operational boundaries

- **Unsigned builds:** Neither Windows installer is Authenticode-signed. Windows may warn before running it.
- **Runtime acceptance:** Installer launch, desktop sign-in, server startup/repair, upgrades, restore, and file-permission behavior have **not** been independently verified on an actual studio workstation/server under this release tag.
- **Updater:** Existing Server signed-update verification and inert staging are not the same as automatic update installation and rollback. Do not assume one-click automatic safe rollback.
- **Data safety:** Do **not** overwrite a working Cluster Server folder with the downloadable candidate or test destructive PostgreSQL restoration on live data. Preserve external PostgreSQL and Library backups.
- **No public deployment claim:** This is a private studio release, not an audited public enterprise distribution.

The product owner elected to declare Cluster **1.0** with these known limitations rather than delay the version for unrelated enhancements. Future fixes belong in `1.0.x` maintenance releases; no new 1.0 feature roadmap is implied.

## Build provenance

- Windows Server build: [GitHub Actions run 41545605940](https://github.com/NotAzureStudios/Cluster/actions/runs/41545605940).
- Windows Qt Desktop build: [GitHub Actions run 41547147724](https://github.com/NotAzureStudios/Cluster/actions/runs/41547147724).
- Reproducible npm dependency lock, pinned Node 24.20.0, CI compilation, source-integrity checks, and independent Server/Desktop packaging: merged source history on `main`.

**Release declaration is not a substitute for runtime verification.** The above are published limitations, not hidden certification claims.
