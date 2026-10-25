# Cluster security audit trail

Cluster v0.355.0 turns the existing security-event table into a server-owned, append-only integrity trail for authentication, authorization, administrative, configuration, recovery, and other sensitive operations.

## What is authoritative

`SecurityAuditEvent` is the security trail. Ordinary `ActivityEvent` rows remain a product/workspace history feed and `PersistenceAuditLog` remains persistence-specific operational history. Neither substitutes for the security trail.

All v0.355+ security events must be appended through `appendSecurityAuditEvent`. Direct Prisma writes to `SecurityAuditEvent` are forbidden outside that storage helper.

## Integrity chain

New events use integrity protocol 1. Every record includes:

- an ordered sequence number;
- the previous event hash;
- a SHA-256 event hash;
- actor, target, and workspace identifiers where available;
- request ID, method, path, session ID, client address, and user agent where available;
- result and reason code;
- sanitized bounded metadata;
- the server timestamp.

The event hash covers all of those stored fields plus the previous hash. Deleting, reordering, or changing a protocol-1 row causes verification to fail.

Writes acquire a PostgreSQL transaction-scoped advisory lock before reading the chain tip and appending the next row. That makes concurrent requests serialize at the audit boundary instead of racing for the same sequence number.

Events created before v0.355 remain readable as legacy events with integrity version 0. The first protocol-1 row records a `LEGACY:<id>` anchor to the newest legacy event. Cluster does **not** claim that pre-v0.355 rows have retroactive tamper evidence.

## Retention

Generic operational retention no longer deletes `SecurityAuditEvent` rows. The configured audit-retention window applies to activity/persistence history and expired operational credentials, not the protocol-1 security chain.

This is deliberate. Deleting the middle of a hash chain and then calling the remainder "verified" would be security theater with extra database queries.

For long-term archival, administrators should export the trail and preserve the export digest with their backup/recovery records before introducing any future explicit archival mechanism.

## Metadata safety

Audit metadata passes through Cluster's security redaction before persistence. Secret-looking keys, bearer/basic credentials, webhook URLs, sensitive paths, passwords, tokens, PINs, and similar values are removed or redacted. Metadata is capped at 32 KiB after sanitization; oversized metadata is replaced with a bounded record containing a SHA-256 digest of the sanitized form.

The structured audit fields intentionally retain identifiers needed for investigation. Access to the security-event API remains administrator-only.

## Sensitive request coverage

In addition to explicit authentication/security events, the server records outcomes for privileged mutations at the request boundary, including:

- `/api/admin/*`;
- server configuration and settings;
- access-rule changes;
- context-pack mutations;
- persistence control operations;
- communications administration;
- administrative user creation/update/delete;
- project creation/deletion.

These boundary events record the HTTP outcome even when individual route code forgets to add a product-specific security event.

## Verification

`GET /api/security/events/integrity` performs a full protocol-1 chain verification and reports:

- whether the chain verifies;
- number of chained rows checked;
- number of legacy rows;
- first/last sequence;
- current tip hash;
- write-failure telemetry;
- verification timestamp.

A failed integrity result is an operational security incident. Do not "repair" it by rewriting hashes. Preserve the database and logs, investigate the first failing sequence, and restore from known-good evidence if necessary.

## Export

`GET /api/security/events/export` is an administrator-only, recent-authentication-protected evidence export. It supports bounded event/result/actor/target/request/date filters and returns at most 5,000 events per export.

The response contains an `exportDigestSha256` over Cluster's canonical export representation and returns the same digest in `X-Cluster-Audit-Digest-SHA256`. Exporting the trail is itself recorded as a security event.

## Write failures

Audit writes are not silently ignored. Failures are logged at error severity, counted in security telemetry, and surfaced by integrity diagnostics. The HTTP action that triggered a post-response boundary audit may already have completed, so a write failure is treated as a degraded security state requiring operator attention rather than pretending the original mutation never happened.

## Limits and non-goals

The protocol detects accidental or unauthorized database-row alteration when the attacker cannot consistently rewrite the entire application state and every retained external copy. It is not an external transparency ledger, HSM-backed signature system, or defense against an attacker with full control of the Cluster process, database, backups, and all exported evidence.

Preserve exports/backups outside the live server, protect the PostgreSQL account, and monitor integrity/write-failure status. Tamper evidence is useful only if humans resist the ancient instinct to delete the inconvenient evidence.
