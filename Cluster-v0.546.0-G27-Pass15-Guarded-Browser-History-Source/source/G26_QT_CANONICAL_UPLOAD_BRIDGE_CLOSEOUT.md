# G26 Pass 10: Canonical Qt Upload Transport & Custody Closeout

**Checkpoint:** Cluster v0.546.0 · G26 Pass 10, cumulative from exact Pass 9 parent.
**Scope:** Align the real Qt TransferManager/Mounted Libraries uploader to the existing server, not a new upload API. No Prisma migration; no privileged MSI operation enabled.

## Confirmed source defects corrected

1. Qt previously called `/api/desktop-transfers/uploads[...]`, routes not registered by Cluster. It now uses authenticated `/api/uploads`, `/api/uploads/:uploadId`, `/api/uploads/:uploadId/chunks`, `/api/uploads/:uploadId/resume`, and `/api/uploads/:uploadId/complete`.
2. Mounted Library upload finalization previously targeted non-existent `/api/desktop-libraries/from-desktop-transfer`; now uses the canonical `/api/desktop-libraries/from-upload` route and supplies its existing `uploadId`.
3. The server's owner-scoped `clientKey` is stable per persisted Qt transfer ID to recover a lost create-session response. A missing/expired/revoked session returns explicit terminal failure and cannot quietly allocate a replacement. Qt accepts only Cluster-proxied uploads; direct-object multipart requires a different implementation.
4. Qt validates session ID, mode, status, total, committed offset and completion response SHA-256/byte counts. PAUSED sessions require server-authenticated resume. 409 offsets are accepted only from `UPLOAD_OFFSET_CONFLICT`, with numeric bounds. Invalid receipts fail closed.
5. On reconnect to an already-COMPLETED server session, the Desktop independently hashes its local source and compares the result with the server's stored SHA-256 *before* invoking idempotent completion and downstream Library finalization. Different local bytes are terminal errors.
6. Terminal 4xx authorization, revocation, validation and integrity failures are non-retryable; only transport errors, 408/425/429 and 5xx errors permit operator Retry. The native capability broker propagates `retryable` to Transfer Center.
7. Success no longer issues a destructive DELETE against the completed upload. Only its downstream consumer may consume/dispose of the uploaded bytes. Library's canonical finalization route owns its consumption operation; an unconsumed transfer receipt is retained for explicit downstream handling or existing server retention rules.
8. The inherited Qt download test now accounts for the additional authenticated PAUSED-resume callback, which enforces the same cancellation/interrupt fence as the previous five.

## Evidence and limits

- Run `npm run cluster:g26:qt-canonical-upload` for source-level cross-layer contract checks plus compiled Qt-independent byte-range policy tests.
- Executable server upload staging tests: `node --experimental-strip-types tools/scripts/cluster-td6-g26-ws4-upload-commit-tests.mjs` and `...upload-client-recovery-tests.mjs`.
- Go helper native/race tests and source syntax/import scan remain regression gates.
- No Qt 6.11.2 dependency-backed compile or actual Windows 10/SMTP/NAS/live PostgreSQL transport run took place here. The tests do not prove the full UI→Qt→Fastify→PostgreSQL round trip on a running server. Browser/mobile parity, remote session expiry, S3 direct multipart, concurrent replacement, and upload cancel/cleanup UX remain open.
- **G26-08/09 remain source-partial. G26-10/11 remain open.** Do not promote source evidence to 1.0 certification.

## Next implementation priorities

The native transfer queue should preserve remote upload ownership even across sign-out/scope change, enable explicit authenticated discard with clear remote disposition evidence, and show remediable `UPLOAD_*` statuses without automatic unsafe session regeneration. Then finish cross-window, browser/mobile and live Windows 10 tests. The Package installer needs separate live MSI/reboot/repair/uninstall acceptance.
