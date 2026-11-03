# Install Cluster 1.0.1 on Windows

Cluster 1.0.1 is a private Azure Studios release for **Windows x64**. The Server and native Desktop are separate applications. Install the Server first; then access Cluster in a browser or connect the Qt Desktop client.

## Downloads

All current Windows binaries are available from the **[Cluster v1.0.1 GitHub Release](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.1)**.

| File | Where to install | Purpose |
| --- | --- | --- |
| **[Cluster-Installer.exe](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.1/Cluster-Installer.exe)** | Windows Server machine | Managed Server, Web/API runtime and Server Manager |
| [Cluster-Desktop-Installer-0.482.0-windows-x64.exe](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.1/Cluster-Desktop-Installer-0.482.0-windows-x64.exe) | Each workstation | Native Qt Desktop client, not a Server |
| [Cluster-Desktop-0.482.0-windows-x64.zip](https://github.com/NotAzureStudios/Cluster/releases/download/v1.0.1/Cluster-Desktop-0.482.0-windows-x64.zip) | Workstation alternative | Portable Desktop package |

Cluster Server/Web is **1.0.1**. The Qt Desktop executable uses its separately maintained binary version **0.482.0** and has not been rebuilt for this Server hotfix.

### Verify the downloads

These Windows executables are **not digitally signed** by a publisher certificate, so Windows may identify their publisher as unknown. They were produced and SHA-256-verified through pinned build workflows. Check the checksum rather than disabling Windows security protections.

In PowerShell, from the directory containing your downloaded Server installer:

```powershell
Get-FileHash .\Cluster-Installer.exe -Algorithm SHA256
```

Expected Server installer SHA-256:

```text
2719e1b1336144773c0e5ad9b361fae2d73109c08b2495592f04a92ccc9968f7
```

Expected Desktop installer SHA-256: `0e983320e440ff0b25cd56b8e14b6fcc76d565188e59245ca90923ec58537a05`. The [release notes](releases/CLUSTER_1_0_1.md) contain all build identities and checksums.

## 1. Prepare the Server

- Use a **Windows x64** machine with space for the Server program, private Node/PostgreSQL runtimes, database and Library files.
- Choose a new writable installation folder such as `D:\Cluster-Server\` or `C:\Cluster-Server\`. Avoid placing the portable Server's managed data root beneath protected system folders.
- Allow the initial installer to download its pinned private runtime dependencies if needed. You do **not** need to install Node.js or PostgreSQL globally just to use the packaged Server.
- If replacing an existing installation, preserve any PostgreSQL database, Library contents, configuration and credentials you still need **before** deleting the old folder. A clean install does not migrate an existing database automatically.
- Keep the initial Owner enrollment on a trusted local network. Do not expose an unclaimed setup endpoint to the internet.

## 2. Install the Server

1. Place `Cluster-Installer.exe` in the chosen empty directory, for example `D:\Cluster-Server\Cluster-Installer.exe`.
2. Verify its SHA-256 checksum with the command above.
3. Launch it with an authorized Windows account. Only approve elevation when Windows requests it for a necessary privileged operation.
4. The installer stages its managed files in a `Cluster\` directory **beside the EXE**. For the example path, the managed root is `D:\Cluster-Server\Cluster\Server\` and the installer log is `D:\Cluster-Server\Cluster\installer.log`.
5. Open the native **Cluster Server Manager** from the managed Server's `bin\Cluster Server.exe` if it does not open automatically.
6. Use the Manager logs and health controls to confirm that the API, Web UI and managed database are operational.
7. Finish the local Owner setup. Then open the configured Server Web address and sign in.

The actual URL/port comes from your Server configuration, not from an assumed public address.

## 3. Install Desktop (optional)

1. Download the 1.0.1 release's native Desktop installer or portable ZIP.
2. Verify the Desktop installer hash above.
3. Run the installer. For the portable ZIP, extract all files and launch the packaged `Cluster.exe`.
4. Start Desktop, select or add the Server URL in the server profile chooser, and sign in with an administrator-created studio account. The server profile switcher is available from the tray or **Ctrl+Shift+S**.
5. Use a trusted **HTTPS** address for a remote Server. Loopback HTTP may be used for local development.

Desktop does not install the API, PostgreSQL or the Windows Server Manager.

## 4. First-run checks

Before relying on a fresh installation for studio data, confirm that the Server starts and restarts, Owner login works, role restrictions behave correctly, a test project can be created, Library upload/download works, and Desktop can reconnect.

The 1.0.1 installer has **passed Windows compilation, packaging and file-integrity verification**, but its first-run and recovery behavior has not yet been independently confirmed on a real workstation. If the installer fails, keep `Cluster\installer.log` and report the relevant **redacted** error. Repeatedly wiping and reinstalling over data is not a repair strategy.

For Server recovery details, see [Windows Server recovery](development/NATIVE_WINDOWS_SERVER_RECOVERY.md). Automatic update installation/rollback and interrupted-restore workflows have not been runtime-certified. Preserve separate database and Library backups.

## Support and development

Report defects internally with the Cluster release (`1.0.1`), native Desktop component version if applicable, Windows version, reproducible steps and sanitized logs. See [Support](../SUPPORT.md) and [Security](../SECURITY.md). Developer source and toolchain setup are documented in [Local setup](development/LOCAL_SETUP.md).
