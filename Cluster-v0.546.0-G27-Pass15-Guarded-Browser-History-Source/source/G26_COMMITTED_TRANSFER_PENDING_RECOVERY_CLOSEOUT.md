# Cluster v0.546.0 | G26 Pass 9: Committed Transfer Pending-Recovery Closeout

## Problem and implementation

Pass 8 correctly blocked ordinary inspection, offer binding and final commit whenever `checkpoint.json.pending` existed. It also exposed a deadlock: explicit recovery of a **committed** transfer with a valid checkpoint and left-behind pending metadata called the ordinary guarded reader and therefore could not reconcile the only remaining residue.

- `readTransferCheckpoint` remains fail-closed whenever pending publication exists, including a second pending check after the full-file hash.
- The *operator-confirmed* `recoverTransfer` path, holding the exclusive native transfer lock, can call an internal proof routine that verifies a committed archive's current file identity, byte count, complete SHA-256 digest, and stable checkpoint before removing the stray pending metadata.
- Recovery checks the pending metadata file's identity, size and timestamp again before removing it. Changed evidence stops recovery without clearing the residue.
- Full archive corruption preserves pending evidence and keeps ordinary access blocked. No archive bytes, offer authorizations, locks, or installer state are silently modified.
- Receiving-state explicit recovery and existing hash-state reconstruction continue through independent full-file verification.

## Executable validation

`TestCommittedTransferPendingResidueRequiresExplicitRecovery` and `TestCommittedTransferPendingResidueCannotConcealCorruptedArchive` exercise blocked ordinary calls, recovery success and idempotence, full-archive preservation, failure on altered bytes, and preservation of pending evidence on failed verification. Go package tests, race tests and vet passed; Windows x64 Go test binary cross-compilation passed. Selected inherited native transfer/Qt contracts passed.

## Release gates not claimed

G26-08 and G26-09 remain source-partial. No live Windows 10, Qt, MSI service, browser/mobile multi-window resume or server revocation acceptance was performed. This does not authorize installation, overwrite a running transfer lock, or certify stable storage under concurrent Windows filesystem failures.
