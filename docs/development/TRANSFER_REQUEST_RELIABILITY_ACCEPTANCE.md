# Transfer/API reliability and background-load acceptance

**Workstream:** Cluster 1.0 P0 #2 (transfers + API) and #7 (request amplification + noisy diagnostics).

**Source scope:** GitHub `development` RC50 lineage, not the separately packaged RC73/RC74 sources. PR #9 is not a certified Windows runtime build.

## Source changes

- Credentialed cross-origin upload preflights allow `Content-Range`; resumed downloads allow `Range` and `If-Range`, with response `Content-Range`, `ETag`, `Content-Disposition`, and `Content-Length` exposed.
- Small browser Blob downloads no longer report a successful handoff when the server sent fewer bytes than the declared or known file length, when the body is a problem+json response, or when the owner changed before the file was saved.
- Diagnostic warnings for repeat origin blocking, API 429 budgets, read contract violations, and incompatible client versions are bounded by **60-second keyed emission windows**, with an in-memory limit of **256 keys**. First occurrence remains logged. Subsequent warnings are counted and summarized on the next emitted occurrence. **Rate-limit enforcement, audit policy, and telemetry are unchanged**.
- Desktop notification recovery requests are coalesced across focus/online/read-state bursts, with a 30-second minimum and bounded failure backoff.
- Repeated native Server Manager 'healthy' status messages no longer repeatedly reset the Desktop sync timer. Only actual connectivity transitions schedule urgent sync.

## Automated checks

```sh
node tools/scripts/cluster-transfer-request-noise-tests.mjs
node tools/scripts/cluster-download-disk-stream-tests.mjs
node tools/scripts/cluster-transfer-memory-smoke.mjs
node tools/scripts/cluster-transfer-runtime-isolation-tests.mjs
node tools/scripts/cluster-transfer-unified-pass-tests.mjs
```

CI: `.github/workflows/transfer-request-reliability.yml` runs the dedicated regression, disk streaming and memory suites on Linux **and Windows** using pinned Node 24.20.0. Source hygiene runs additional existing transfer tests.

## Windows acceptance (not yet performed)

1. Start a fresh installed Cluster Server and Desktop with production-equivalent configuration, plus Web from a different allowed local origin. Verify a real browser **OPTIONS** preflight containing `content-range` and subsequent credentialed `PUT /api/uploads/:id/chunks`; never loosen origin allowlisting globally.
2. Upload 1 MiB, 40 MiB, and 1 GiB files. Interrupt network mid-chunk, retry with the original session and compare SHA-256. Verify 429 and `Retry-After` leave local payload/session durable.
3. Download the same files to disk in a browser with File System Access and in Qt native. Interrupt/resume a ranged GET, compare hashes, and verify an incomplete stream never shows `completed`.
4. Exercise browser fallback (no File System Access), cross-origin server cookies, HTML/login responses, a forged 200 problem+json, missing/wrong Content-Length, and account/server switching while a read is active.
5. Run the app idle for at least 30 minutes with no navigation, then active with normal projects, notifications, presence, and Library. Record requests per route/minute, status counts (especially 401/403/429/503), p50/p95 response durations, transferred bytes, server CPU/RSS, browser memory, sockets, log lines per minute, and background-task frequency. Compare with an unchanged control build before asserting percentage reductions.
6. Repeatedly focus/blur Desktop while native server heartbeats arrive. Verify sync checks follow the adaptive cadence instead of firing after each heartbeat. Verify offline and reconnect transitions still trigger prompt recovery.
7. During an intentional 429 storm verify only bounded *duplicate warning emission* is reduced, while the underlying rejected request count and audit/telemetry stay accurate. Inspect suppressed-repeat counts.
8. Perform 100+ transfer cycles with cancellation, client restart, disk full, permission revocation and server restart. No extra background request loops, leaked handles, stale owner data, or silent partial files.

## Release decision

These fixes are a **first pass**, not evidence that the earlier observed Windows request storm is fully eliminated. PR #9 must merge after checks. Repeat tests on the newest verified release source after RC73/RC74 reconciliation. Do not mark workstreams #2 or #7 closed until Windows capture and hashes support the outcome.
