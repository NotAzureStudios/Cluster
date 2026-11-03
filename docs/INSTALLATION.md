# Install Cluster on Windows

These instructions follow the **[latest stable Cluster release](https://github.com/NotAzureStudios/Cluster/releases/latest)**. The Server and Qt Desktop are separate Windows x64 packages.

## Get the current installers

| Download | Purpose |
| --- | --- |
| **[Latest Cluster Server installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe)** | Windows Server, API, Web and native Server Manager |
| **[Latest Cluster Desktop installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Installer.exe)** | Windows x64 Qt Desktop application |
| [Latest portable Desktop ZIP](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Portable.zip) | Portable Desktop application files |

Since **v1.0.2**, Server and Desktop have permanent direct-download filenames pointing to the latest stable release. The Desktop's internal component version remains independent of the suite version. Future release publishers must keep these stable filenames. [Release asset naming](development/RELEASE_ASSET_NAMING.md).

### Verify a download

These executables may not have a Windows publisher signature. Verify the SHA-256 hash against the **current release notes**, rather than an older version's hash:

```powershell
Get-FileHash '.\Cluster-Installer.exe' -Algorithm SHA256
```

Use the SHA-256 listed in the current [GitHub release](https://github.com/NotAzureStudios/Cluster/releases/latest). The hash changes when a binary is rebuilt **or signed**. For signing options, see [Windows code signing](development/WINDOWS_CODE_SIGNING.md).

## 1. Prepare a Windows Server

- Choose an authorized Windows x64 machine with sufficient disk space for the application, managed runtimes, PostgreSQL and Library storage.
- Put the Server installer in a **new writable directory**, for example `D:\Cluster-Server\` or `C:\Cluster-Server\`. Do **not** place it directly at `C:\` or another drive root; dedicated installation folders avoid Windows ACL and launcher-placement problems.
- Initial setup may download pinned private Node.js and PostgreSQL runtimes. Global Node/PostgreSQL installations are not required for normal packaged use.
- If replacing an existing Cluster installation, back up any PostgreSQL, Library, configuration and credentials you need before deleting the old install. Fresh installation does not automatically restore existing data.
- Keep Owner enrollment restricted to the local/trusted studio network.

## 2. Install the Server

1. Download the current `Cluster-Installer.exe` via the stable link above.
2. Verify its current SHA-256 hash in PowerShell.
3. Run the installer with an authorized Windows account, approving elevation only when necessary.
4. The managed program is placed in a `Cluster\` subfolder beside the installer. If the EXE was at `D:\Cluster-Server\Cluster-Installer.exe`, the managed Server root is `D:\Cluster-Server\Cluster\Server\` and the installer log is `D:\Cluster-Server\Cluster\installer.log`.
5. Use the native **Cluster Server Manager** in the managed Server's `bin\` folder to inspect startup and API/database status.
6. Finish the initial Owner setup locally and open the configured Web URL.

Do not assume a hard-coded public port or Web address; use the actual Server settings.

**PostgreSQL setup:** For a normal managed Server installation, Cluster downloads and initializes a private PostgreSQL runtime, creates its database and credentials, and generates `DATABASE_URL`/`DIRECT_DATABASE_URL` during Server Manager startup. You do **not** need to supply a database URL manually. If a direct Prisma or developer command reports a missing URL, start Cluster through the installed Server Manager instead. If the managed Server Manager itself reports this error, retain its redacted bootstrap log: it indicates a separate startup/configuration failure, not a request to guess credentials.

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
