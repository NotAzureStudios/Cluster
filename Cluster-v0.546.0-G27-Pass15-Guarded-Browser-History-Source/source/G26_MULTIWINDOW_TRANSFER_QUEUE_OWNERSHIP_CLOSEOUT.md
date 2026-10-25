# Cluster v0.546.0 | G26 Pass 9: Desktop Transfer Queue Single-Writer Ownership

**Exact parent:** `Cluster-v0.546.0-G26-Qt-Download-Continuity-Pass8-Source.zip`.

## Source implementation

- Qt `TransferManager` takes one nonblocking `QLockFile` per normalized profile/scope journal (`transfers-<scopehash>.json.owner.lock`) and holds that OS-visible lock until manager shutdown/profile switch. Stale lock **age alone** never authorizes takeover; Qt uses PID/hostname stale-process checks. Lock-acquisition failure makes the second Desktop process explicitly read-only.
- A secondary process loads the JSON queue and receives throttled directory-change snapshots (250 ms), but cannot start, pause, resume, retry, cancel, delete, save, migrate the legacy file, or schedule active network work. The native broker disables all mutable transfer controls and rejects direct mutation attempts with a clear native error. Existing completed file open/reveal remains read-only.
- A user can explicitly select **Take over** in Transfer Center. The broker only reports `writable: true` if `QLockFile::tryLock(0)` actually acquired the lock. A still-running original owner is not evicted. On takeover, persisted `running`/`queued`/`verifying` items become locally paused, requiring explicit manual resume and fresh server authorization. No automatic replay of previous network writes.
- Library-mount dirty-file uploads no longer silently claim a transfer was queued when the local journal belongs to another process. They report transfer-queue-unavailable status to the native mount UI.
- Network replies and open file handles are closed before the owning manager releases its lock during profile switching or shutdown, avoiding a second process acquiring the lock while the first manager still owns a local output stream.
- Added source contract suite with **24** explicit ownership/bridge/UI invariants. The inherited Pass 8 range-policy tests still provide **50** checks, including 30 executable portable C++ checks. This is an incremental source-level safety boundary, **not** complete browser/mobile/Qt runtime certification.

## Remaining limits

Qt 6.11.2 is not installed in this environment, so there is **no Qt binary build or live Windows 10 contention/crash test**. QLockFile stale recovery, Windows file system watch behavior, two real Desktop processes, and server-side revocation on every resumed chunk still require live acceptance. Profile storage permissions and a lock owned by a separate machine can cause a read-only outcome rather than immediate takeover. The pending G26-08/09 requirements remain open; no MSI privilege or schema migration was enabled.

## Verification commands

- `node tools/scripts/cluster-g26-multiwindow-transfer-ownership-tests.mjs` (24/24)
- `node tools/scripts/cluster-g26-qt-download-continuity-tests.mjs` (50/50)
- `node tools/scripts/cluster-td6-source-scan.mjs` (1,132 TS/TSX, no syntax errors; 3,258 renderer imports resolved)
- Inherited native transfer/Package source suites and Go stager tests/race/Windows x64 cross-compile.
