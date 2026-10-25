# TD5 P4 technical audit | backup mirror and remote materialization

## Confirmed defects in P3

- `server-services-operations.ts` mirrored backup files after publishing the local signed manifest. An outbound error could leave a published but incomplete generation.
- `mirrorBackupGeneration()` deleted every planned remote key on failure, including keys copied by a different process or earlier generation. `deleteMirroredBackup()` also unconditionally deleted remote keys during manual delete, retention pruning and failed-generation cleanup. None of those operations had ownership/generation fencing.
- The generic `ClusterStorageRuntime.materializeToFile()` fallback created a target directory without checking symlink/junction ancestry, unlike the local provider implementation. It also did not detect simple changes to remote source metadata between read and publication.
- Failed recovery-evidence projection after backup commit could turn a committed backup into an apparent failure and encourage a misleading retry.

## Implemented behavior

- Mirror copy failure or size discrepancy throws without remote unlink. Failed-generation remote pointers are journaled for future reconciliation; local cleanup proceeds only after the journal sync succeeds. A journal failure preserves local artifacts.
- Signed manifest content is first written to a partial file, mirrored using the **canonical manifest object key**, and only then atomically renamed into the local published manifest path. The create function treats failed post-commit recovery-evidence projection as a warning.
- Manual and retention deletion journal remote references before deleting their associated local backup generation. Results disclose that remote copies were retained. No provider delete is invoked for backup mirrors.
- Journal records include generation, provider, immutable unique evidence ID, reason and exact object keys. The journal is append-only by this codepath, fsynced, and guarded against symlinked ancestors/journal and hard-linked journal files. It is **not** a tamper-proof external audit system.
- Remote materialization validates destination-parent directories, destination publication, and source metadata recheck. It still cannot prevent a concurrent same-size/same-mtime remote mutation without a provider ETag/generation read fence.

## Verified evidence and limitations

- Executable test script: `npm run techdebt:td5:p4:backup-mirrors`; 19/19 source-extracted and real Linux filesystem cases pass.
- Inherited suites: TD4 61/61, P2 12/12, P3 20/20; source scan clean.
- Node 22 development-only runtime; no database migration, Go/native executable changes, actual PostgreSQL server, Node 24 build, S3, SMB, or Windows runtime certification.
- Storage cost can rise because remote mirrored backups are intentionally not physically deleted during retention pruning. Do not enable automatic cleanup solely based on this journal.
