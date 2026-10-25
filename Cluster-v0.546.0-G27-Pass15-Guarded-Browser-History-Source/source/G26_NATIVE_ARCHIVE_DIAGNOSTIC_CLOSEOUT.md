# G26 | Native Archive Read-only Diagnostics, Pass 2

**Exact source parent:** `Cluster-v0.546.0-G26-Native-Transfer-Crash-Recovery-Pass1-Source.zip`.
**Output:** `Cluster-v0.546.0-G26-Native-Transfer-Diagnostics-Pass2-Source.zip`.
**No Prisma migration, installer execution, automatic lock cleanup or changed server data.**

## New implementation

- Separate Go `diagnoseTransfer` uses validated private root and SHA-256, reads only existing metadata/physical file evidence, and **never creates a directory**. It does not call `recoverTransfer`.
- Reports bounded nonsecret state codes for missing/orphan checkpoint, lock present, invalid metadata, ambiguous payloads, uncheckpointed append bytes, interrupted rename candidates and hash-verified healthy current state. Candidate anomalies are **not falsely called recoverable** until separate full rehash.
- Native CLI `transfer-diagnose` outputs a separate `CLUSTER_TRANSFER_DIAGNOSTIC` JSON record. Qt restricts arguments to artifact SHA-256, bounds/parses the output and requires readOnly evidence. No native confirmation is needed because this is observation only.
- Renderer exposes a typed helper and current-server-authorized, user-triggered **Diagnose interrupted native transfer** button with explicit manual review messaging. No polling or silent side effects.
- The existing `transfer-recover` remains independent and requires native confirmation; locks cannot be silently cleared.
- The only final roadmap and work register retain `G26-08` and `G26-09` as partially implemented.

## Evidence and boundaries

- Native `go test`, `go test -race`, `go vet` passed on available Go 1.23 Linux toolchain; Windows amd64 compile passed, no live Windows 10 execution.
- Additional Go tests simulate checkpoint append gaps, interrupted rename, orphan/missing checkpoint, locks and symlinks.
- New source-integration diagnostic tests 18/18; prior 25/25 recovery checks and inherited kit/Transfer suites pass; structural TypeScript scanner clean.
- Qt runtime build, full Node24/TS compile and real-profile Windows 10 recovery remain open. No real PostgreSQL, backend download grant or installer repair/uninstall tested.

## Next work against same register

Run real Windows10 Qt interruption tests with independent signed transport and revocation. Design *supervisor-evidenced* orphan lock cleanup only with process ownership and OS proof, never PID age heuristics or automatic stale lock deletion. Continue Windows MSI guarded repair/reboot recovery and end-to-end G26 storage/provider/Packet acceptance.
