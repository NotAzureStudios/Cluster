# Cluster v0.546.0 | G26 Pass 25: profile-wide MSI admission lock and recovery visibility

Parent: G26 Pass 24. This pass corrects a race in cross-Package ProductCode custody without enabling retry, repair, uninstall, rollback or automatic lock removal.

## Implemented

1. **Atomic profile-wide installation admission.** `installSupervisedMSI` now acquires an exclusive, fail-closed `msi-admission.lock` directory at the private server-profile staging root *before* acquiring the individual Package lock, scanning foreign attempt receipts, querying Windows Installer registration, consuming a one-use grant, or invoking `msiexec`. The global lock remains owned through the process outcome and receipt write. A second signed Package key cannot simultaneously observe an empty foreign-custody directory before the first Package publishes a receipt.
2. **Crash evidence without destructive cleanup.** The global lock is removed on normal exit only when its original directory identity still matches and it remains empty. A process crash leaves it behind for operator review. It is never stolen based on PID/age or treated as authorization to resume.
3. **Read-only local visibility.** `msi-attempt-status` includes `admissionLockPresent`, and sets `lockPresent=true`, `manualReviewRequired=true`, and `interrupted_or_active_without_receipt` when no per-Package receipt exists but a profile-wide lock does. Non-directory/symlink admission locks cause an error, never a clean report. Receipt-bearing states retain their original classification plus the lock signal.
4. **Independent bridge checks and UX.** Qt rejects missing/nonboolean/contradictory admission evidence. Desktop's production MSI validator also rejects forged or inconsistent responses before requesting an installation grant; the Packages panel explicitly displays the profile-wide admission lock.
5. **Executable tests.** Go tests include a simultaneous 24-contender different-Package lock race, orphan global lock visibility both with and without the attempts directory, and tampered lock refusal. Executed TypeScript production-function assertions cover the new native response contract. Inherited Pass23/24 mocks were updated to include the new required read-only evidence field.

## Verification

- 33/33 new Pass25 source and production-function tests.
- 627/627 inherited Pass14–24 targeted source/portable tests.
- **660/660 combined targeted checks passed.**
- `go test ./...`, `go test -race ./...`, `go vet ./...` and Windows/amd64 CGO-disabled cross-build passed for package-stager-go.
- 1,132 TS/TSX syntax files and 3,258 renderer imports scanned clean; 110 CSS files delimiter-checked.
- Full archive SHA-256/CRC and independent Pass24→25 overlay replay in accompanying integrity report.

## Safety limitations

This lock coordinates Cluster helper invocations within **one local profile root**; it does not coordinate Windows Installer launched by unrelated software or across multiple machines/profiles. Windows external installer service/custom actions may outlive the helper Job Object. No real Windows MSI, linked Qt runtime, PostgreSQL integration, OS-reboot verification, or install-health attestation was performed here. P0 G26-10/11 remain open. Operator review still cannot clear/retry/reinstall without a separately designed, authenticated lifecycle.

## Next implementation

Build a bounded, read-only MSI profile custody inventory and post-reboot evidence inspection. Then design independently authorized repair, uninstall, upgrade, dependency ordering and rollback, without folding them into installation grant handling.
