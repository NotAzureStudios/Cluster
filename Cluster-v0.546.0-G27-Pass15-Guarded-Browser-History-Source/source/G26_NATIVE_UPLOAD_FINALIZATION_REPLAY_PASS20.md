# Cluster v0.546.0 | G26 Pass 20: Durable Project-file post-upload finalization replay

**Exact parent:** G26 Pass 19 `Cluster-v0.546.0-G26-Pass19-Transfer-Recovery-Source.zip`. Source-only implementation; this is the next connected fix, not a competing branch or new master roadmap.

## Failure previously possible

A native upload could successfully complete at `/api/uploads/:id/complete`, then post its verified result to `/api/projects/:projectId/files`. That finalizer can consume the upload session and commit the project asset. If Desktop crashes or loses the finalizer response before journaling `complete`, recovery would query a now-consumed upload session, get 404, and show an unrecoverable failed transfer even though the Project file exists. Retrying the original upload is not safe or necessary.

## Added two-phase upload finalization

1. The successful authenticated upload-completion response must identify the original session UUID, verified SHA-256 and original total bytes.
2. Before any Project-file finalization POST, `TransferManager::finalizeUpload` **durably publishes** `uploadCompletionReceipt: true`, checksum, transferred byte count and existing `committing` state. A failed atomic journal save halts the network request, retaining the previously committed evidence.
3. On restart, the queue loader validates the boolean receipt, canonical project-files finalization path, strict session ID, full acknowledged byte count and hexadecimal checksum. Corrupt or inconsistent receipts hold the queue invalid instead of acting on untrusted state.
4. Interrupted in-flight `committing` entries are loaded paused. On explicit resume, `runUpload` sees the verified server completion receipt and invokes **only the canonical idempotent Project-file finalizer**. It does not create a new upload session, query the consumed old session, rehash an unneeded local source, or retransmit file chunks.
5. The existing server finalizer authorizes Project Library contribution, finds `ingestSessionId` before trying to consume the upload again, and returns an authorized replay of the already-created Project asset. The Qt request preserves its stable `qt-transfer:<transferId>` idempotency key.
6. Desktop now validates the returned Project file ID, Project ID, checksum and exact byte count. An invalid 2xx body does not become a successful transfer. Only a validated body plus a successful durable journal `complete` publication emits `transferCompleted`.
7. A terminal authorization or scope denial still fails normally. The receipt gives safe manual retry capability for retryable network/server errors; it does not grant new permissions or automatically bypass access revocation.

**No new Prisma migration or database model**: the server's existing `projectFile.ingestSessionId` / Project resource authorization and canonical Project-file route are reused. The existing Desktop model's `committing` state is reused, not a parallel state machine.

## Development verification

- New source contracts: **25/25** across client journal, C++ helper policy, Qt response handling, server replay ordering, server authorization and Project asset serializer.
- Qt-free journal C++ tests: 7 additional negative/positive receipt checks, now **57** compiled assertions; together with inherited Pass 17 source checks the journal suite reports **81/81**.
- Cumulative `npm run cluster:g26:p20:finalization-replay` chain: **492/492 reported assertions** across Passes 14–20 and inherited Qt-free C++ policy/source contract suites.
- Broad structural scan: **1,132 TS/TSX**, **3,258 renderer imports**, **110 CSS** all clean.
- Unchanged Go native package-stager test/race/vet and Windows x64 cross-build passed at Pass 19 and are rerun for final archive verification.

## Remaining limits

Still no linked Qt 6.11.2 test or authenticated Windows 10 runtime / PostgreSQL acceptance. The server's finalization and use of `ingestSessionId` require an end-to-end test for actual crash ordering. Storage hardlink/reparse races and browser/mobile transfer continuity remain. G26-08 / G26-09 stay **source-partial**, release certification remains outside this pass, and destructive cleanup is not enabled.

**Next connected work:** native evidence linking after finalized files using the existing authorized Project workflow relationship route, with its own durable acknowledged receipt. Do not claim success at queue admission. Relationship name `evidence_for` is not currently in the canonical `CLUSTER_WORKFLOW_RELATIONSHIPS` list, so adding it requires an explicit schema and authorization-aware integration rather than a blind POST.
