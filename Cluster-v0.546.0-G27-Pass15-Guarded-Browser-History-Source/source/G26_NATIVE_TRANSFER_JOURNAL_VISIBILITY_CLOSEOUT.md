# G26 Pass 13 | Native transfer journal read-only evidence in Desktop UI

Parent: **Cluster v0.546.0 G26 Pass 12**. Current: **G26 Pass 13**, source-only.

## Change

- `TransferManager::queueBlockedReason()` returns an allowlisted reason only: `journal-invalid`, `owned-by-another-window`, or `unavailable`, never local paths or journal contents.
- A new read-only, empty-input `transfer.status` native capability returns the queue's writable status and blocked reason. The existing `transfer.list` remains an array of *actual* transfers; no synthetic error transfer is added.
- Manual `transfer.claim` returns the same reason as well as `writable`; it still cannot override a corrupted journal or another live QLockFile holder. Mutating requests reject `journal-invalid` with a specific error distinct from ordinary cross-window ownership.
- The renderer's Transfer Center reads status separately from list, shows a visible read-only journal warning even when there are no transfer rows, never shows 'Take over' for damaged history, and advises preservation of retained transfer bytes for manual backup repair.
- Existing per-entry `ownedByAnotherWindow` is now true only when *another window actually owns the lease*, not for malformed local data. It does not confuse read-only disk evidence with a lock conflict.

## Verification/limits

- 18/18 new source integration checks, 44/44 prior queue custody/source + compiled native C++ policy, 24/24 updated cross-window ownership checks, 56/56 Qt range checks, 36/36 uploads, 13/13 branch reconciliation, clean TypeScript/TSX scan.
- No privileged repair/delete operation was added. A user must correct the invalid journal using a trusted backup/manual administrator procedure; the application must not guess repair contents or discard records.
- No linked Qt 6.11.2 build or real Windows 10 two-window/repair test in this container; G26-08/09 and live certification remain open. Browser/mobile transfer parity remains unfinished.
