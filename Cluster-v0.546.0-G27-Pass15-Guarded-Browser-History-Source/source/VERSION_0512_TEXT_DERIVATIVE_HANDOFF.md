# Cluster 0.512.1 | Packet detached text derivatives

## Baseline
- Parent: `Cluster-v0.512.zip` source tree.
- Development-only checkpoint. Does not supersede authoritative Pass 14/15 until conflict reconciliation.
- New migration: `20261008233000_packet_text_derivative_delivery`. Requires real PostgreSQL deploy/test.

## Implemented
1. `PacketReleaseDerivative` immutable-ish DB row stores detached content bytes, SHA-256 and release/position. No source file path or Library ACL grant. Unique release/position. The bytes/metadata are written in the same transaction as the frozen publication manifest and published-source backlinks.
2. Default publication (`{}`) remains metadata-only. Explicit `{textDerivatives:true}` snapshots allowed `public/internal` `note` items with nonempty bodies; file-backed content, confidential/restricted objects and oversized notes are excluded. Text is delivered as an attachment with nosniff and no-store. Max 64 KiB per note, max 1 MiB total; no silent truncation.
3. Recipient catalogue flags downloaded-note positions without revealing Library identity, checksum or storage path. Recipient artifact GET verifies publication digest, archived/current Packet visibility, frozen audience, derivative digest/size, and logs download. Nonexistent/corrupted artifacts fail closed.
4. Editor-only preflight shows counts and potential derivative bytes; publishing always recalculates transactionally. UI offers Publish snapshot, Publish + note downloads, Preview publication and Download note.
5. Source-level tests: `cluster-0512-text-delivery-assertions.mjs`, `cluster-0512-text-delivery-route-assertions.mjs`. Inherited notification assertion updated only for the new honest UI label.

## Security/correctness warnings
- The recipient API is **not** a direct Library download. Do not widen to arbitrary binary originals.
- Current UI links use Cluster's configured API URL and authenticated browser cookies. Confirm Desktop credentials, request proof/cookie delivery and CSP at runtime.
- A prior published release without derivatives cannot be retroactively populated through this route. Advance version and republish.
- Packet audience is frozen at publication; all user/account and tool permissions still apply at download time.
- Database mutations outside supported APIs or backup tampering are out of scope for hashes; do not call this an externally signed release.

## Priority next
1. Real PostgreSQL migrate and multi-account download denial tests on the reconciled baseline.
2. Secure async binary/PDF/media derivative workers: checksums, metadata stripping, watermarking, supported file types, immutable artifact storage, quotas, error/retry states, and user entitlement/audit.
3. Packages and deployment/rollback, work collaboration/undo, Notification outbox and settings polish.
4. Full integration of authoritative Pass 15, typecheck, Windows/Qt and recovery.
