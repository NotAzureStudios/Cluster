# Cluster v0.546.0 | G26 Pass 8: Qt Download Resume Continuity and Cancellation Safety

**Exact parent:** `Cluster-v0.546.0-G26-Native-Transfer-Streaming-Diagnostics-Pass7-Source.zip`.

## Changes in actual application source

- Desktop download resume preserves retained `.cluster-part` bytes if the server ignores `Range` (returns 200), rejects the request (401/403/503), returns inconsistent `Content-Range`/`Content-Length`, mismatches a persisted strong ETag, or cannot provide a verifiable total length. No HTTP error may cause a silent reset to byte zero.
- Previously saved bytes can resume only when the origin has a strong ETag or a full 64-character expected SHA-256. A strong ETag is sent with `If-Range`, verified against the response, and persisted with the TransferManager checkpoint. A checksum-pinned resource without ETag still undergoes final full-file hash verification.
- Full and partial responses are admitted by a standalone C++20 range policy; streaming callbacks also cap received bytes at the admitted response body length before writing them to disk. Checks include the exact requested start, unchanged known total, bounded and parseable range, non-overflowing integer fields and correct advertised response length. A valid short 206 response continues from the new offset rather than being finalized as truncated data.
- The output file is not promoted before the complete size and existing full SHA-256 verification, and a destination path that appeared during the transfer is **never overwritten/deleted**. Failed finalization preserves the partial file for operator review.
- All five upload response callbacks reject stale or canceled state before advancing the local transfer, avoiding an unintended local completion after a canceled in-flight server write (the remote outcome may still require reconciliation). Pausing/canceling stores the user intent before aborting an in-flight reply. Active downloads close their Windows file handle before removing retained temporary data; asynchronous checksum completions cannot mark paused/canceled transfers complete. Active removal now cancels before deferred deletion instead of invalidating the callback's record.
- A new Qt-independent C++20 header `apps/desktop-qt/src/DesktopDownloadRangePolicy.h` has **30 executable policy assertions** compiled with `g++ -Wall -Wextra -Werror`. The Qt integration source has additional focused contracts, but Qt 6.11.2 is absent from this environment and the Qt application has not been compiled or run on Windows 10.

## Safety boundaries and follow-up

This is an incremental G26-08/G26-09 improvement. It does **not** establish multi-window single-writer ownership of `TransferManager`'s JSON queue, general browser/mobile download resume, current-server authorization at every transfer continuation, or physical Windows 10/Qt filesystem behavior. Those stay on the single master roadmap. It neither grants native install permission nor adds Prisma migrations. A new download is required when retained bytes have no trusted generation/expected checksum; it never silently discards them. The active transfer `remove` operation defers removal until cancellation has unwound, and cross-window writer fencing must be implemented before multi-window release acceptance.

## Verification

- `node tools/scripts/cluster-g26-qt-download-continuity-tests.mjs`: **50/50**, including compiled portable C++ policy.
- Selected inherited G26 transfer recovery, diagnostic, streaming, summary, and TD3 integrity contracts: pass.
- `node --experimental-strip-types tools/scripts/cluster-td6-source-scan.mjs`: 1,132 TS/TSX scanned; zero syntax errors; 3,258 relative renderer imports with none missing.
- `go test ./...`, `go test -race ./...` and Windows amd64 Go cross-compilation for the inherited stager: pass with the locally available Go toolchain; no native Windows execution.
- The production Qt 6.11.2, pinned Node 24/Go 1.27.1 and PostgreSQL 18 builds remain release gates.
