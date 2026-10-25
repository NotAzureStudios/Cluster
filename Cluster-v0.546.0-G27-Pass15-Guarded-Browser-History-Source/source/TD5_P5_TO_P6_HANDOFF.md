# Cluster TD5 P5 → P6 handoff

Baseline is `Cluster-v0.546.0-TD5-P5-Direct-Upload-Deferred-Cleanup-Source.zip` after validating its SHA-256. It supersedes P4, preserves TD4 R76.2 source closeout and P1–P4 reliability fixes.

## Changes

- `apps/server/src/domains/uploads/deferred-direct-upload-journal.ts`: new fsynced append-only local evidence journal with provider-key validation and path checks, no deletion execution.
- `apps/server/src/domains/uploads/upload-session-runtime.ts`: non-destructive checksum/size mismatch and retirement paths; records evidence before session deletion; unfinished multipart abort and local staging cleanup remain.
- `tools/scripts/cluster-td5-p5-direct-upload-retention-tests.mjs`: actual runtime-function and filesystem failure tests.
- `tools/scripts/cluster-td4-r68-storage-safety-tests.mjs`: revised obsolete expectation that completed direct storage is physically removed.
- `package.json`: `techdebt:td5:p5:direct-uploads` verification command.

## Evidence and limits

- Inherited TD4 61/61, P2 12/12, P3 20/20, P4 19/19 and P5 16/16.
- Active TypeScript syntax/import scan passed. Full semantic TypeScript compilation remains blocked by absent workspace dependencies and generated Prisma; P5 adds only missing-environment Node declarations relative to P4.
- No live PostgreSQL, Node 24, Go 1.27, Windows, NTFS, SMB, S3 or Qt acceptance performed.
- Journal append and eventual database row deletion are not a single distributed transaction. If the database delete fails, duplicate journal evidence can be produced on retry; this is intentionally safe and should be reconciled by evidence ID/upload ID. Multi-process expiry producer fencing remains pending.
- A failure to append/sync evidence prevents deletion of the DB session, but cannot recall provider-side bytes already produced by multipart completion. The journal is NOT a physical deletion permit.

P6 should begin with pinned toolchains, generated Prisma, disposable PostgreSQL testing and a real runtime build. Keep physical removal disabled until the provider-specific recovery proof exists.
