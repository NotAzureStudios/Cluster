# Native Windows Server Manager: service and recovery operator notes

These procedures apply to the **managed Cluster Server** installed with `Cluster-Installer.exe`. They are development/RC procedures and are **not** evidence of a certified Windows installation.

## Read-only offline diagnostics

Use the native `Cluster Server.exe` executable with an explicit workspace path:

```powershell
& '.\Cluster Server.exe' --root 'D:\Cluster-Server\Cluster\Server' --diagnose
```

The command prints a JSON report and exits with code 2 when it finds a blocked prerequisite. It checks release ownership, prebuilt artifacts, Node/Prisma/PostgreSQL file presence, PostgreSQL data-directory major version and environment-file presence. It does **not** start PostgreSQL, run `pg_dump`, repair files, execute binaries, inspect table integrity or read credentials. A passing file report is **not** a clean bill of health for the database. The native Manager's **DB Doctor** action performs these read-only checks while the server is stopped; it uses the existing Prisma doctor only while the server is running.

If `PG_VERSION` is missing from an existing database directory, mismatches the PostgreSQL major version, or an old database initialization marker/credential file exists without its data directory, **do not delete or rename anything**. Cluster now fails closed and preserves the directory for recovery.

## Explicit Windows Service installation

1. Complete the first interactive startup so Node, PostgreSQL 18.6, the database credentials and `apps/server/.env` exist. Take and verify a backup.
2. Stop Cluster. From an authorized shell, invoke:

```powershell
& '.\Cluster Server.exe' --root 'D:\Cluster-Server\Cluster\Server' --service-install
```

The service-install action prompts for elevation if required. It refuses an unverified/unmanaged release. It grants `NT AUTHORITY\LocalService` **Modify** access to the managed `data` directory with standard NTFS child inheritance, and to the existing `apps/server/.env` file only. It does **not** grant write access to the binaries, Node/Go toolchains or external NAS volumes, nor does it sweep the data tree recursively with `icacls /T`.

Service registration is attempted only after the scoped ACL grant and a marker write succeed. The marker is **not proof** that LocalService can reach a NAS or a protected child folder. The service's own startup checks run under LocalService and verify actual write access, failing if access is unavailable. External storage permissions require explicit operator configuration; no broad automatic ACL changes are performed.

3. Inspect the service with `sc.exe query ClusterStudioServer`, start it with `sc.exe start ClusterStudioServer`, and inspect `data/system/logs/windows-service.log` for readiness evidence. Windows Service mode does not depend on the control panel remaining open.
4. Stop service via the Manager or `sc.exe stop ClusterStudioServer` before updating. Do not attempt in-place compilation on a managed release.

## Retention and limitations

Native Manager and Windows Service logs rotate at 32 MiB during operation and retain up to four previous logs each. Individual lines are capped at 64 KiB. Recognized database credential URLs, selected environment secrets and Bearer/Basic Authorization headers are redacted. This is defense-in-depth, **not** a guarantee that arbitrary application output contains no sensitive data.

Signed Server updates can currently be **verified and staged**, but supervised installation, post-update health verification and rollback remain unfinished. Offline diagnostics do not perform a PostgreSQL restore drill. Complete a real Windows 11 first-install/service boot/repair/upgrade/restore test before declaring this implementation production-certified.

## Repair before reinstall

The native **Repair Installation** action is available for an installer-managed Server when it has stopped. It requires explicit confirmation, performs no automatic restart, and does **not** run npm, compile the application, apply database migrations, or remove data.

The same maintenance action can be invoked without the GUI:

```powershell
& '.\Cluster Server.exe' --root 'D:\Cluster-Server\Cluster\Server' --repair-managed
```

It validates the installer ownership marker's exact path, confirms the Windows Service is stopped and the Host is not advertising a live control marker, and refuses to operate on damaged/unknown PostgreSQL data. It then:

1. Recreates **missing** internal `node_modules/@cluster` workspace junctions, checking the exact package names and refusing to overwrite physical files, real directories, or foreign links.
2. Repairs the installer-managed Node 24.20.0 runtime from a pinned SHA-256 official archive. It can download that exact version on explicit repair only. Replacement is staged and checked before publication; the previous private runtime is retained as `.repair-previous` when applicable.
3. Restores fully missing portable PostgreSQL 18.6 **program binaries** from the existing hash-verified runtime provisioning path. It never resets or opens `data/postgresql`. A partially damaged existing binary directory requires verified installer intervention instead of destructive overwrite.
4. Checks whether the installed prebuilt server, web and shared outputs and the dependency graph pass managed startup admission.

If compiled application files or dependencies are damaged, **reapply a verified Cluster-Installer.exe to the same managed installation folder**. Do not wipe or move `data`, `runtime`, or the Library. The installer's existing staged publish/rollback mechanism preserves runtime and data. This is an **in-place repair**, not a clean reinstall. The Manager does not automatically execute unsigned installers or guess which release revision is safe.

If the PostgreSQL data directory is missing, has the wrong major version, or lacks `PG_VERSION`, stop. Recover the data from verified backups first. A fresh empty database is **not** a repair.

Successful self-repair means the installed artifacts pass local admission only. Start Cluster deliberately and confirm API readiness, PostgreSQL health, file downloads, and Library access. Windows service-mode recovery, backup/restore and installer reapplication must still be tested on a real Windows installation.

### Exact-revision installer repair for damaged application files

If the native Manager reports **application payload blocked**, use the **verified prebuilt Cluster-Installer.exe for the exact installed release** and invoke:

```powershell
& '.\Cluster-Installer.exe' --repair
```

The installer verifies its bundled release identity against the installed `archiveSha256` and release sequence. It must match **exactly**; it will not downgrade, upgrade, or compile on the repair path. It then validates the embedded archive, rebuilds application files in staging, publishes them into the same managed installation, and preserves `data`, `runtime`, and the original server `.env` file. It keeps the existing rollback snapshot of application files and **does not automatically start the server**. A missing `.env` blocks the operation instead of silently regenerating secrets.

Do not delete the installation folder. Do not run an unverified or different-release installer under the `--repair` flag. Back up the data before performing a full application-file repair and then test startup deliberately.

Integrity verification also checks the **retained compiled application files** against the SHA-256 digests recorded in the packaged prebuilt runtime manifest. The digest scan runs only when repair is explicitly requested, not during ordinary startup or periodic monitoring. A mismatch requires exact-revision in-place installer repair. These local digests detect accidental damage; they are not a substitute for the signed installer’s release authenticity.
