# Cluster v0.546.0 | G26 Pass 23: MSI grant ordering and local receipt safety

This is a source-level reliability/security improvement to the **existing** read-only MSI recovery and supervised per-user installation path, not a native Windows installation certification.

## Implemented

- The Desktop MSI install path checks the current authorized target and **reads the local durable MSI attempt/lock receipt before requesting a server-signed execution grant**.
- The validation rejects inconsistent, foreign, non-read-only or unexpectedly attested helper responses. An existing receipt, operation lock, manual-review flag or unexplained recovery state blocks another grant; there is no automatic retry.
- A local synchronous guard coalesces repeated clicks before React state catches up.
- An asynchronous generation fence prevents stale feed, receipt, grant, or execution continuation after changing package channel, device platform, or Desktop availability. The UI resets its busy state when those contexts change.
- The MSI evidence inspector also disregards late results after those context changes.
- Previously inspected blocked records disable the installation button with a manual-review explanation. Every install attempt still performs a **fresh** read before requesting a grant.
- Existing production native helper custody, signature checks, short-lived grants, Job-object ownership and read-only Windows Installer query remain authoritative. Server grants and absence of local receipts do **not** attest that software is installed or healthy.

## Checks

- 47/47 executed MSI grant-ordering and concurrency/race regression checks against extracted production renderer functions.
- 539/539 inherited G26 Pass 14–22 transfer/evidence regression checks.
- 586 total targeted assertions reported by the chain.
- Native Go helper `go test ./...`, `go test -race ./...` and `go vet ./...` passed; Windows x64 cross-compilation passed.
- Source syntax/import/CSS integrity and complete/overlay archive byte reproduction checked independently.

## Open boundaries

No unattended reinstall, repair, uninstall, retry, OS health attestation, reboot recovery, or elevation support was added. Installed software must not be inferred from an installer exit code or local registration alone. Live Windows/Qt/PostgreSQL test machines and fully dependency-backed application builds remain unverified. G26-10/11 remain open; all destructive operations and unsafe automated MSI recovery remain disabled.
