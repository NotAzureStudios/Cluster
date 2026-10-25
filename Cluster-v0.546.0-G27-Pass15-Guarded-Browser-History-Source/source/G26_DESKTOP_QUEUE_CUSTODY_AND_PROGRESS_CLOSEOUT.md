# G26 Pass 12 | Desktop Transfer Queue Custody and Bounded Journal I/O

Parent: **Cluster v0.546.0 G26 Pass 11** (exact cumulative source). Current checkpoint: **G26 Pass 12**, source-only.

## Fixed in the real Qt TransferManager

1. **Queue history no longer silently truncates unfinished work.** The earlier `save()` sorted the queue and removed every record past 200, even `queued`, `running`, `paused`, `verifying`, or `failed`. New admission enforces a 200-entry cap and removes oldest *completed/cancelled metadata only*. If all entries are unfinished, the user must clear history or complete/cancel jobs before adding another. Already-oversized journals remain intact on subsequent saves, and retained downloaded files are never deleted by metadata pruning.
2. **Download destinations are reserved at queue creation**, not at filesystem creation. The final filename and its `.cluster-part` sibling are checked against physical files, dangling symlinks, and all four combinations of already-reserved final/partial paths. Case-insensitive matching on Windows, a bounded suffix search, and Windows-compatible filename sanitization prevent ordinary queue collisions. A pre-existing partial symlink/non-file is rejected again at append startup.
3. **New uploads/downloads only return accepted IDs when their queue entry was committed** with `QSaveFile`. Failed writes/commit preserve prior in-memory history and refuse the job. `save()` now checks short writes and `commit()` rather than ignoring both.
4. **Malformed journal cannot be overwritten by an empty queue.** Invalid JSON, unexpected schema, duplicate IDs, an unreadable/non-regular queue path, and symlinks place the manager in a read-only hold while preserving disk evidence. The existing manual ownership refresh rereads a corrected journal. Legacy journal migration deletes its source only after the new QSaveFile commits.
5. **Download progress stops rewriting the complete journal for every `readyRead`.** In-flight progress remains live in the Qt model; crash recovery already reads the actual retained `.cluster-part` length. Admission, pause/cancel, header acceptance, failures, and verify/commit retain durable journal writes.

## Verification and limits

- New Qt-independent C++20 retention policy: **16 executable assertions**.
- New source-integration tests: **28 checks**, total **44/44** in `cluster-g26-desktop-queue-custody-tests.mjs`.
- Inherited Qt download continuity **56/56**, multiwindow ownership **24/24**, branch reconciliation **13/13**, canonical uploads **36/36**.
- No new privileged MSI operation, DB schema or migration; no change to native Go staging hash contracts.
- Qt 6.11.2 development dependencies are **not installed on this build worker**. Full Qt binary linking, two-process Windows 10 filesystem semantics, disk-full simulation, renames and actual network resume are **not certified**. `G26-08/09` remain source-partial.
- Further work: persistent queue write failures occurring *after* admission should become a surfaced transfer error; browse/mobile parity and live two-window acceptance; native verified MSI lifecycle. The checkpointer is not a general transactional filesystem and does not protect against a hostile process replacing an already-open file.
