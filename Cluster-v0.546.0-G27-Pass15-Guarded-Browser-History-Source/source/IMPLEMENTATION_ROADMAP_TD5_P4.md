# Cluster v0.546.0 | TD5 implementation roadmap | Pass 4

**Canonical baseline:** TD5 P3. **TD4 remains source-closed. TD5 remains active.** The release-certification roadmap is separate; the findings here do not certify Windows, Node 24, PostgreSQL, S3 or SMB.

## P4 implemented

1. **Remote backup mirror safety.** Mirroring no longer deletes remote objects when a copy or size check fails. A remote generation may have shared ownership, and the current providers cannot prove a generation-fenced delete.
2. **Backup manifest publication.** Signed manifest bytes are staged; remote copies, including the staged signed manifest, must complete before the local manifest is atomically published. Failed pre-publication generations do not present as committed backups.
3. **Deferred-cleanup evidence.** Backup failure, retention pruning and manual backup removal write remote storage pointers to a durable, append-only JSONL journal before deleting local evidence. Recording failures block local cleanup. No remote deletion is performed. The journal checks key integrity, symlinked ancestors, symlink/hard-linked journal targets, validates generation identity and fsyncs the record. An interrupted journal write is an incomplete evidence record that must block future reconciliation; it cannot grant deletion permission.
4. **Post-commit outcome.** Failure of recovery-evidence projection after successful manifest publication is logged without converting the committed backup into an apparent failure.
5. **Remote materialization path parity.** StorageRuntime's S3/remote fallback now enforces the same node-local destination-directory checks as LocalStorageProvider and re-reads remote size/modified-time evidence before publishing the Project copy. This is a best-effort source-change check, not a provider generation fence.
6. **Executable verification.** 19 focused P4 tests covering the real journal and production-mirror/fallback implementations, P2/P3 filesystem tests, inherited TD4 regression suite, source scan and dependency-limited TypeScript comparison.

## Still blocking runtime certification

- **Pinned build:** Node 24.20.0, Go 1.27.1, dependency lock, workspace dependencies and generated Prisma client are not available in this runtime. A full dependency-backed build was not possible.
- **Live PostgreSQL:** `pg_config` is available, but no PostgreSQL server executable or disposable database was available. Multi-process concurrency, migrations and recovery are not certified.
- **Native Windows/SMB/S3:** Linux tests cannot certify NTFS reparse points, SMB provider behavior, remote object generations, Qt Desktop, the native Host, or real S3 copy/abort semantics.
- **Provider disposal:** Quarantine, physical deletion, managed-blob GC and automatic tier migration remain disabled. Remote backup mirror bytes are retained after local pruning and may increase storage usage. A future provider-fenced cleanup workflow must reconcile the deferred journal with signed backup manifests and independent backup retention/restore evidence.
- **Remaining destructive paths:** Completed upload staging cleanup and local backup artifact pruning are separate operational lifecycles. Audit and certify those independently; no P4 test grants deletion authority.

## P5 recommended target

Provision pinned toolchains and ephemeral PostgreSQL; run Prisma migration and multi-worker recovery tests and capture complete compiler diagnostics. Perform real Windows/SMB and S3 fault injection with generation fencing before changing deletion/migration feature gates.
