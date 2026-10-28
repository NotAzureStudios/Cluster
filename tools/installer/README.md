# Cluster 1.0 RC Installer (Windows x64)

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

The first build requires internet and disk space. The ordinary native Server Manager is not intentionally elevated; Windows service-management operations can require administrator permission. Native Windows startup and database acceptance still require on-machine testing. Rebuild from source with `npm run cluster:installer:build` on a development host with Node and Go.

This is an independently bootstrapped release candidate. No existing Cluster installation, build directory, system Node, Go, npm or PostgreSQL installation is required. A first run downloads verified private tools, compiles the embedded source in a fresh staging directory and verifies artifacts and regression scripts before replacing anything. A later RC executable upgrades by RC sequence, not file modification time. An `1.0.0-rc.x` label is the release-candidate identity; the source/API version stays `0.546.0` until stable certification. 1.0 is **not** certified.

## Root-level server startup (RC9)

The complete source archive now contains `Cluster Server.exe` **and** `Cluster-Installer.exe` at the archive root. Double-click `Cluster Server.exe` for day-to-day operation: with no managed installation it delegates to the adjacent installer; once installed it starts the native Server Manager in automatic-start mode from `<same folder>/Cluster/Server`. Root startup does not build or download dependencies itself, nor does it rely on old RC install folders.

## Windows source-build installer and normal startup

The installer **does** compile the complete Windows server application on the target machine. It provisions pinned private Node.js and Go, generates Prisma, builds the API/web frontend and native Windows manager/host/helper binaries, and verifies the final deployed application before marking it installed. The installer can do this on a genuinely clean machine, without earlier RC installations.

The two ZIP-root entry-point EXEs are deliberately small. `Cluster Server.exe` starts the installed software without compiling anything; if a built component is missing or damaged it reports a repairable error instead of secretly running a compiler. `Cluster-Installer.exe` owns the entire compile-and-install process. The Qt native desktop client is a separate application and not included in the Windows server build.

`RC12_RELEASE_NOTES.md` documents the unverified Windows runtime acceptance gates.
