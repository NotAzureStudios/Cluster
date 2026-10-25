# Cluster G26 | Suspended Windows MSI Job Supervision, Pass 4

**Exact source parent:** `Cluster-v0.546.0-G26-Native-Transfer-MSI-Custody-Integrity-Pass3-Source.zip`.  
**No Prisma migration and no new MSI repair/uninstall or automatic retry capability.**

## Implemented

The existing MSI installation implementation used to spawn `msiexec` with `exec.Command.Run`, while Qt's generic staging watchdog killed the Go helper after 30 seconds. This could leave an ambiguous installed state, with Windows Installer work potentially still executing.

- `msi_windows.go` resolves a trusted `msiexec.exe` in the Windows system directory, builds fixed, per-user `/i` command arguments, and creates a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before the child exists.
- Windows starts `msiexec` with `CREATE_SUSPENDED|CREATE_NO_WINDOW`, assigns its process handle to the new job, **then** resumes the suspended thread. Job creation/configuration, assignment, and resumption failure all fail closed; a child not safely resumed is explicitly terminated.
- The native installer has a 15-minute bounded process deadline. A timeout or Windows API error is treated as `msi_failed_or_outcome_unknown` and leaves a durable receipt requiring operator inspection. Never auto-retry from that state. The job closes on exit/crash, terminating remaining in-job descendants.
- Qt's generic 30-second process-kill watchdog is not applied to installer execution. Ordinary non-installer staging retains its previous bounded watchdog. Explicit, typed two-stage user confirmation and independently pinned grants remain enforced.
- The existing receipt state machine intentionally records `msi_started_outcome_unknown` BEFORE spawning a process, and never infers installed-product health from process exit 0 or 3010.

## Verification

- `tools/scripts/cluster-g26-msi-suspended-job-contract-tests.mjs`: 19/19 source wiring and ordering assertions passed.
- Native Go suite and `go test -race`, Linux Go vet, Windows amd64 `go build` and Windows Go vet passed with local Go 1.23.2. Pinned production Go 1.27.1 and actual Windows 10 have **not** been run.
- Inherited transfer/Package source regression tests and structural scan rerun on extracted ZIP before delivery.

## Critical nonclaims / certification gates

Windows Installer's **external** `msiserver` system service and elevated MSI custom actions may run outside the Job Object. Closing the job is not a guaranteed rollback and does not prove every installation effect has stopped. This source-level improvement does **not** satisfy full supervised MSI execution, crash/reboot recovery, repair/uninstall, independent installed-state health, actual trust chain/Elevation or user-session failure tests. `G26-10`/`G26-11` stay **open**. Test on disposable Windows 10 VM with real signed MSI, slow installation, cancellation, forced Qt/helper process crashes, reboot-required exit code 3010, and an OS-reported product state before permitting 1.0 privileged installation.

The native Package process remains an explicitly user-authorized operation and still MUST NOT become an unattended auto-installer. Native Windows Service job boundaries for Cluster Host/Node/PostgreSQL remain separate.
