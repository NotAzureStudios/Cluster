# Database recovery and backup resilience

Cluster v0.359 treats backup creation and restore drills as a production recovery boundary rather than a file-copy convenience.

## Recovery generation contents

A committed schema-v2 backup generation contains:

- a PostgreSQL custom-format dump,
- a portable archive of the configured Cluster upload root,
- a portable archive of server branding assets,
- the compact boot configuration when present,
- the PostgreSQL migration history and selected recovery counts,
- the non-secret Cluster storage-key identifier required to locate the matching recovery key,
- SHA-256 digests and byte/file counts for filesystem artifacts,
- an HMAC-SHA-256 manifest signature derived from the Cluster storage key.

The manifest stores artifact **file names**, not absolute machine paths, so a generation can be copied to another host without preserving the original data-root layout.

`CLUSTER_SECRET_KEY` is never copied into the backup. Operators must preserve the matching key independently. A database dump containing encrypted settings is not sufficient recovery material without that key.

## Commit semantics

Backup artifacts are written through temporary files and renamed only after their write succeeds. The manifest is committed last. A scheduler window is considered satisfied only when its committed manifest exists, so an abandoned `.partial-*` file cannot suppress the next scheduled attempt.

A failed generation is cleaned up. Maintenance also removes stale orphan/partial backup artifacts. Retention works on complete generations and keeps at least the three newest committed generations even when they are older than the configured age.

Cluster serializes backup creation inside a server process so a manual backup and scheduled backup cannot run concurrently.

## Writable-primary requirement

Cluster is a read/write collaboration service. It refuses normal startup when `pg_is_in_recovery()` reports that the configured PostgreSQL endpoint is a recovery/read-only replica.

Backups are also refused against a recovery replica. Pointing the application at a standby and hoping writes somehow sort themselves out is not a failover strategy.

## Immediate verification

A committed generation must pass structural checks before its manifest is written:

- `pg_restore --list` must accept the PostgreSQL dump,
- the upload and branding archives must parse as safe Cluster ustar archives,
- archive file counts, content byte counts, and SHA-256 values must match,
- the boot configuration, when present, must remain valid JSON.

The source database count/migration snapshot is sampled before and after the backup. `snapshotStableDuringBackup` records whether those sampled values remained unchanged. A busy server can still produce a valid PostgreSQL MVCC dump when the samples differ, but Cluster does not pretend the pre-backup counts are then an exact dump fingerprint.

## Signed manifest

Schema-v2 manifests are signed with a purpose-separated HMAC-SHA-256 key derived from `CLUSTER_SECRET_KEY`.

Verification accepts the active key and configured `CLUSTER_SECRET_KEY_PREVIOUS` values so backup generations remain verifiable during planned key rotation. Changing the manifest, artifact names, checksums, recovery metadata, or file counts invalidates the signature.

The signature is application-level tamper evidence. It does not protect against an attacker who already controls both the live server process and its active secret key.

## Restore drill

`POST /api/admin/backups/:fileName/restore-drill` is a destructive-capability check performed against disposable resources only. It requires administrator access, recent authentication, the normal high-risk confirmation, and the critical-work concurrency budget.

For a schema-v2 generation Cluster:

1. verifies the signed manifest and all artifact checksums,
2. creates a randomly named temporary PostgreSQL database on the configured PostgreSQL server,
3. restores the custom-format dump with `pg_restore --exit-on-error`,
4. reads the restored migration history and selected table counts,
5. compares authoritative recovery metadata when the source snapshot was stable,
6. extracts upload and branding archives into disposable directories using traversal-safe paths,
7. compares restored file and byte counts,
8. force-drops the temporary database and removes temporary filesystem output.

The live Cluster database and live upload/branding roots are never replaced by a restore drill.

The PostgreSQL account used for an in-app restore drill needs permission to create and drop an isolated database. If your production database role intentionally lacks `CREATEDB`, keep that restriction and run the release/operations restore drill with a dedicated recovery credential instead.

## Scheduler timezone

Backup schedule evaluation now honors the configured IANA timezone. New configuration values are validated as real IANA timezone identifiers rather than accepted as arbitrary strings.

## Filesystem archive safety

Cluster's filesystem backup writer:

- archives regular files only,
- rejects symbolic links and unsupported special files,
- normalizes paths to portable POSIX separators,
- rejects absolute/traversal paths,
- enforces bounded path and entry counts,
- validates ustar header checksums before extraction,
- extracts only beneath a disposable restore root.

This avoids allowing a backup archive to become a filesystem traversal mechanism during a recovery drill.

## What this does not claim

Cluster v0.359 does **not** provide PostgreSQL point-in-time recovery or WAL archiving. Organizations that require very small recovery-point objectives should configure PostgreSQL-native WAL/PITR tooling in addition to Cluster generations.

Cluster also does not claim an atomic distributed snapshot across PostgreSQL and every filesystem byte while users continue mutating the system. Project/media files are designed as durable stored artifacts and are archived with integrity metadata, while PostgreSQL itself uses its normal consistent `pg_dump` snapshot semantics. For strict maintenance-window snapshots, quiesce writes before taking the generation.

Backups should be copied off-host. A backup stored only on the same disk as the live server is protection against mistakes, not against disk loss, ransomware, or the machine becoming an expensive paperweight.
