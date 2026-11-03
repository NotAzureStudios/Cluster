# Cluster 1.0.1

**Private Azure Studios release · Windows x64 · November 2, 2026**

Cluster 1.0.1 is the current studio release. It replaces the 1.0.0 Windows Server installer with a clean build that fixes the initial installation failure. The Qt Desktop client remains at its independently maintained binary version **0.482.0**.

## What's fixed

The 1.0.0 Server installer rejected its own prebuilt runtime because it requested a source-only PowerShell file not present in the installed payload, followed by an excluded source-only smoke suite. The 1.0.1 Server installer now validates the prebuilt identity and compiled runtime dependencies through the installer path instead of requiring developer-only source files. The Server/Web runtime and native build identity have also been updated consistently to **1.0.1**.

## Downloads

| File | Description |
| --- | --- |
| `Cluster-Installer.exe` | **Cluster Server 1.0.1 Windows x64 installer.** Contains native Server Manager, Server and hosted Web components |
| `Cluster-Server.exe` | Separately downloadable native Server Manager executable (also included through the installer) |
| `Cluster-Desktop-Installer-0.482.0-windows-x64.exe` | Native Qt Desktop Windows installer, independently versioned 0.482.0 |
| `Cluster-Desktop-0.482.0-windows-x64.zip` | Portable native Desktop alternative |
| `Cluster-server-build-receipt.json` | Source commit, pinned package lockfile hash and Server build evidence |
| `Cluster-desktop-build-receipt.json` | Original Qt Desktop build evidence |

## Original build provenance and SHA-256

The 1.0.1 Server installer was compiled through [Windows build run 41565552099](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099), using Node.js **24.20.0**, Go **1.27.1** and the pinned npm lockfile. All **10 checks** associated with that source revision passed, including full Windows compilation/packaging, source hygiene and installer contract tests.

| Component | Original compiled-source commit | SHA-256 |
| --- | --- | --- |
| `Cluster-Installer.exe` | `747832c6cdf53a97c0923e045c04c08e8b17d5a0` | `2719e1b1336144773c0e5ad9b361fae2d73109c08b2495592f04a92ccc9968f7` |
| `Cluster-Server.exe` | `747832c6cdf53a97c0923e045c04c08e8b17d5a0` | `ec0377398787e33c54b502a046992c6620aa16f4bd6af9bfbad720bb2f2c153d` |
| `Cluster-Desktop-Installer-0.482.0-windows-x64.exe` | `428f3182e18b0733726f049aa48234bb4688529d` | `0e983320e440ff0b25cd56b8e14b6fcc76d565188e59245ca90923ec58537a05` |
| `Cluster-Desktop-0.482.0-windows-x64.zip` | `428f3182e18b0733726f049aa48234bb4688529d` | `30b0d3cd64ea2c787a4eb87bfb5ba5bb50b19dd566e89a70746dee8f15242862` |

The release tag consolidates the 1.0.1 code and documentation. The packaged binaries retain the exact earlier source commits shown above. No binary was silently rebuilt or renamed to change its embedded code.

## Install and first run

Read the [Windows installation instructions](https://github.com/NotAzureStudios/Cluster/blob/main/docs/INSTALLATION.md). For a new Server installation, place `Cluster-Installer.exe` in a new writable directory and run it, then configure Server Manager and initial Owner access. Install Desktop separately if required.

**Windows signing:** These binaries do not have an Authenticode publisher signature; Windows may show an unknown-publisher warning. Their exact build hashes are listed above, and the release publisher verifies the binaries against those hashes before attaching them.

**Runtime acceptance:** Compilation, regression checks, package structure and SHA-256 verification passed. **Real workstation installation, startup, upgrade and restore behavior have not yet been independently accepted.** The release does not claim signing, full update/rollback certification, or penetration-testing certification. Preserve existing data and test on a new installation before relying on it for studio operations.

The 1.0.0 Server installer failure is fixed in the 1.0.1 source and package. Older version defects are recorded in their corresponding historical release records.

**Support:** Report problems privately with the 1.0.1 version, Windows edition, installation log (`Cluster\installer.log`) and sanitized reproduction steps.
