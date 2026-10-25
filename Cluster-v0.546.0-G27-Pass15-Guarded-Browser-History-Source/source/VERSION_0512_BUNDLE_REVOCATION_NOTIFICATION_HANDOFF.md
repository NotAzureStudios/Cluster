# Cluster v0.512.2 | Larger feature pass handoff

## Source lineage

Parent: `Cluster-v0.512.1.zip` (`source/`). Current: `Cluster-v0.512.2.zip` (`source/`), source-only, no native rebuild or dependency installation. The incremental `.patch` must replay against the parent to reconstruct the complete `source/` tree. Historical OVERLAY_MANIFEST is not rewritten.

## Implemented

### Detached recipient bundle
- `packet-bundle.ts` builds bounded uncompressed ZIP with names `notes/note-NNNN.txt` and `manifest.json`; never consumes original Library source paths/files. Each note is independently SHA-256-verified; invalid positions, duplicate positions, malformed release manifests, corrupted bytes and size caps abort the whole bundle.
- Authenticated `GET /api/packets/:packetId/deliveries/:releaseId/bundle` validates Packet visibility, frozen release audience, release hash, derivative bytes, and writes an activity record before sending a no-store, nosniff ZIP.
- Packet reader offers "Download available notes (ZIP)" alongside individual note downloads. Missing binary or PDF derivatives are never substituted with raw Library files.

### Safe publication withdrawal
- `PacketRelease` has revocation metadata and an index; new forward-only migration `20261009001500_packet_release_revocation` must be applied to a real PostgreSQL database before using the new route.
- Only an authenticated Packet editor who is an administrator may revoke a release; typed confirmation, minimum reason and exact manifest SHA fingerprint are required. Transaction performs conditional `updateMany` plus durable activity audit; failed audit rolls back.
- Revoked releases disappear from recipient catalogues and refuse catalogue, single artifact and bundle downloads; original publication manifests, protected Library backlinks, and revocation audit remain stored. An admin can inspect revoked records in the editor list. No self-service reactivation path.

### Notification retry correctness
- Inbox materialization now creates recipient/event records using the existing unique key instead of upserting. Duplicate replay creates no new live/Discord notification and does not reset read/dismissal. `P2002` is treated as already materialized, but database errors still propagate. Recipient sets deduplicate and have a 5000-item safety bound.

### Durable Discord queue recovery
- Repair scans a bounded number of stale pending `discord.notification.send` receipts, checks that connection, notification and route remain valid, and re-enqueues by the existing durable dedupe key; completed/running records are not retried.
- Admin `/api/admin/discord/deliveries/repair` is guarded by integrations-manage permission. Also scheduled automatically on an idle-adaptive 5-minute baseline / 30-minute max maintenance task using existing BackgroundTaskRegistry. This avoids adding a new polling service.

## Validation / evidence
- Focused executable source/mock tests: `cluster-0512-packet-bundle-assertions.mjs`, `cluster-0512-packet-revocation-assertions.mjs`, `cluster-0512-notification-idempotency-assertions.mjs`, `cluster-0512-discord-recovery-assertions.mjs`. Existing text-delivery route and 0.508 release fixture updated to retain their original privacy assertions as the release contract expanded.
- Prior 0.507–0.512 suites must all pass; repository TS/TSX syntax, CSS brace and relative renderer imports validated. Test bundle was opened with an independent ZIP parser and every detached note matched the supplied SHA-256 digest.
- Source hashes, ZIP CRC/integrity and byte-exact patch replay verified at packaging.

## Open mandatory gates
1. Acquire and reconcile authoritative Pass 14/15 source. Existing 0.506–0.512 development branch is **not** merged/certified.
2. Install Node >=24.20 and dependencies; generate Prisma Client; complete real `tsc`/web builds.
3. Apply migrations on a fresh and an upgraded PostgreSQL instance; test revocation/write transaction races and multi-user authorization at runtime.
4. Rebuild and test native Windows server/Qt Desktop, browser authentication/cookies, network/offline recovery, cross-process Discord retries and cleanup.
5. Add secure PDF/media derivatives, Package deployment/rollback, remaining Notify/Work/Calendar/Library UX and the broader feature ledger. No false certification claims.
