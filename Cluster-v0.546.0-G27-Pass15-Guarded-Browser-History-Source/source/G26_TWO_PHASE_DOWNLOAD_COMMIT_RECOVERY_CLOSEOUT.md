# G26 Pass 16 | Two-phase Desktop download commit and restart recovery

**Parent:** G26 Pass 15 truthful transfer mutation results. **Source only**, not Qt 6.11.2 / real Windows 10 deployment acceptance.

## Failure mode

A complete and verified Desktop download used to call `QFile::rename(temporaryPath, targetPath)` **before** persisting a `complete` queue entry. If the app crashed or journal write failed between those operations, an already-verified final file could remain beside an older `verifying` queue entry. A subsequent resume would start a new HTTP download or collide with that final file. This contradicted durable transfer recovery and the Pass 14/15 journal protections.

## Implementation

1. `finishDownload` records the already computed SHA-256, a `downloadCommitReceipt` marker, and temporary `committing` state through the existing atomic journal **before** rename. If the first publication fails, the file is not renamed and Pass 14 enters a safe write hold.
2. After rename, the `complete` state is independently published. If that second save fails, the durable `committing` receipt remains and the final artifact can be checked on an explicit Resume.
3. On startup, `committing` is treated like other interrupted work and converted to **paused**, never auto-replayed. Resume with an existing commit receipt makes no HTTP request; it independently hashes exactly one of the temporary file or the final file. Both-present/neither-present, symlinks, nonregular paths, bad SHA receipts, wrong lengths, and checksum differences fail closed without deletion or overwrite.
4. An interrupted rename with a retained partial can be reverified and renamed; a successful rename with an unpersisted completion record can be reverified in place and recorded as complete. Completed-result events only follow a committed journal save.
5. The asynchronous file hasher now compares source length and last-modified evidence before/after reads, and refuses symlinks. This reduces accidental trust in changed files; it is not a full substitute for native Windows file-ID inspection and real race tests.
6. The renderer recognizes the brief `committing` state as active/verifying rather than displaying no work while the final durable receipt is published.

## Verification and limits

- `tools/scripts/cluster-g26-download-commit-crash-recovery-tests.mjs`: 28/28 source assertions for state ordering, paused-on-restart, independent rehash, exclusive source paths, non-destructive collision handling, and receipt completion.
- Retained 34 truthful mutation, 32 journal write hold, 18 journal visibility, 44 compiled/source queue custody, 56 compiled/source HTTP range, 24 ownership, 36 upload, 13 branch, and 23 native custody checks pass. Structural TypeScript scan clean.
- **No linked Qt 6.11.2 runtime** in the current Linux environment. Final downloaded-file identity, rename atomicity, filesystem semantics, abrupt power-loss durability, two-process ownership, Windows 10 storage/permissions, and real remote completion receipt behavior remain **uncertified** until Windows tests.
- `G26-08` and `G26-09` remain source-partial in the same master roadmap. Browser/mobile transfer parity and Packages MSI repair/uninstall are still outstanding.
