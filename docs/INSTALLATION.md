# Install Cluster 1.0.x on Windows

> **1.0.1 Server status:** The source on `main` is updated to **1.0.1** with the first-install admission fixes, and its rebuilt Windows installer has **passed the official build and hash checks**; the unsigned test package is in [GitHub Actions run 41565552099](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099), not yet in a standalone 1.0.1 GitHub Release. The historical **v1.0.0 Server installer is broken** and should not be rerun. See [1.0.1 source notes](releases/CLUSTER_1_0_1_SOURCE.md). Do not erase any PostgreSQL/Library data you still need just to troubleshoot the installer.

This guide covers the **1.0.1 Server test installer** and the independently versioned, previously published Desktop installer. The server and native Desktop client are separate products. Only the Server hosts data and the browser interface.

**Download sources:** [Server 1.0.1 verified CI artifact](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099) and [historical v1.0.0 Desktop release](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0).

> **Before using it:** These Windows x64 artifacts were compiled and checksum-verified, but have **not** completed a live clean-machine installation or in-place upgrade acceptance test. Both installers are **unsigned**. Use an authorized studio machine, verify the downloaded file hashes, and retain independent backups. Do not replace a working installation as an experiment.

> **Critical known v1.0.0 Server installer defect:** On a real Windows install, `Cluster-Installer.exe` fails its prebuilt runtime gate with `Source: tools/installer/Install-Cluster.ps1`; the tool intentionally excluded that source file but the preflight still required it. It also contains a second source-only smoke test that cannot run from the packaged payload. This is a **release packaging defect** tracked in [PR #31](https://github.com/NotAzureStudios/Cluster/pull/31), not a request to reinstall Windows, wipe your data, or install a global Node runtime. **Do not retry the unchanged Server v1.0.0 EXE expecting it to work.** The corrected **1.0.1 unsigned Windows test artifact** has been built and hash-verified, but has not yet passed installation testing. Preserve `installer.log` and any existing Server data; never reuse the broken v1.0.0 installer. Desktop is a separate package.

## What to download

| File | Install on | What it contains |
| --- | --- | --- |
| [Cluster Server 1.0.1 CI test installer](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099) | Windows **Server** test machine | **Built and SHA-256 verified, unsigned.** Download the workflow artifact ZIP and extract `bin/Cluster-Installer.exe` |
| [`Cluster-Installer.exe` (v1.0.0, known broken)](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Installer.exe) | Windows **Server** machine | **Historical only. Do not install** |
| [`Cluster-Desktop-Installer-0.482.0-windows-x64.exe`](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Desktop-Installer-0.482.0-windows-x64.exe) | Each **Desktop** machine | Native Qt desktop application; no Server or database |
| [`Cluster-Desktop-0.482.0-windows-x64.zip`](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.0/Cluster-Desktop-0.482.0-windows-x64.zip) | Desktop alternative | Portable Desktop application files |

The Desktop native package retains its independent internal `0.482.0` version. **The new Windows Server installer embeds genuine `1.0.1` source**, built at commit `747832c6cdf53a97c0923e045c04c08e8b17d5a0`. The broken historical v1.0.0 Server binary still has its RC50/`0.546.0` identity; it has not been silently replaced.

## 1. Prepare the Server machine

- Use **64-bit Windows** with enough disk space for the application, private runtimes, PostgreSQL database and Library files.
- The Server installer may need **internet access** for pinned, checksum-verified private Node.js and PostgreSQL runtime downloads. It does not require you to install system-wide Node or PostgreSQL manually.
- Choose a **new dedicated writable folder** for this installation. For example, `D:\Cluster-Server\`. Avoid protected Windows program directories for the portable Server data root.
- Keep your Server database/Library storage and credentials private, not in Git, and restrict access to authorized studio users.
- If you have an **existing** Cluster Server or PostgreSQL data directory, do not attempt an in-place upgrade with these uncertified installers. Preserve a verified, external database and Library backup first.

## 2. Install Cluster Server

1. Place the downloaded `Cluster-Installer.exe` in the dedicated folder, for example `D:\Cluster-Server\Cluster-Installer.exe`.
2. Verify its SHA-256 value using the command below. It must match the [1.0.1 Windows build receipt](releases/CLUSTER_1_0_1_SOURCE.md).
3. Launch `Cluster-Installer.exe` with your normal authorized Windows account. Approve elevation only when Windows requests it for a privileged operation. **There is no signed-publisher certificate on this build.**
4. Let the installer complete. Its embedded program stages a portable `Cluster\` directory **beside the installer**. For the example above, the managed Server root is `D:\Cluster-Server\Cluster\Server\`. The installer log is `D:\Cluster-Server\Cluster\installer.log`.
5. Open the native **Cluster Server Manager** (`Cluster Server.exe` in the managed Server's `bin\` folder) if it was not already started. Use the Manager to inspect logs and confirm the API and database are healthy.
6. Complete the first-Owner account enrollment through the **local** Server setup experience. Do not expose unclaimed Owner setup to the public internet.
7. When the Server reports ready, open its configured Web URL in a browser and sign in. The port and URL depend on the actual Server configuration; do not assume a hard-coded public address.

To verify a download in PowerShell:

```powershell
Get-FileHash 'D:\Cluster-Server\Cluster-Installer.exe' -Algorithm SHA256
```

Expected Server installer SHA-256:

```text
2719e1b1336144773c0e5ad9b361fae2d73109c08b2495592f04a92ccc9968f7
```

**What not to do:** Do not delete `Cluster\Server\data`, `runtime`, Library storage, Owner credentials, or existing PostgreSQL files to recover from a failed install. A damaged existing database is not an empty-install problem. See the [Server recovery operator guide](development/NATIVE_WINDOWS_SERVER_RECOVERY.md).

## 3. Install Cluster Desktop

1. On a Windows x64 desktop machine, download `Cluster-Desktop-Installer-0.482.0-windows-x64.exe` (or the portable ZIP if you prefer an unpacked application).
2. Verify the installer SHA-256:
   ```powershell
   Get-FileHash '.\Cluster-Desktop-Installer-0.482.0-windows-x64.exe' -Algorithm SHA256
   ```
   Expected: `0e983320e440ff0b25cd56b8e14b6fcc76d565188e59245ca90923ec58537a05`.
3. Run the **Desktop-only** installer and start Cluster Desktop. For the portable ZIP, extract it fully and run the packaged `Cluster.exe` rather than launching files directly from the ZIP.
4. Add/select the Server's configured address in Desktop's server profile chooser, then authenticate with the **studio-admin-created** account. The native server profile manager is available from the tray or **Ctrl+Shift+S**.
5. For a remote Server, use a trusted **HTTPS** endpoint; localhost HTTP is intended for local development. Confirm your Server is reachable before troubleshooting Desktop sign-in.

Desktop uses isolated native/WebView storage per saved Server profile. It does not contain the Server executable or a PostgreSQL instance.

## 4. After installation

Confirm the basic daily-use paths before trusting this setup with studio data: Server restarts, Owner sign-in, role restrictions, a new test project, a test Library upload and download, and a Desktop reconnection. Keep an external backup of PostgreSQL plus Library files/configuration. Stop and record errors rather than repeatedly reinstalling into a damaged data directory.

For Server diagnostics, see [Windows Server recovery](development/NATIVE_WINDOWS_SERVER_RECOVERY.md). For developer builds see [Local setup](development/LOCAL_SETUP.md).

## Update and support boundaries

- **Automatic Server installer apply/rollback is not certified in 1.0.** “Check Updates” verifies eligible signed manifests; it is not proof of unattended safe deployment.
- **Installer repair is sensitive.** An explicit same-release `Cluster-Installer.exe --repair` path exists but must use the *exact* installed prebuilt revision. It is not a general upgrade command. Follow the operator guide rather than guessing.
- The initial release's **unsigned** binaries may trigger SmartScreen or antivirus warnings. Independently verify hashes; do not disable system-wide security protections merely to run the app.
- Do not publish any source code, installer, token, private key, logs containing credentials, or Library data outside authorized Azure Studios channels.
- Report defects internally with product, `v1.0.0` release label, actual Server/Desktop component version, Windows version and **redacted** logs.

All SHA-256 values and original build commit IDs are recorded in [the 1.0 release notes](releases/CLUSTER_1_0_0.md).
