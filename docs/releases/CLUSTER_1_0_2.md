# Cluster 1.0.2

**Private Azure Studios Windows x64 Server hotfix.**

This release fixes the two issues identified during 1.0.1 installation, without changing the native Qt Desktop application.

## Fixed

- **Installing from a drive root no longer fails after deployment.** The previous installer tried to copy its optional convenience launcher to `C:\Cluster Server.exe.cluster-staging`, which a normal Windows account could not create. The installer now skips that optional launcher when the parent is a Windows volume root and retains the verified managed Server application and startup path.
- **Managed PostgreSQL URL lookup is corrected.** The managed Windows launcher generates `DATABASE_URL` and `DIRECT_DATABASE_URL` after initializing its private PostgreSQL database. The database utility now also reads these from the actual managed `apps/server/.env` location when the installer ownership marker is present, rather than expecting only the separate portable `data/Runtime/server.env` layout. No default password, database URL, or connection to an unknown server is invented.
- **More meaningful Windows installer validation.** The release pipeline executes the compiled `Cluster-Installer.exe` in a new isolated Windows directory, checks managed deployment identity, compiled files, ownership manifest and launcher integrity, and aborts publication if the installation fails.

## Windows downloads

| File | Purpose |
| --- | --- |
| `Cluster-Installer.exe` | **Cluster Server 1.0.2** managed Windows x64 installer (current Server download) |
| `Cluster-Server.exe` | Separately downloadable native Server Manager convenience entry (also included via installer) |
| `Cluster-Desktop-Installer.exe` | Stable-name alias for the unchanged native Qt Desktop installer |
| `Cluster-Desktop-Portable.zip` | Stable-name alias for the unchanged portable native Qt Desktop |
| `Cluster-Desktop-Installer-0.482.0-windows-x64.exe` | Original Desktop installer component identity |
| `Cluster-Desktop-0.482.0-windows-x64.zip` | Original portable Desktop component identity |
| `Cluster-server-build-receipt.json`, `Cluster-desktop-build-receipt.json` | Original build provenance/identity and hash records |

Native Desktop is **0.482.0**, independently versioned and byte-identical to the already-released Desktop package. These are separate installed products, and the Desktop binary was not silently relabeled to 1.0.2.

## Original binary build SHA-256

| File | Source commit | SHA-256 |
| --- | --- | --- |
| `Cluster-Installer.exe` | `92f2b9f1ce219176b4433ecebfdfe602a8463786` | `3a2f806a6bc393a0d12ddbc45615497edb29c65cfcd981dc5bbe5a3ad7e746ad` |
| `Cluster-Server.exe` | `92f2b9f1ce219176b4433ecebfdfe602a8463786` | `e14d7bd8797043349966f56473ca3e9fd15a75ca250470ee111833ed62d460b7` |
| `Cluster-Desktop-Installer.exe` and versioned installer | `428f3182e18b0733726f049aa48234bb4688529d` | `0e983320e440ff0b25cd56b8e14b6fcc76d565188e59245ca90923ec58537a05` |
| `Cluster-Desktop-Portable.zip` and versioned portable ZIP | `428f3182e18b0733726f049aa48234bb4688529d` | `30b0d3cd64ea2c787a4eb87bfb5ba5bb50b19dd566e89a70746dee8f15242862` |

**Evidence:** [Windows 1.0.2 build and real first-install smoke run 41575694455](https://github.com/NotAzureStudios/Cluster/actions/runs/41575694455). It passed compilation and source/lockfile/receipt verification, then actually executed the compiled EXE and verified the installed files, marker and launcher on Windows. All nine source CI workflows passed on the preceding PR. The built binary's source commit precedes documentation-only release notes; the GitHub tag preserves the consolidated source and documentation.

## Setup and limitations

Install from a **dedicated writable directory** such as `C:\Cluster-Server\`, not directly at `C:\`. On fresh managed installation, PostgreSQL and its connection URL are initialized by Server Manager. **You should not need to provide a database URL manually.** Use the installed native Manager rather than running Prisma commands directly.

**Important scope of testing:** The actual Windows installer was executed and validated in an isolated clean directory. The test deliberately **did not start the managed PostgreSQL process, API, or browser client**, and did not certify updates, restore, sign-in or recovery behavior. These require real Server acceptance. If startup fails, preserve the redacted `Cluster\Server\data\system\logs\bootstrap.log` and `Cluster\installer.log` for review, and do not erase existing PostgreSQL data. See the [current Windows installation guide](https://github.com/NotAzureStudios/Cluster/blob/main/docs/INSTALLATION.md).

**Windows signing:** The binaries are **unsigned** (no Authenticode publisher certificate). SHA-256 verifies byte integrity but is not proof of a publisher identity. No codesigning claim is made; see the [Windows signing guide](https://github.com/NotAzureStudios/Cluster/blob/main/docs/development/WINDOWS_CODE_SIGNING.md).

This is a targeted private studio maintenance release. It introduces no additional feature or roadmap commitments.
