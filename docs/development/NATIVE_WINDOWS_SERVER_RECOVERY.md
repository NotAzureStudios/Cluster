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
