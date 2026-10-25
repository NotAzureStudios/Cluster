# Cluster v0.511 → v0.512 | Communications & Distribution handoff

## Development source milestone
- Input: `Cluster-v0.511.zip` (source-only).
- Output: `Cluster-v0.512.zip` and `Cluster-v0.512.patch`.
- No production server, Windows native binaries, Prisma-generated clients or fresh PostgreSQL migration execution.
- This version boundary enters **0.512 certification/hardening**, but **does not certify** the application.

## Implemented in this batch
1. **Immutable Packet recipient catalogues:** `GET /api/packets/:packetId/deliveries` and `GET /api/packets/:packetId/deliveries/:releaseId/catalog` require Packet view, packet visibility, and the **published version's frozen audience**. Both are `no-store` and fail closed. The catalogue verifies the manifest SHA-256, schema, policy and version. It emits only published display titles, types and sizes, never Library source IDs, original hashes, storage paths, or download grants.
2. **Reader UI:** Published releases are available to inspect in Packets. The view explicitly says delivery derivatives are pending and does not expose direct source-download links. Responses are guarded against stale packet/release navigation.
3. **Published source lifecycle:** Publication inserts Library backlinks for each source inside the same database transaction as the release. Library destruction blocks published sources regardless of the user's ordinary backlink acknowledgement. Normal backlink acknowledgement still works for other references.
4. **Mandatory critical security notifications:** Critical `system/security` notifications survive user category mute and quiet-hour suppression. Non-critical system activity and other categories retain existing mute rules. Notification lists and digest categories retain System records so such alerts cannot become unqueryable.
5. **Executable regression:** 15 new distribution/notification assertions plus 18 inherited/new suites (0 failures). Existing Library destruction test fixture updated to distinguish publication backlinks from ordinary links.

## Explicitly *not* implemented or certified
- Actual Packet derivative generation and download delivery, Packet entitlement grants, external portal distribution or recipient file delivery. Published catalogue is intentionally **metadata-only**.
- Managed signed Packages, Git/LFS/Unreal/Desktop deployment lifecycle, Discord retry/outbox completion, and full centralized Notification/Announcement/Action workflow consolidation remain outstanding.
- Full dependency-backed TypeScript compilation, generated Prisma 7 client, real PostgreSQL migration and concurrency exercise, integration permission matrix, Desktop Qt/Go rebuild, OS-specific release tests, load/offline/reconnect and accessibility certification remain outstanding.
- Authoritative Pass 14/15 source conflict reconciliation is still required: staged source must not overwrite authoritative changes blindly.

## Runtime risk to test first
- In a fresh PostgreSQL database publish a Packet with file and nested folder sources; verify a simultaneous Library deletion either aborts or rolls back publication, never leaving a published release without protected references.
- Verify recipient A sees only authorized releases by the frozen audience, recipient B cannot infer hidden release IDs or source metadata, and content remains inaccessible via raw `/api/library/:itemId/file` unless independently authorized.
- Verify notification critical security alerts under system mute/quiet hours, and routine notifications still honor preferences, across browser and desktop push channels.

## Next practical work
The v0.512 certification wave needs the authoritative source reconciliation and full dependency-backed build before feature work can safely be considered release-ready. Complete derivative artifact generation and managed Package delivery as tracked carry-forward; do not call the existing catalogue a file-delivery feature.
