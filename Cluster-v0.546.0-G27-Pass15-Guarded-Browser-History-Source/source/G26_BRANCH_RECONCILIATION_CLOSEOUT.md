# Cluster v0.546.0 | G26 Pass 10: Source-branch reconciliation and transfer queue startup

## Verified source provenance

**Exact cumulative parent:** `Cluster-v0.546.0-G26-Committed-Pending-Checkpoint-Recovery-Pass9-Source.zip`. The parent already includes strict native pending checkpoint fencing, independent SHA-256 recovery of committed archives, and transport lock/file custody. This pass combines it with two previously **separate** peer branches, rather than replacing native safety fixes:

- `Cluster-v0.546.0-G26-Qt-Download-Continuity-Pass8-Source.zip`: Qt-independent C++20 HTTP Range admission, strong ETag / If-Range continuation, cancellation-aware callbacks and destination collision handling.
- `Cluster-v0.546.0-G26-Multiwindow-Transfer-Ownership-Pass9-Source.zip`: per-profile Qt queue single-writer `QLockFile`, standby read-only Transfer Center with guarded manual ownership attempt, no auto network replay, and Library mount error feedback.
- `Cluster-v0.546.0-G26-Canonical-Desktop-Upload-Bridge-Pass10-Source.zip`: Qt upload session mapped to canonical `/api/uploads` (not the obsolete Desktop transfer API), owner-bound idempotency, remote offset/status reconciliation, distinct resume/complete and Library finalization, and terminal retry fencing.

The original native G26 Pass 9 `durable_transfer.go` and regression tests were **retained** unchanged. The Qt branch supplied native/renderer sources and the corresponding focused tests; the single master JSON register is updated, not overwritten by an older branch.

## New integrated correction

Qt's queue ownership code originally constructed a `QLockFile` under `.../transfers/` without first ensuring the directory existed. On a new profile `tryLock(0)` could fail and leave the only Desktop writer read-only. The owner now creates the private transfer directory before acquiring the scoped lock, refuses a symlink at that directory, and registers an event-driven watcher only after that location exists. Failure remains read-only; it never creates a second writer or steals an occupied lock. The existing queue is not migrated by a standby process.

## Verification scope

- `cluster-g26-qt-canonical-upload-contract-tests.mjs`: 36 focused source checks.
- `cluster-g26-qt-download-continuity-tests.mjs`: 50 source and compiled standalone C++20 range checks.
- `cluster-g26-multiwindow-transfer-ownership-tests.mjs`: 24 source checks.
- `cluster-g26-branch-reconciliation-tests.mjs`: 13 cross-branch and first-profile initialization contracts.
- Inherited native transport, Qt boundary and upload/server contract tests, native Go package/race/vet, Windows amd64 cross-compilation, and structural source scanner.

**Not certified:** Full Qt 6.11.2 compilation, Windows 10 two-process queue contention, network loss/revocation against a real PostgreSQL-backed server, browser/mobile transfer parity, MSI repair/uninstall, and pinned production toolchains. G26-08/09/10/11 remain open.

## Next implementation focus

Finish bounded cross-client transfer parity and actual native desktop/Windows certification. Keep package installation authority and physical deletion disabled until the specified safety gates pass.
