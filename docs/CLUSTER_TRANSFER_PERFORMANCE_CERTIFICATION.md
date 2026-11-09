# Cluster transfer performance and recovery certification

Applies to performance integration **Pass I** (Cluster 1.1.2 branch). This document is for implementation review and Windows certification. The branch is not deployed or merged solely by publishing this guide.

## Completed upload downloads

`GET /api/uploads/:uploadId/file` remains owner/admin-authenticated and continues to use the finalized upload metadata and verified storage path/locator. Its response delivery now shares the canonical Library/media streaming implementation.

- HTTP **Range** supports exactly one valid byte range and returns `206 Partial Content` with `Content-Range`, `Content-Length` and `Accept-Ranges: bytes`.
- Invalid/out-of-bounds or multipart range requests return `416`, without opening an object stream.
- `If-Range` only resumes against the current validator; mismatches return the full resource rather than mixing versions.
- `ETag`, `If-None-Match`, `If-Modified-Since`, and **HEAD** avoid unnecessary body transfer.
- Local and direct-object downloads use the same response contract. The metadata fetched during upload ownership/size verification is passed to delivery instead of requesting a second remote object-storage `stat`.
- Streams are still used for the actual body: this path does not load whole 20 GB uploads into RAM.
- Headers keep the existing private cache policy and the untrusted-content/attachment protections.

**Security boundary:** Reuse of verified metadata is limited to the current authorized request. It is not a global cache of storage authorization, object locations, or content.

## Bounded completed-upload preview prefixes

The small prefix reader used by post-upload content inspection no longer collects arbitrary provider chunks and concatenates them. It allocates exactly the requested preview length (normally 64 KiB), copies only the bytes needed, and ends the remote stream as soon as the prefix is complete. It also skips provider reads for zero-length objects and handles short reads without inventing data.

- The provider may return a chunk larger than the requested range; Cluster must **not** retain that whole chunk in a separate list or copy extra bytes into the preview buffer.
- Node readable streams are closed on early async-iterator completion, freeing provider network and socket resources rather than consuming an entire object.
- Provider I/O failures still reject content inspection; incomplete reads are not silently treated as verified full-file content.
- The preview implementation is distinct from the full-file download streaming pipeline and must never be used to assemble a large resource in RAM.

The cross-platform regression `tools/scripts/cluster-upload-prefix-memory-tests.mjs` covers oversized provider chunks, exact/short range copies, empty resources, invalid lengths, early stream termination and storage failures.

## Buffered Cluster upload admission

`PUT /api/uploads/:uploadId/chunks` is the local/shared-filesystem fallback. Direct-object uploads continue through their own provider-specific multipart contract, without proxying bytes.

The endpoint still uses Fastify's existing **8 MiB** maximum octet-stream parser. To bound memory use at the admission stage, route-level `onRequest` now performs session ownership, transport mode, Content-Range, Content-Length (when supplied), in-flight slot allocation, and workspace byte-budget checks **before** Fastify buffers the body.

- Automatic in-flight limit: clamp available logical processors to 2–8 simultaneous body buffers, calculated once per API instance.
- Optional server environment override: `CLUSTER_UPLOAD_BUFFERED_CHUNKS_MAX` (clamped to 1–16).
- Approximate admission envelope: `limit × 8 MiB` of raw chunk bodies, excluding HTTP, runtime, and other application overhead. Each worker/process has its own cap. This is not an exact RSS guarantee.
- At capacity: `503 UPLOAD_CHUNK_ADMISSION_BUSY` with `Retry-After: 1`. The client should retry the **same chunk/offset**, not start a new upload session.
- The browser upload client treats this exact 503 code as transient backpressure and preserves the original Blob, idempotency key and existing upload session in the durable retry queue. Its retry schedule respects the `Retry-After` header. Native Qt treats 503 as a retryable upload failure and retains the transfer journal.
- Missing, unsafe or oversized ranges are rejected before the buffer is allocated. Clients sending chunked encoding without Content-Length remain supported.
- A session must be **OPEN** and use the Cluster transport; paused, completed, recovery-held or incompatible sessions are rejected before byte quota or buffering.
- Declared upload size and starting offset are compared with the authorized session before byte quota is spent. Stale or out-of-order offsets return `409 UPLOAD_OFFSET_CONFLICT` with `receivedBytes`; wrong declared totals return `400 UPLOAD_RANGE_INVALID`. The durable writer checks them again under its mutation lock to prevent time-of-check/time-of-use races.
- Only one body per upload session is admitted at a time. Additional same-session requests receive the existing retryable `503 UPLOAD_CHUNK_ADMISSION_BUSY` with `Retry-After: 1`, even when global slots remain. Distinct upload sessions can still use the remaining global slots concurrently. This avoids memory and quota waste on upload-session write contention; it does not replace the inter-process durable writer lock.
- The workspace byte rate limit is assessed using the claimed chunk size before parser admission. A body exceeding its claimed range consumes a second quota charge for the excess before returning `UPLOAD_RANGE_INVALID`.
- The durable writer retains its local advisory lock, verified staging path, crash-tail reconciliation, full offset/range checks, fsync and conditional DB commit. Failed commits cannot advance `receivedBytes`.
- Completed or aborted HTTP requests release the admission permit; repeated release is idempotent.

**Not included:** Converting successful local chunks into direct stream-to-disk ingestion. That requires maintaining the same safe path verification, bounded write loop, crash tail cleanup, fsync, and offset revision fencing without keeping uncommitted data. Do not bypass these requirements in a speed-only patch.

## Required acceptance checks

1. Confirm `npm run build` and the transfer regression workflows pass on Windows and Linux. The dedicated scripts are `cluster-completed-upload-range-tests.mjs`, `cluster-upload-chunk-admission-tests.mjs`, and `cluster-upload-client-backpressure-tests.mjs`.
2. On the Dell Windows Cluster server, compare idle RSS, 1/2/4-user concurrent 4 MiB and 8 MiB upload chunks, and 1/2/4 parallel large-file downloads. Record p50/p95 response headers, peak RSS, CPU, I/O queue, DB waits and request counts under matched conditions.
3. Verify that interrupted local and direct-object downloads can resume from a byte range, and that stale `If-Range` validators force a complete transfer.
4. Check that authorization failures, inactive sessions, wrong Content-Range, byte rate limits, aborted clients and full admission queues never advance durable received offsets.
5. Force a staging write/DB commit failure and verify crash recovery still rolls back uncommitted bytes before retrying the same offset.
6. Run concurrent media encoding and internal Git transfers while benchmarking uploads/downloads, tracking disk saturation and GPU/CPU contention. A slower benchmark with unmatched workloads is not evidence of regression.
7. Only after clean Windows certification, adjust the in-flight cap based on measured memory and disk-headroom budgets, not the number of logical cores alone.

## Non-goals

This patch adds **no microservices, remote queues, new database schema, multipart APIs, network hops, or compulsory external caches**. GPU hardware acceleration remains in the existing media worker and requires separate NVIDIA/FFmpeg/Windows certification.
