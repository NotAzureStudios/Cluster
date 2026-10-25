# Cluster v0.546.0 | TD6 G26 Workstream 8: on-demand provider recovery inspection

Status: **SOURCE IMPLEMENTED, G26 OPEN, runtime certification NOT RUN**. Direct source parent: G26 Workstream 7. Workstream 7 reminder evidence / privacy export v11 and all older work remain unchanged.

## Scope and rationale

The existing admin-only upload recovery queue surfaced `FINALIZING`, `ABORTING`, `CLEANING`, and `REVIEW_REQUIRED` database sessions. It did not determine whether an object had been written to S3-compatible storage or whether a multipart upload identity remained active. Treating a timeout as either completion or failure would risk an unsafe retry or destructive cleanup.

Workstream 8 adds **explicit, read-only, per-session inspection** from the existing Library Recovery panel. It does not reconcile, approve, release locks, retry, quarantine or delete anything. There is no background polling. It is a diagnostic prerequisite, not the finished operator recovery workflow.

## Implementation

- `GET /api/library/transfers/recovery/:uploadId/inspect` requires authenticated Library access and administrator status; emits `Cache-Control: private, no-store`. Nonrecovery/unknown sessions return 404. No new mutation route exists.
- Backend re-reads the exact unresolved session and validates its Cluster-owned `temporary/uploads/{workspace}/{session}/{filename}` direct-upload pointer before any remote request. Only configured object-storage/multipart-capable providers are accepted. Malformed keys, wrong workspace IDs, local staging and missing pointers are never queried remotely.
- S3-compatible object inspection performs read-only `HEAD`. Reports `present`, `not_found`, or `unavailable`, bounded object bytes, expected-size comparison and optional checksum-*metadata* comparison. **Checksum metadata is not a verified content digest** and an existing object is not proof of successful publication.
- S3-compatible multipart inspection issues signed `GET ?uploadId=...&max-parts=100` (`ListParts`) with a 128 KiB response cap. It reports a bounded part count/byte sample and `IsTruncated`, not ETags or the multipart identifier. `not_found` is returned **only when the provider explicitly says `NoSuchUpload`**, not on a generic 404. Permissions failures, malformed XML or timeouts are `unavailable` to callers.
- Related Library finalize jobs are inspected by indexed dedupe key, not untrusted payload. Job status is bounded to 20 rows with an explicit incomplete state. The session is reread after provider calls and results are marked stale if state, timestamp or remote pointer changed.
- The Library panel shows a per-session **Inspect provider state** control, one evidence result at a time, size/digest-metadata warnings, multipart and job state, and explicit retention of the read-only safety boundary. Closing, refreshing or switching inspections invalidates stale UI results.
- Server response never contains storage key, multipart ID, provider URL, signature, credentials, ETags, filesystem path, raw provider error, or source Library file contents.

## Fault handling / limitations

Observed provider state is **not** a generation-fenced lease, atomic storage snapshot, object version/generation identity, strong digest verification, exclusive job lock, validated remote backup, or eligibility for disposition. A 404 HEAD may indicate a missing finalized object while multipart parts still exist. An expired job lease does not authorize stealing work. Unknown/incomplete evidence remains unknown; a provider may change immediately after observation. Remote bytes and recovery sessions remain protected.

This work does not add persistence of a signed inspection report, operator approval/reconciliation, automatic provider cleanup, Library bulk retention preview, Packet escalations, Packages/Inventory/Vault, or native installer rollback. All remain separate G26 tasks.

## Tests and certification

`npm run cluster:td6:g26:ws8` runs the 17 new executable controlled-provider and route tests, then inherits the full WS7→WS1 test chain and source scan. New tests cover exact keys, non-object provider rejection, redaction, 403/404/timeout behavior, NoSuchUpload specificity, bounded ListParts parsing, concurrent session changes, job ownership uncertainty, local-staging exclusion, admin authorization and UI contract. `npm run techdebt:td5:source-closeout` independently passes 14 scripts/167 cases.

NOT RUN: dependency-backed Node 24 compilation, generated Prisma client, PostgreSQL migrations and row-lock/concurrency tests, authenticated browser/Qt interaction, real AWS/S3-compatible object-store `HEAD`/`ListParts`, Windows/SMB/NAS/provider failover. Migration `20261031000000_td6_g26_packet_requirement_reminders` inherited from Workstream 7 remains unapplied. No new database migration or native executable is introduced here.
