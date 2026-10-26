# Cluster Installer (Windows x64)

`Cluster-Installer.exe` is a single self-contained installer executable. Place it in the directory where Cluster should live and double-click it. It extracts a managed **`Cluster/`** directory beside the executable. **The running PostgreSQL server and application cannot live entirely inside an EXE**; they need writable files. All downloads, builds, program files, logs, and private toolchains stay within this one directory.

Example:

```text
D:\Cluster-Server\Cluster-Installer.exe
D:\Cluster-Server\Cluster\
    Server\       # Installed application and native manager
    Toolchains\   # Private Node + Go and caches
    Revisions\    # Source revision archive
    Build\        # Build staging
    Rollback\     # Previous application snapshots
    Temp\         # Build temp files
    installer.log
```

It **never overwrites the parent directory** or other unmanaged installations. A new full-source ZIP can be dragged onto the EXE to update. Unchanged installed revisions can start without rebuilding. Pre-existing `D:\ClusterStudio-Managed` and `%LOCALAPPDATA%\ClusterStudio` installs are never touched or deleted. Manually inspect old installations and back up their data before moving anything.

The first build requires internet and disk space and may prompt for elevation from the native Windows manager. Native Windows startup and database acceptance still require on-machine testing. Rebuild from source with `npm run cluster:installer:build` on a development host with Node and Go.
