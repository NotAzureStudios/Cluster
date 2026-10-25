# Cluster G26 | Native Transfer & MSI Custody Integrity, Pass 3

**Exact parent:** `Cluster-v0.546.0-G26-Native-Transfer-Diagnostics-Pass2-Source.zip`.  
**Changed:** native Go Package stager, adversarial tests, work register and source checkpoint.  
**No migration, automatic installation, MSI repair/uninstall, lock theft, physical deletion, or server restart.**

## Source changes

1. `transfer-inspect` no longer calls `transferPaths`, which created unknown transfer directories on a read. A separate `existingTransferPaths` resolves only existing, non-symlink directories; unknown identities return `CLUSTER_TRANSFER_NOT_FOUND` and leave the private root unchanged.
2. Snapshot verification now rejects dual `artifact.part` / `artifact.zip` evidence, and uncommitted archive renames. These must be explicitly diagnosed/recovered, not misreported as ready for continuation.
3. Checkpoint metadata is read through a bounded, identity-checked opened file. The payload hash verifies stable inode, length, modification timestamp and current pathname before trusting the result; the checkpoint is reread afterward to reject a changed generation. This reduces, but does not completely eliminate, adversarial filesystem races on Windows/network shares.
4. Inspect rejects an existing transfer lock rather than presenting an active writer as a stable snapshot. The independent `transfer-diagnose` route remains available for safe, non-mutating investigation.
5. Native transfer lock release checks original file identity. The existing MSI install attempt now uses an equivalent ownership-checked directory lock cleanup, preventing cleanup from removing a replacement lock.

## Verification

- Added `transfer_inspection_integrity_test.go` and `msi_lock_custody_test.go`: no directory mutation; existing incoming roots; lock replacement; dual/renamed payload; invalid/oversized/symlink metadata; fail-closed inspection; existing genuine operator-confirmed recovery.
- Added `tools/scripts/cluster-g26-native-custody-integrity-tests.mjs`: 22/22 source integration checks covering Go helper, CLI, Qt broker and renderer capability surface.
- Native Go suite, `-race`, `go vet` passed with installed Go 1.23; Windows x64 cross-compile passed (not Windows runtime execution). Linux native CLI smoke returned exit 3 `CLUSTER_TRANSFER_NOT_FOUND`, with no filesystem mutations.
- Inherited transfer recovery, diagnostics, signed Package handoff, and structural scanner to be rerun after packaging and extraction.

## Remaining release obligations

`G26-08` and `G26-09` remain **source-partial**: native checkpoint integrity does not establish global browser/mobile/Qt resume, server-side revocation at every continuation boundary, actual Windows 10 locking semantics, streaming backpressure, cancellation or transfer UI parity. `G26-10` and `G26-11` remain **open** for privileged MSI repair/uninstall, OS-evidenced installed-state, reboot recovery and process-fault certification. Never equate a trusted staged archive or a receipt exit code with an installed healthy application.

**Performance debt discovered during inspection:** `appendTransfer` re-hashes the entire retained file on each chunk. This is deliberately conservative but can generate O(total size squared / chunk size) disk reads for large archives. Before 1.0, profile real multi-GiB transfers and implement a bounded, fault-safe streamed hashing approach or explicit accepted file-size throughput ceiling. Do not replace integrity checks with an untrusted client progress counter.
