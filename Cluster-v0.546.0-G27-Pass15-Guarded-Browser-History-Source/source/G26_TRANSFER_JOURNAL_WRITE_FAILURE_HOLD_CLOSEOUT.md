# G26 Pass 14 | Post-admission transfer journal write-failure hold

**Parent:** G26 Pass 13 Native Transfer Journal Visibility. **Source follow-on only:** Qt 6.11.2 / Windows 10 live acceptance not yet performed. No database migration or new privileged installer operation.

## Correctness gap

G26 Pass 12 required a journal commit before *new* upload/download admission, but post-admission `publish` callers ignored failed `QSaveFile` commits. They could keep uploading chunks, downloading files, finalizing uploads, deleting a cancelled partial, or reporting success after the last durable journal no longer recorded their intent. A disk-full or permissions failure can thus lead to uncertain recovery state after a crash.

## Pass 14 implementation

1. `TransferManager` retains a separate `m_queueWriteFailed` hold. The writer lease is *not* released and `ownsQueue()` refuses every mutation when the journal commit fails. A failed publication restores its prior in-memory record (or removes a never-saved one). A failed remove restores the removed entry. A failed migration retains the legacy source.
2. The hold aborts any in-flight network reply, flushes/closes an open download file and preserves both the last committed queue journal and retained data. Download header/readyRead callbacks and all upload/download continuation entry points independently check the writer gate. Pause/cancel, checksum verification and completion/failure notifications require a committed journal transition before proceeding.
3. `transfer.status`, mutating native capability errors and renderer types distinguish `journal-write-failed` from an unreadable/corrupted journal and another window owning the lease. The Transfer Center shows a persistent explanation and **Retry journal** action, not an automatic lock takeover or synthetic transfer entry.
4. Only an explicit retry can reload the most recently *durable* journal, and only after current reply/file handles are closed. The existing load path pauses `running`, `queued` and `verifying` jobs for **manual resume**, never silently replays an uncertain upload session or installer. A directory watcher cannot clear the write hold automatically.

## Verification / release boundary

- New `tools/scripts/cluster-g26-transfer-journal-write-hold-tests.mjs` verifies the guard, the distinct status/error, the absence of post-failure side effects across 11 continuation methods, and explicit recovery semantics: 32/32 source assertions.
- Inherited journal visibility, queue-custody portable C++ policy, HTTP range portable C++ policy, multi-window ownership, canonical upload and native custody source tests pass. Structural TypeScript scan clean.
- Qt 6.11.2 libraries are not available in this container. These source-contract and portable C++ tests **cannot certify** Qt signal/slot timing, real disk-full behavior, Windows file-lock semantics, permission errors, OS crash/restart behavior, remote upload revocation, or two-window acceptance. Run those on the target Windows 10 Desktop before G26-08/09 closure.
- If the file was already moved into its final destination or remote finalization was accepted immediately before an unpersisted receipt, the outcome may require operator inspection. No automatic destructive reconciliation or retry is introduced.

**Master roadmap:** G26-08 and G26-09 remain **source-partial**, with browser/mobile parity and certified durable recovery still open. G26-10/11 Windows installer lifecycle remains open.
