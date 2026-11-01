# Unified Transfer Pass: source implementation and remaining certification

This work is on GitHub `development` and **does not replace the newer RC73/RC74 archives**. It is a deliberate cross-cutting transfer upgrade on the tracked RC50-derived code, not an installer release.

## Ownership and transfer model

Cluster has three existing transfer providers: durable browser/IndexedDB uploads, Qt desktop-native transfers with a crash-recoverable journal, and browser downloads. The unified Transfer Center displays common active, failed, paused, verification and byte-progress states across providers **without replacing their existing storage and recovery authorities**. Unknown-byte progress does not contribute to a misleading percentage.

## Browser downloads

- A user-initiated Library download uses a save picker on supported secure Chromium contexts and writes authenticated bytes directly to the chosen file. This avoids buffering the entire asset into a JavaScript Blob.
- During a single browser session, transient transport errors can resume at the exact next offset **only** when the server advertises an immutable, strong `"sha256-<64hex>"` ETag. Each continuation sends `Range: bytes=<offset>-` and `If-Range`. HTTP 206, Content-Range, size and matching ETag must agree. Changed/invalid sources abort the partial write.
- Byte-count and incremental SHA-256 verification complete **before** the file writer closes. The hash may come from the authorized Library metadata or the hash-qualified ETag. If neither is available, the UI accurately reports non-cryptographic completion.
- Browser downloads can be paused/resumed **while the same page remains open**. Cancellation rejects pending requests and aborts the writable file transaction.
- Browser download concurrency is limited by an in-memory prioritized admission queue. Account-scoped controls select 1–3 parallel disk streams, an aggregate per-window download speed cap, 0–5 retry attempts, and queue priority. Queue entries and abort listeners are removed on cancellation or completion.
- For non-supporting browsers, a known large download is delegated directly to the browser rather than initiating two full GETs. This fallback has **unverified final disk status**. Smaller downloads use bounded Blob buffering and URL revocation.

## Limits and follow-up acceptance

- **Restart durability:** The Qt native transfer manager already journals transfers; browser disk streams do not survive tab/browser termination. Their temporary writer is discarded on failed completion. Safe browser restart recovery requires separately tested OPFS staging, scoped IndexedDB metadata, quota management, permissions and final-file verification. Do not claim restart-safe browser downloads.
- **Provider independence:** Browser concurrency preferences do not override native Qt's own scheduling, nor do they change the server-side byte-rate budgets and resumable upload admission.
- **Hash authenticity:** SHA-256 verification detects mismatch with authorized server metadata. It does not replace server-side permissions, trusted transport, or release signing.
- **Testing:** Dedicated Node tests cover hashing across boundary sizes, exact byte-range resume, changed-range rejection, cancellation, ownership changes, admission priority, and aggregate status math. Full npm/typecheck/Windows/browser integration tests remain outstanding while GitHub lacks a verified dependency lockfile and the latest RC source.
- **Resource accounting:** Real-client soak tests should track open handles, active streams, direct-storage multipart state, RAM, OPFS/browser quota, Qt journal consistency, and server file descriptors during repeated large transfers. A green source-only workflow is not certification.

## Recommended next acceptance matrix

Exercise 1 MiB, 40 MiB, 1 GiB, 20 GiB (where permitted), and empty files; complete, disconnect midchunk, retry with correct/incorrect If-Range, checksum mismatch, disk-full during write, account/server switch, cancel/pause/resume, browser close, server restart, and recovery of native Qt journal entries. Verify upload session idempotency and the Library version, not only the transfer progress UI.

## Subsequent safety and memory hardening

- Per-account browser transfer history is hidden immediately on account/session change, and starting a transfer under a new owner cancels older live jobs. Control actions cannot operate jobs owned by an earlier session.
- Recent browser history is capped at twelve **finished** items without evicting live queued/saving/paused/retrying/verifying jobs. Admission is capped at 24 browser jobs to avoid an unbounded queue.
- The shared browser speed limiter uses an abortable FIFO instead of future time reservations. Cancelled waits release their slot and abort listener immediately, so a cancelled large transfer cannot delay unrelated future downloads.
- Reopening a different account's settings restores that account's concurrency limit; the previous user's policy no longer carries over into an active queue.
- UI progress callbacks and rate-limit callbacks are treated as local failures rather than retryable network interruptions. A local exception must not cause a second fetch on a partially written file.
- Regression tests cover history isolation, 15 simultaneous visible jobs, a hundred limiter cancellation cycles, owner invalidation, and failure-only rollback.

The native Qt `TransferManager.cpp` already uses QObject-scoped network-reply cleanup and a separate durable journal. These source observations are not proof of a leak-free Windows runtime; no native source was changed during this hardening step.
