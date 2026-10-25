# Cluster v0.546.0 | TD6 G26 Workstream 7: Packet reminder evidence and privacy closeout

Status: **source-implemented, G26 OPEN, live runtime certification NOT RUN**. Direct parent is G26 Workstream 6 full source. Nothing here closes Packages, Inventory/Vault, installer recovery, real provider reconciliation or Library bulk retention audit.

## Defects and authority decisions

- The G26 Workstream 6 required acknowledgment ledger was publication/manifest-bound, but no dedicated authorized in-app reminder existed. A manager could see outstanding recipients without an actual notification action.
- The existing notification visibility filter would hide a new Packet-linked inbox item for non-admin recipients. A narrow exception is now allowed **only** for server-created, recipient-owned `packet_acknowledgment_due` action items with matching Packet entity and resource IDs. Generic Packet events remain filtered.
- Privacy data export queried required-release assignment records but **omitted them from the returned collections**, and the category count omitted the assignment value. This is corrected; reminder evidence is also included. Privacy export schema is 11.

## New explicit reminder contract

`POST /api/packets/:packetId/releases/:releaseId/requirements/:requirementId/remind` with `expectedManifestSha256` (exact 64-hex digest). Requires Packets edit and visibility of the unarchived Packet. The transaction takes locks in this order: release row, then matching requirement row. Within the same serializable transaction it checks:

1. The current release belongs to the requested Packet definition and is **not** withdrawn.
2. The client-provided manifest SHA matches the immutable publication and the original requirement.
3. The recipient account is live, unexpired, and still belongs to the strict frozen publication audience.
4. The exact release requirement has not already been acknowledged.
5. No committed reminder for this requirement was sent within the previous **seven rolling days**.

Success atomically writes a `PacketReleaseReminderDelivery` history row, one recipient-owned Notification Inbox action, and the author's activity audit. A failure in any step rolls back every write. No reminder is sent automatically by a background poller. After commit, Notification Service streaming is notified on a best-effort basis; durable inbox storage is the source of truth. Response evidence is `in_app_reminder_created_not_read_proof`. Reminder delivery proves neither viewing the notification nor reviewing the document.

A PostgreSQL migration adds immutable retained reminder evidence with restrictive foreign keys to both release and requirement, plus requirement, recipient, and release indexes. This new migration is **unapplied** in the source checkpoint. The Prisma client has **not** been generated.

## UI and privacy

The manager requirement inspector shows last reminder timestamp and an explicit per-recipient Send reminder action. It disables the action during the seven-day cooldown and when an acknowledgment has already been recorded or the release is revoked. The server independently enforces every rule. Requirement reports aggregate most recent reminder timestamps per requirement using a bounded page of up to 100 requirements; they do not background poll.

The self-service export includes bounded `packetReleaseRequirements` and `packetReleaseReminders` record collections, while `privacyCounts` includes both. Reminder sent-by identity is preserved in the retained compliance history; erasure planning reflects recipient reminder evidence. Sensitive provider keys, source files and private publication manifest bodies are never returned by the reminder API.

## Verification and boundaries

- New focused handler and visibility checks: 15/15 pass (including PostgreSQL-shaped transactional mocks, notification/rollback, cooldown, withdrawn release, revoked recipient, author permission, stale hash, release-scoped report, privacy representation, and UI contract).
- Inherited G26 WS1–6 command passed with expected privacy schema test updates.
- TD5 source closeout passed 14/14 scripts, 167/167 cases.
- Source scan: 1,084 TypeScript/TSX, 3,214 relative renderer imports, 110 CSS files; 0 parser/import/brace errors.

NOT certified: real PostgreSQL migrations, row locks/serializable concurrent writers, Prisma generated client, Node 24 full build, authenticated browser/notification SSE, real object storage, Windows/Qt. Those remain separately gated and should not be inferred from source tests.
