# Cluster v0.546.0 | TD5 implementation roadmap | Pass 5

**Canonical source baseline:** TD5 P4. **TD4 stays source-closed; TD5 stays active.** These source and Linux filesystem results are not PostgreSQL, Windows, SMB, S3, native Qt or release certification.

## TD5 P5 implemented

1. **Direct-upload completed-object safety:** no automatic unfenced `storageRuntime.delete` from the upload-session runtime on checksum/size mismatch, completed-session consumption, cancellation, idempotency-key replacement or expiration. Multipart aborts for unfinished uploads and ordinary local staging cleanup remain separate.
2. **Deferred remote-object recovery evidence:** appended, fsynced `.cluster-deferred-direct-uploads.jsonl` records with exact upload UUID, temporary provider/key, previous status, cleanup reason, declared bytes and available checksum. Journal entries are evidence, never deletion permits.
3. **Fail-closed session retirement:** invalid/mismatched provider pointers, unsafe path topology, symlink/hard-linked journal files or failed evidence I/O leave the database session intact rather than silently dropping its pointer. A multi-process provider-generation and session deletion transaction remains unproven until live PostgreSQL tests.
4. **Regression evidence:** 16 focused P5 tests (production TS functions and real Linux filesystem), 61/61 inherited TD4 scripts, 12/12 P2, 20/20 P3 and 19/19 P4 storage checks. Updated the old R68 staging assertion to reflect the safety contract.
5. **Environment inventory:** Node 22.16.0 and Go 1.23.2 available; pinned Node 24.20.0 and Go 1.27.1, dependency lockfile, workspace dependency installation, generated Prisma client, and running PostgreSQL 17/18 are missing. No production build or live database certification performed.

## P6 required

- Obtain exact pinned toolchains and a reviewed npm dependency lock; install from locked dependencies, generate Prisma 7.9.1 client, compile all workspaces, and report actual full-build diagnostics.
- Provision disposable PostgreSQL 17/18 for Prisma migration, two-process outbox/queue concurrency, lease interruption, upload-session state transitions, and recovery tests; use real database transactions and capture evidence.
- Reconcile the deferred backup and direct-upload journals against remote generations, successful upload publication, live ownership, backup retention, and restore proofs. Physical deletion, managed GC, storage migration and quarantine execution remain disabled until independently certified.
- Run native Windows Host/Launcher and NTFS/SMB/Qt tests on actual Windows hardware, plus provider-specific S3 copy/multipart failure injection.

**Storage consequence:** retained direct-upload objects will increase remote storage usage until a separately authorized, generation-fenced cleanup system is certified.
