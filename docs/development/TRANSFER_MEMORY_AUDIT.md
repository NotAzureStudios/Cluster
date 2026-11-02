# Upload/download and memory lifecycle audit

**Source baseline:** GitHub `development` is still based on RC50 application source. The separately packaged RC73/RC74 source is newer and has **not** been fully imported. This pass backports targeted transfer reliability and lifecycle fixes, not the whole release.

## Observations and fixes

| Area | Existing behavior | Change on development |
| --- | --- | --- |
| Browser downloads | Up to 128 MiB accumulated in memory before Blob creation | Limit buffered downloads to 32 MiB |
| Unknown download length | Files crossing the limit failed rather than saving | Cancel the exploratory stream and hand off to browser-managed download |
| Retained Blob URLs | Each save holds its Blob URL for up to 60 seconds, without a concurrency limit | Cap pending URLs at four; overflow uses browser download |
| Stream resources | Errors could leave a locked/unconsumed stream | Cancel rejected streams and always release readers |
| Upload session ownership | Account checks mostly occurred around the entire transfer | Check before and after each chunk/part and before final mutation |
| Upload cancellation | No external AbortSignal propagated through all staging endpoints | Thread the optional signal to API requests and direct object-store PUT |
| Backpressure | RC50 treated upload HTTP 429 as a nonretryable error | Preserve the local Blob/session and retry after bounded delay including Retry-After |
| API AbortSignal fallback | Attached abort listeners were not detached after request completion | Remove listeners in request finally, including successful requests |

The server already uses a bounded binary chunk parser and streams download attachments. Neither the presence of server streams nor these source-level fixes prove all downloads complete successfully on Windows.

## Important limits

- A browser-handled download requires a **second authenticated request** after the initial response is canceled. Its final disk-save result cannot be observed by Cluster. Session cookies and attachment headers must be validated in a real browser. Dedicated native Qt download transfers use separate code and need their own soak test.
- In the browser's Blob path, `saved` means *the file response was received and the browser save was requested*, **not** proof that the file landed on disk; Transfer Center already conveys this limitation.
- Cancellation checks between chunks prevent **subsequent** cross-account writes. A request already accepted by the server may complete before the client notices the context change. Server-side session ownership and idempotency remain essential.
- A 32 MiB file buffer is still significant, and the Blob may temporarily coexist with network chunks. Four pending object URLs bound the multi-download retention budget; this is not a memory-use measurement.
- No live Windows/Qt/Chromium, Postgres, real storage provider, or long-running server heap profiling was performed here. No full npm-backed build passed in this session because the dependency lockfile is still missing.

## Regression checks

Run from the repository root:

```sh
node tools/scripts/cluster-transfer-memory-smoke.mjs
node tools/scripts/cluster-repo-hygiene-check.mjs
```

The first command dynamically exercises the browser downloader and staged uploader against mocked transport, and checks the signal-listener fallback path without additional npm dependencies. It does not exercise actual cookies, server credentials, disk writes, partial HTTP responses or resumable native Qt transfer journals.

## Next field test

Repeat uploads and downloads across at least two accounts on a real RC build, with 1 MiB, 40 MiB, and 1 GiB files, missing/incorrect Content-Length, interrupted network, 429 Retry-After, canceled browser requests, account switching, and desktop profile switching. Track browser heap, retained Blob URLs, server RSS, open file handles, transfer queue counts and artifact hash verification. Compare idle baseline after each round.
