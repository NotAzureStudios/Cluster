# Install Cluster on Windows

These instructions distinguish the **[current Server 1.0.4 Windows test build](https://github.com/NotAzureStudios/Cluster/actions/runs/41727710185/artifacts/13276086331)** from GitHub's **[latest published stable release (1.0.2)](https://github.com/NotAzureStudios/Cluster/releases/latest)**. The Server and Qt Desktop are separate Windows x64 packages.

## Get the current installers

| Download | Purpose |
| --- | --- |
| **[Cluster Server 1.0.4 unsigned test installer ZIP](https://github.com/NotAzureStudios/Cluster/actions/runs/41727710185/artifacts/13276086331)** | Windows x64 Server build artifact from a successful [GitHub Actions run](https://github.com/NotAzureStudios/Cluster/actions/runs/41727710185); extract `bin/Cluster-Installer.exe`. Artifact expires **November 17, 2026**. |
| [All new Server Windows build runs](https://github.com/NotAzureStudios/Cluster/actions/workflows/cluster-server-windows-build.yml) | Find the latest successful `main` build after the pinned artifact expires. |
| [GitHub latest **published** release](https://github.com/NotAzureStudios/Cluster/releases/latest) | Still v1.0.2, **not** the current v1.0.4 Server source. Never install this older Server EXE over 1.0.3. |
| [Latest published Cluster Desktop installer](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Installer.exe) | Separate Windows x64 Qt Desktop application. |
| [Published portable Desktop ZIP](https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Desktop-Portable.zip) | Portable Desktop client. |

The 1.0.4 Server artifact is an **unsigned test build**, not a published signed update. It passed build and clean-install checks but not a full populated-server recovery certification. Do not assume merging a source commit updates existing Windows installations.

### Verify a download

These executables may not have a Windows publisher signature. Verify the SHA-256 hash against the **current release notes**, rather than an older version's hash:

```powershell
Get-FileHash '.\Cluster-Installer.exe' -Algorithm SHA256
```

For **published** releases, compare with the release's checksum/receipt. For the **1.0.4 Actions test build**, compare with `artifacts/release-profiles/server-windows-x64/build-receipt.json` **inside the same ZIP**, not the older v1.0.2 release notes. Windows Authenticode signing is not present in this artifact.

## 1. Prepare a Windows Server

- Choose an authorized Windows x64 machine with sufficient disk space for the application, managed runtimes, PostgreSQL and Library storage.
- Put the Server installer in a **new writable directory**, for example `D:\Cluster-Server\` or `C:\Cluster-Server\`. Do **not** place it directly at `C:\` or another drive root; dedicated installation folders avoid Windows ACL and launcher-placement problems.
- Initial setup may download pinned private Node.js and PostgreSQL runtimes. Global Node/PostgreSQL installations are not required for normal packaged use.
- If replacing an existing Cluster installation, back up any PostgreSQL, Library, configuration and credentials you need before deleting the old install. Fresh installation does not automatically restore existing data.
- Keep Owner enrollment restricted to the local/trusted studio network.

## 2. Install the Server

1. Download the intended installer: use the 1.0.4 Actions artifact above for the 1.0.4 Server, not GitHub's older `releases/latest` Server EXE.
2. Extract the ZIP and verify `bin/Cluster-Installer.exe` against the included build receipt, then put the installer in the desired **installation parent** folder.
3. Run the installer with an authorized Windows account, approving elevation only when necessary.
4. The managed program is placed in a `Cluster\` subfolder beside the installer. If the EXE was at `D:\Cluster-Server\Cluster-Installer.exe`, the managed Server root is `D:\Cluster-Server\Cluster\Server\` and the installer log is `D:\Cluster-Server\Cluster\installer.log`.
5. Use the native **Cluster Server Manager** in the managed Server's `bin\` folder to inspect startup and API/database status.
6. Finish the initial Owner setup locally and open the configured Web URL.

Do not assume a hard-coded public port or Web address; use the actual Server settings.

**PostgreSQL setup:** For a normal managed Server installation, Cluster downloads and initializes a private PostgreSQL runtime, creates its database and credentials, and generates `DATABASE_URL`/`DIRECT_DATABASE_URL` during Server Manager startup. You do **not** need to supply a database URL manually. If a direct Prisma or developer command reports a missing URL, start Cluster through the installed Server Manager instead. If the managed Server Manager itself reports this error, retain its redacted bootstrap log: it indicates a separate startup/configuration failure, not a request to guess credentials.

## Upgrade an existing 1.0.3 Server in place

**The installer does not ask for a target folder. It always creates or updates the `Cluster` folder beside `Cluster-Installer.exe`.** Running the EXE in Downloads, inside `Cluster\Server`, or beside an unrelated `Cluster` directory can create a second installation. Never use the older v1.0.2 release to upgrade 1.0.3.

For the **`C:\Cluster\Server`** installation shown by the native Server Manager:

1. Back up the managed PostgreSQL database with a proper offline/consistent database backup, plus the Library, configuration and account keys. Verify the backup separately. Keep existing directories intact.
2. Stop Cluster from Server Manager and confirm its managed PostgreSQL, Node, and Host processes have stopped. If a Windows Service owns it, stop that service too.
3. Extract the **1.0.4** GitHub Actions ZIP. Copy its `bin\Cluster-Installer.exe` to **`C:\Cluster-Installer.exe`** so the installer's managed target is **`C:\Cluster\Server`**. The C: drive root may require administrative rights. Do not move the existing `C:\Cluster` data folder or run the EXE from another directory.
4. Run `C:\Cluster-Installer.exe` with the required Windows permissions and let it finish. Review `C:\Cluster\installer.log` if it refuses the upgrade or detects active processes.
5. Start the installed **`C:\Cluster\Server\bin\Cluster Server.exe`** directly (or the verified Windows Service). Do **not** trust an older root-level `C:\Cluster Server.exe` or pinned Windows shortcut: the installer intentionally skips publishing that optional launcher when the install parent is a drive root.
6. Confirm `C:\Cluster\Server\CLUSTER_RELEASE.json` says `"releaseCandidate": "1.0.4"`, the native Manager identifies as **1.0.4**, PostgreSQL starts, the same projects/Library remain present, and login and Web/API ports work. If either version differs, stop and inspect the log rather than deleting directories or rerunning random EXEs.

If your existing workspace is `D:\Cluster-Server\Cluster\Server` instead, place the installer at `D:\Cluster-Server\Cluster-Installer.exe`. The critical rule is always **installation parent → Cluster → Server**.

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
