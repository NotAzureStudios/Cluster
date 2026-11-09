# Install Cluster on Windows

The **[latest stable release](https://github.com/NotAzureStudios/Cluster/releases/latest)** contains separate Windows Server and Qt Desktop packages. Check its release notes and attached receipts for the actual component versions and upgrade requirements.

## Get current installers

| Download | Package |
| --- | --- |
| **[Latest Server installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe)** | Server, API, Web and Server Manager |
| [Latest Desktop installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Installer.exe) | Native Qt Windows Desktop |
| [Latest portable Desktop ZIP](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Portable.zip) | Standalone Qt Desktop |

### Verify a download

Compare SHA-256 with the `Cluster-server-build-receipt.json` or `Cluster-desktop-build-receipt.json` attached to the **same** [release](https://github.com/NotAzureStudios/Cluster/releases/latest):

```powershell
Get-FileHash '.\Cluster-Installer.exe' -Algorithm SHA256
```

Checksum comparison checks bytes, **not** Authenticode publisher identity or signed update-feed authorization. An unsigned installer or passing clean-install smoke test is not evidence of safe upgrade/rollback with populated data. See [Windows code signing](development/WINDOWS_CODE_SIGNING.md).

## 1. Prepare a Windows Server

- Choose an authorized Windows x64 machine with sufficient disk space for the application, managed runtimes, PostgreSQL and Library storage.
- For **new installs**, put the Server installer in a dedicated writable directory, such as `D:\Cluster-Server` or `C:\Cluster-Server`. Avoid drive roots for new installs. **Exception:** upgrading an existing `C:\Cluster\Server` specifically requires the installer at `C:\Cluster-Installer.exe`, with appropriate administrator permissions, because the target is always beside the installer; the optional drive-root shortcut may remain stale.
- Initial setup may download pinned private Node.js and PostgreSQL runtimes. Global Node/PostgreSQL installations are not required for normal packaged use.
- If replacing an existing Cluster installation, back up any PostgreSQL, Library, configuration and credentials you need before deleting the old install. Fresh installation does not automatically restore existing data.
- Keep Owner enrollment restricted to the local/trusted studio network.

## 2. Install the Server

1. Download `Cluster-Installer.exe` from [GitHub Releases → Latest](https://github.com/NotAzureStudios/Cluster/releases/latest).
2. Verify its SHA-256 against the Server receipt attached to the same release and put the installer in the correct **installation parent** folder.
3. Run the installer with an authorized Windows account, approving elevation only when necessary.
4. The managed program is placed in a `Cluster` subfolder beside the installer. If the EXE was at `D:\Cluster-Server\Cluster-Installer.exe`, the managed Server root is `D:\Cluster-Server\Cluster\Server` and the installer log is `D:\Cluster-Server\Cluster\installer.log`.
5. Use the native **Cluster Server Manager** in the managed Server's `bin` folder to inspect startup and API/database status.
6. Finish the initial Owner setup locally and open the configured Web URL.

Do not assume a hard-coded public port or Web address; use the actual Server settings.

**PostgreSQL setup:** For a normal managed Server installation, Cluster downloads and initializes a private PostgreSQL runtime, creates its database and credentials, and generates `DATABASE_URL`/`DIRECT_DATABASE_URL` during Server Manager startup. You do **not** need to supply a database URL manually. If a direct Prisma or developer command reports a missing URL, start Cluster through the installed Server Manager instead. If the managed Server Manager itself reports this error, retain its redacted bootstrap log: it indicates a separate startup/configuration failure, not a request to guess credentials.

## Upgrade an existing Server in place

**The installer does not discover the old Server folder.** It creates or updates `Cluster\Server` beside the installer. Never run the executable from Downloads, inside `Cluster\Server`, or next to an unrelated installation and assume it found your original data.

1. Read the latest release's upgrade limitations. Make a **verified** consistent backup of PostgreSQL, Library, configuration, account secrets and other live data.
2. Confirm the actual workspace from the installed native Server Manager. Stop Cluster and confirm its managed PostgreSQL, Node, Host and any Windows Service processes have stopped.
3. Place the current `Cluster-Installer.exe` at the **installation parent**. For existing `C:\Cluster\Server`, use `C:\Cluster-Installer.exe` with appropriate permissions. For existing `D:\Cluster-Server\Cluster\Server`, use `D:\Cluster-Server\Cluster-Installer.exe`.
4. Run the installer and inspect `Cluster\installer.log` for errors or an unexpected target.
5. Start the managed `Cluster\Server\bin\Cluster Server.exe` directly, or its verified Windows Service. A drive-root installer may not refresh an optional old root-level launcher/shortcut.
6. Compare `CLUSTER_RELEASE.json` and the Manager's displayed version with the actual release downloaded. Verify PostgreSQL startup, login, existing projects/Library and configured Web/API addresses. If the version differs, **do not delete or move data**; inspect the installer log and executable path.

### Historical Server 1.1.1 → 1.1.2 key transition

Server 1.1.2 embeds a replacement Ed25519 public key for future signed Server update manifests. A running 1.1.1 Server cannot authenticate that key through its old update feed. **One manual installer upgrade** is required after backups and before later signed-update delivery can use the new key.

The published 1.1.2 Windows installer was **unsigned** and did not arrive through the signed `server-main` channel. Do not disable signature verification, change update URLs to bypass the trust requirement, or mistake a SHA-256 receipt for an update signature. A clean-install CI pass also does **not** certify populated-database upgrade and rollback. Check current release notes for later changes.



## 3. Install Desktop (optional)

1. Download the current [Desktop installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Installer.exe) or [portable ZIP](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Portable.zip).
2. Check the package checksum against the same release's notes.
3. Run the Desktop installer or fully extract the ZIP and launch `Cluster.exe`.
4. Add/select your Server URL in the profile chooser and authenticate with a studio-admin-created account. Use the tray or **Ctrl+Shift+S** for server profiles.
5. Use HTTPS for remote Server addresses; localhost HTTP is only for local development.

The Desktop package does not install a Server, database or native Server Manager. Its binary version can differ from the Cluster suite release; consult the release notes.

## 4. Validate the installed application

Before using it with real studio data, check Server startup and restart, Owner login, project creation, access permissions, Library upload/download, and Desktop reconnection.

A successful build and installer checksum do not by themselves prove real-machine installation, startup or recovery. If installation fails, preserve the **redacted** error from `Cluster\installer.log` and follow [Windows Server recovery](development/NATIVE_WINDOWS_SERVER_RECOVERY.md) rather than deleting live data. Keep independent PostgreSQL and Library backups.

## Support

Report issues privately with the suite release and native component versions, Windows version, reproduction steps and sanitized logs. See [Support](../SUPPORT.md), [Security](../SECURITY.md) and [Local development](development/LOCAL_SETUP.md).
