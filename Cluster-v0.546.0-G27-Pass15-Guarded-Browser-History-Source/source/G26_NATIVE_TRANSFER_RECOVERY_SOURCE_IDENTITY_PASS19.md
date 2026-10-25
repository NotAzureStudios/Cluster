# Cluster v0.546.0 | G26 Pass 19: Download journal recovery and upload source identity

**Parent:** G26 Pass 18 Strict Journal / Native Transfer Admission, uploaded complete source. **Scope:** directly modified native Desktop Qt source, Qt-independent policy tests, one focused JavaScript regression suite, and existing master work register. No database schema/migration or native EXE changes.

## Confirmed issue corrected: a fresh queued download could poison its own journal

`startDownload()` persisted `direction`, `state`, `filePath`, `temporaryPath`, `remotePath`, `transferredBytes`, etc., but no `totalBytes`. Pass 17's journal reader requires a numeric `totalBytes` on **every** entry. A restart (or scope reload) could therefore mark an otherwise valid queue `journal-invalid`, blocking every job even though Cluster itself created the entry.

Pass 19 explicitly persists `totalBytes: 0` until an admitted HTTP response supplies the authoritative content length. This does not misrepresent an unknown total as a completed transfer; the UI progress logic still displays zero until length is known. A direct `startDownload()` caller cannot persist an invalid SHA-256 checksum, even if it bypasses the native broker's earlier validation.

## Upload generation custody

- New queued uploads retain their original local source mtime in milliseconds (`sourceModifiedAtMs`) alongside bounded `totalBytes`, local path and current session UUID.
- Native admission checks regular/non-symlink/readable file, representable integer size, valid timestamp.
- Journal validation checks the optional historical receipt's exact JSON numeric range. **Historical uploads without this receipt remain readable and visible, but may NOT automatically resume.** They transition nonretryably with `TRANSFER_UPLOAD_SOURCE_UNPINNED` when explicitly retried, preserving their remote session and all journal evidence. Unrecognized or malformed receipts still hold the journal invalid.
- `runUpload` checks source before querying/creating any session. `sendUploadChunk` checks before reading and immediately after its exact-length read. `verifyUpload` checks before and after async SHA-256. `completeUpload` checks immediately before requesting server completion.
- A replaced/changed file produces `TRANSFER_UPLOAD_SOURCE_CHANGED` and does not automatically mix bytes from another local revision into a previously opened server upload.
- All native authenticated upload mutation requests and upload-session status GETs explicitly forbid following HTTP redirects. The original same-server download redirect restriction is preserved.

**Limit:** File size and mtime are not Windows file-ID evidence. Malicious same-size, timestamp-preserving replacement, hard-link and path race attacks still require true opened-descriptor identity hardening and Windows runtime testing. No claim of guaranteed snapshot semantics; no silent auto-reattachment to an old upload session.

## Download path execution boundary

- Persisted historical downloads outside the current Downloads folder remain **visible** as recovery evidence; no truncation or silent journal deletion.
- New shared `downloadPathsSafe()` refuses writes, verification, rename/commit, open and reveal for unexpected destinations, nonregular files, or symlinks. Both final and `.cluster-part` sibling must reside directly inside the current Downloads folder.
- Automatic partial cleanup additionally uses that same check while preserving earlier explicit source-root checks.
- A blocked historic or tampered job becomes nonretryable with `TRANSFER_DOWNLOAD_DESTINATION_UNTRUSTED`; no bytes are intentionally altered.

**Limit:** This is path-level fail-closed control. Final protection against concurrent reparse-point/hard-link swaps still needs opened-file identity and Windows API acceptance; no claim of tamper-proof filesystem admission.

## Validation completed in this environment

- `npm run cluster:g26:p19:source-recovery`: **all 12 chained regression scripts passed**, including compiled Qt-free C++ admission and journal policy tests.
- Current Pass 19 focused checks: **33/33**; updated Pass 17 journal checks: **74/74** (50 portable C++ + 24 source); Pass 18 native admission: **68/68**.
- Aggregate inherited + current G26 native source/portable suite: **460/460 assertions** (script-reported assertions). Some checks are structural source-contract assertions, **not a linked Qt runtime test**.
- `node tools/scripts/cluster-td6-source-scan.mjs`: **1,132 TS/TSX** parsed, 0 syntax errors; **3,258 renderer imports**, 0 missing; **110 CSS files**, 0 delimiter errors.
- Native Go package-stager `go test`, `go test -race`, `go vet` passed and a Windows/amd64 binary cross-build completed. This verifies the unchanged Go component's buildability on this host, **not Windows execution or Qt linking**.

## What remains open

`G26-08` and `G26-09` remain **source-partial**. Outstanding are cross-device/browser/mobile continuation, native Qt compilation and Windows 10 runtime, race-hardened filesystem identity, complete related-work upload linking, certified access-revocation/interruption behavior and any OS-level MSI repair/uninstall. As requested, release certification is not the focus of this development pass; destructive disposal and other unsafe features remain disabled.

**Next cohesive feature work:** Finish the authorized post-upload related-work attachment mutation and reconcile actual transfer outcomes across UI, Qt and server. Preserve durable journal and remote-session custody; do not claim success before the link mutation is acknowledged.
