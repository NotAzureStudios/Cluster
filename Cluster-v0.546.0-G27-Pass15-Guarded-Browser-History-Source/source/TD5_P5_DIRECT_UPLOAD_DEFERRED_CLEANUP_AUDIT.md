# TD5 P5 | Direct-upload retention and failure-boundary audit

## Finding

The upload session runtime previously invoked `storageRuntime.delete` against `temporary/ uploads/...` object-storage keys after completed multipart size/checksum mismatch, completed-session consumption, abort and expiry. This happened without provider-version/ETag fencing or independently proven destination ownership. The database row was then removed, losing the first-class ownership pointer even when deletion itself failed.

## Source correction

P5 replaces these unfenced deletes with `recordDeferredDirectUpload`. The evidence journal is written and synced before discard of the session DB row. A failed journal write blocks that discard. The journal requires the exact upload ID to match the UUID segment in the remote key, rejects unsafe providers/tier/key and rejects symlinked/hard-linked evidence files. It contains no code capable of deleting remote storage. It does not add another provider abstraction or bypass the existing storage service.

Unfinished multipart uploads may still be aborted using their explicit multipart ID. Cluster-proxied upload staging remains locally managed; these lifecycles are separate from published managed blobs.

## Not claimed

- A local fsync does not atomically commit a PostgreSQL row deletion or a remote provider write. Double-written journal entries are safe evidence, not exactly-once guarantees.
- Linux local filesystem tests are not Windows, SMB or remote-provider durability tests. Directory fsync is used where POSIX permits, while Windows uses file fsync; Windows durability needs dedicated acceptance.
- S3 object generations/version IDs and external backup retention remain unverified; quarantine and physical deletion are disabled.
- Node 24.20.0, Go 1.27.1, Prisma dependency installation and PostgreSQL 17/18 server were not available here. No dependency-backed compilation or live database certification was possible.

## Certification gate

Before enabling cleanup, identify the exact provider object generation and its ownership, check references and retention across all consumers, stage reversible quarantine, demonstrate restore under interruption, and require independent authorization. Never interpret a journal record as sufficient deletion authority.
