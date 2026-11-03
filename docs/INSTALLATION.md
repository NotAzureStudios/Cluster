# Install Cluster on Windows

These instructions follow the **[latest stable Cluster release](https://github.com/NotAzureStudios/Cluster/releases/latest)**. The Server and Qt Desktop are separate Windows x64 packages.

## Get the current installers

| Download | Purpose |
| --- | --- |
| **[Latest Cluster Server installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe)** | Windows Server, API, Web and native Server Manager |
| **[Latest Cluster Desktop](https://github.com/NotAzureStudios/Cluster/releases/latest)** | Open the latest release's **Assets** section and choose the Desktop installer |
| [Latest portable Desktop](https://github.com/NotAzureStudios/Cluster/releases/latest) | Choose the portable Desktop ZIP from the latest release |

The Server installer has a permanent direct-download filename. The currently published Desktop binaries have their own versioned filenames, so the Desktop links point to the **latest release page** and won't become broken when the native Desktop version changes. Future releases should ship stable Desktop aliases as documented in [release asset naming](development/RELEASE_ASSET_NAMING.md).

### Verify a download

These executables may not have a Windows publisher signature. Verify the SHA-256 hash against the **current release notes**, rather than an older version's hash:

```powershell
Get-FileHash '.\Cluster-Installer.exe' -Algorithm SHA256
```

Use the SHA-256 listed in the current [GitHub release](https://github.com/NotAzureStudios/Cluster/releases/latest). The hash changes when a binary is rebuilt **or signed**. For signing options, see [Windows code signing](development/WINDOWS_CODE_SIGNING.md).

## 1. Prepare a Windows Server

- Choose an authorized Windows x64 machine with sufficient disk space for the application, managed runtimes, PostgreSQL and Library storage.
- Put the Server installer in a **new writable directory**, for example `D:\Cluster-Server\`.
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

## 3. Install Desktop (optional)

1. From the [latest stable release](https://github.com/NotAzureStudios/Cluster/releases/latest), select the Desktop installer or portable ZIP under **Assets**.
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
