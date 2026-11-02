# Transfer engine upgrade: disk streaming, memory and outcome truth

**Scope:** Browser and shared-renderer transfer paths in the tracked GitHub `development` tree, based on RC50 with earlier targeted fixes. RC73/RC74 bundles exist outside GitHub; this pass does not claim they have been merged.

## Implemented in this pass

- **Stream-to-disk (where supported):** A user-initiated Library file/version download can use the browser's File System Access save picker. The authenticated response is written chunk-by-chunk to the selected file. No full-file Blob is retained and no speculative download GET is issued first.
- **Verified write outcome:** Transfer Center distinguishes `Saving to disk`, `Written to selected file`, `Failed`, and `Cancelled`. A confirmed file-writer close is stronger evidence than a browser handoff, but is not a cryptographic hash verification.
- **Cancellation and identity:** Active disk streams have an AbortController; Transfer Center can cancel them. Account/server identity is checked between chunks. Errors/abort discard the partial writable stream rather than falsely marking the file saved.
- **Bounded work:** At most two active disk-stream downloads are admitted. Legacy browser Blob buffering remains capped at 32 MiB with at most four retained Blob URLs.
- **No duplicate known-large request:** When the caller provides a size above 32 MiB and disk streaming is unavailable, Cluster hands the URL directly to the browser instead of downloading bytes merely to inspect Content-Length.
- **Response validation:** Disk streams reject HTML login/error pages without an attachment disposition and problem+json responses, HTTP partial responses and declared Content-Length mismatches. A failed or incomplete write does not get marked completed.

## Important constraints

This is not yet one transfer engine for all platforms. The Qt native TransferManager has a separate resumable, journaled implementation. Native browser-managed downloads are unobservable once handed off, while stream-to-disk is supported only when the browser exposes the File System Access API in the current browsing context. Some desktop WebView configurations and Firefox/Safari may use the fallback instead.

File-picker invocation must remain **directly in the click handler's user activation**. Do not insert an awaited capability probe or network call before the picker. The dialog is an explicit user action; cancellation should not silently launch another download.

For files with `sizeBytes` metadata, fallback downloads above 32 MiB do not perform an extra GET. For files without a known size or smaller files, the bounded Blob path can still issue a second browser request when the response exceeds 32 MiB. Native Qt downloads are unaffected.

The server must continue to enforce authentication, authorization and Content-Disposition and provide byte-stable responses. The client-side file writer cannot compensate for a missing server-side authorization boundary.

## Outstanding priority work

1. Integrate the newest verified source bundle on `development` before declaring this the release candidate's transfer engine. Resolve differences with RC74's rate-limit and viewer fixes.
2. Add sustained Windows browser/Qt soak tests for 100+ upload and download cycles, including large files, account switching, server restarts and disk exhaustion.
3. Unify transfer job identity, pause/resume and retry states across browser, offline upload and Qt native queues. Preserve the existing native journal rather than replacing it with ephemeral browser state.
4. Add server-provided checksum or immutable revision metadata and streaming digest verification where feasible; never buffer multi-GiB files just to calculate a hash.
5. Profile actual in-flight bytes, active streams, retained Blob URLs, WebView heap, native handles and server RSS under limited memory/bandwidth.

## Checks

The dependency-free `cluster-download-disk-stream-tests.mjs` test covers stream writes, length mismatch, unsafe response, cancellation, account/server guard, single authenticated GET and known-large fallback. It is source-level verification, not a full Windows acceptance test.
