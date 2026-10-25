# Cluster v0.546.0 · F2 P2 Windows Process Ownership & SCM Readiness

Parent: **F2 P1 Windows Service & Tray**, not G27/F3 P4.

## Source-implemented behavior

- Introduced `apps/native-process-job-go`: Windows kernel job ownership (`CreateJobObjectW`, `SetInformationJobObject` with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, `AssignProcessToJobObject`), idempotent release, and job accounting. The Linux build is a development-only no-op; it does not claim production process-tree confinement.
- Both service-owned and standalone-panel-owned **Cluster Host** processes now require successful assignment to a Job Object. On assignment error, launch fails closed: the child is killed and reaped. Job handles remain open for the Host lifetime and are closed on exit, timeout, or stop. Forceful SCM timeouts use the job instead of best-effort `taskkill` process enumeration.
- The Go Host supervises each **Node API generation** with a separate job. Before restarting an unexpectedly exited Node parent, it closes the previous job, preventing the earlier API's surviving grandchildren from competing with the next generation. Normal API shutdown still attempts HTTP drain first.
- The private PostgreSQL starter `pg_ctl` is assigned to a **dedicated long-lived job**. After `pg_ctl` exits, job accounting must show active managed descendant processes or startup fails. Normal cleanup asks `pg_ctl -m fast -w stop` before releasing the job. Cleanup after failed startup also attempts database stop before terminating leftover descendants.
- The Windows Service now stays **SCM_START_PENDING** until the Host publishes an atomic, private readiness marker after its `/health/ready` probe and web listener setup. Stale markers are removed before each service launch. The 90-second handshake is bounded and fails closed. Periodic SCM progress updates support slower initialization; late startup callbacks cannot overwrite stopped/stopping status. The service cannot be marked running merely because its binary started.
- No new database migration, API route, or external network listener was introduced.

## Verification, October 23, 2026

- New F2 P2 source contracts: **48/48**.
- Prior F2 P1 contracts: **46/46**, updated to assert Job Object cleanup rather than outdated `taskkill` fallback.
- F3 P4 emergency alert integration: **32/32**.
- F3 P3 alert routing: **79/79**; atomic policy saves: **25/25**.
- F3 P2 durable incident bridge: **46/46**; dependency readiness: **50/50**.
- Go Linux host and launcher: `go test -race ./...` passed using *temporary* Go 1.23 version-only manifests; restored canonical Go 1.27.1 manifests before packaging.
- Windows x64 test programs cross-compiled for `native-process-job-go`, `host-go`, and `server-launcher-go`; cannot run Windows tests on Linux.
- `go vet` on Windows launcher reports **two inherited unsafe.Pointer warnings** in `launcher_ui_windows.go`; not claimed clean.
- Source scan: 1,121 TS/TSX files, no syntax errors; 3,258 relative renderer imports, none missing; 110 CSS files, no brace errors.

## Explicit unresolved limitations

1. **No live Windows SCM service boot/shutdown**, startup rollback, real Windows Job Object tests, process-tree fault injection, or Windows Server user-mode UI tests. Windows cross-compilation is not runtime certification.
2. The Go standard `exec.Cmd.Start` launches a process before `AssignProcessToJobObject` runs. Assignment is fail-closed but there is a narrow pre-assignment spawn race. Native suspended-process creation or equivalent atomic spawn-to-job ownership should be evaluated during Windows acceptance testing before claiming an absolute no-orphan guarantee. PostgreSQL's post-`pg_ctl` job accounting checks mitigate detached-server risk but do not prove universal containment under every executable.
3. Service account privilege and NAS/SMB permissions are not certified. Win32 pointer vet warnings remain inherited.
4. PostgreSQL/Node startup and Windows shutdown/OS-update/reboot handling must be fault-tested on the actual Windows workstation. The database's emergency job termination may lead to WAL recovery on next startup; backup/restore and corruption checks remain release gates.
5. Full pinned Go 1.27.1, Node 24, PostgreSQL 18, Qt, Garnet, installer and signed release still need certification. F3 P2/P3 Prisma migrations remain unapplied.
6. Incident Manager reconciliation of native offline events, resource attribution, API/port configuration, scheduled recovery, and reliable external assigned alerts remain outstanding.

## Next target

**F2 P3**: Windows service preflight and operator-visible effective readiness/health, file/SMB permissions, secure remote port configuration, resource attribution, and real installation/rollback checks, followed by F3/F4 native-to-durable Incident Manager reconciliation. Avoid another duplicate notifications subsystem.
