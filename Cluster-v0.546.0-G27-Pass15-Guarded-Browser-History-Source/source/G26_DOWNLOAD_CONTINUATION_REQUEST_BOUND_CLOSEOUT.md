# Cluster v0.546.0 | G26 Pass 11: Bounded Automatic Download Continuation

**Exact parent:** `Cluster-v0.546.0-G26-Branch-Reconciliation-Qt-Transfer-Continuity-Pass10-Source.zip`.

## Problem

The native Desktop Qt downloader requested `Range: bytes=<offset>-` and correctly accepted short valid 206 replies. However, for a large file a broken origin could return a tiny nonfinal 206 response on every request, causing excessive automatic network requests and repeated checkpoint/disk writes. The transferred bytes were still checked, but accepting one-byte progress indefinitely was a request-amplification risk.

## Source fix

The existing Qt-independent `DesktopDownloadRangePolicy.h` now rejects nonfinal partial 206 replies **smaller than 64 KiB** when the declared object size is **at least 1 MiB**. This is part of the admission decision before any reply bytes are appended. A tiny complete file and a short, valid final range remain allowed. The client exposes a specific failure explaining that automatic continuation stopped due to an excessively small partial response. It does not discard retained bytes, retry, change a server setting or introduce background polling.

This is a conservative interoperability policy: any origin that deliberately serves sub-64 KiB nonfinal partial ranges for large files requires deliberate compatibility review. It limits pathological tiny-range traffic but is not a globally bounded number-of-requests proof for very large files.

## Verification

Five additional executable C++20 tests cover one-byte and 1000-byte fragments, the exact 64 KiB boundary, a short final tail and small-file behavior. The existing source contract suite now checks the distinct Qt failure feedback. Total `cluster-g26-qt-download-continuity-tests.mjs`: **56** assertions with standalone native `g++ -std=c++20 -Wall -Wextra -Werror` compilation. Canonical upload, multi-window ownership and integrated branch source contracts remain required.

G26-08 and G26-09 stay **source-partial**, with full Qt 6.11.2, Windows 10, real-server/network-loss, mobile and browser parity certification still open.
