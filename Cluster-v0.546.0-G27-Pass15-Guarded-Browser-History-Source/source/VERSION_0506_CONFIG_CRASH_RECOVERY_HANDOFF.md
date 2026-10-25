# Cluster v0.506 | Server configuration crash-recovery journal

**Status:** Implemented in recoverable development source and tested with real temporary-filesystem fault scenarios plus mocked database publication contention. **Not** certified under live PostgreSQL, actual process termination, Windows/NTFS, or integrated into the authoritative Pass 15 source. No claim of end-to-end crash atomicity across the whole application.

## Implementation

- `apps/server/src/core/server-config-publication-journal.ts` provides an owner-only, SHA-256 checked, versioned **before/after** journal (`cluster.config.json.publication-journal.json`), durable atomic replacement and fail-closed reconciliation.
- `saveSettings` now serializes with existing advisory locks `(506,1)` and `(506,2)`, recovers any outstanding journal, writes database changes in the transaction, writes and syncs the journal, replaces the config file, and writes an `_internal.serverConfigPublicationId` commit marker **inside that same database transaction**.
- On rollback/uncertain transaction outcome, it reacquires both locks and reconciles the file against the **committed** database marker. If a process is terminated after file rename and before commit, the following startup rolls the file back. If the database committed but cleanup was interrupted, recovery retains the committed file.
- Journal cleanup also happens under locks. It cannot accidentally delete another process's newer journal.
- Startup performs reconciliation **after PostgreSQL schema validation but before mirror synchronization, demo data or application listen**. When reconciliation changes the boot config read earlier at module initialization, startup refuses to listen and requires a fresh restart to reload the recovered runtime values.
- Journal corruption, unexpected external edits and conflicts between journal/file hashes **stop automatic repair** instead of overwriting unknown bytes. Configuration files and journals are written with restrictive mode and unique temporary paths. Directory syncing is best-effort on Windows.
- Ordinary five-second settings-cache reads avoid new per-request disk operations. Refresh/forced reads reconcile pending journals.
- The current AppSetting schema accommodates the internal marker without a migration.

## Verified here

- 13/13 *real local filesystem* journal/fault-scenario assertions, including pre/post-commit, rollback, originally missing files, tampered config, corrupt journal, conflicting journal, size limit, permissions, startup ordering, and idempotence.
- 7/7 retained mocked cross-process publication assertions.
- Entire inherited `npm run verify:source-foundation` passes after updating its old file-writer fixtures to the new shared helper.
- Parser/import/CSS static integrity checked separately. Source hashes and packaged archive are verified with their own manifest.

## Boundaries and remaining roadmap

1. This protocol covers callers of the **canonical `saveSettings` service**. Earlier direct `writeConfigFileSettings` calls during secret rotation and offline host/setup/storage writers are *not* automatically made journal-safe by this change. Audit and converge each before declaring global publication authority.
2. Setup, Security Policy, integrations, context packs and key rewrap still have whole-object callers; although serialized through this service where used, some can originate from stale snapshots. Move them to explicit changed-field patches.
3. Runtime config is initially parsed **before** database reconciliation. Startup fails closed and demands a second boot if journal recovery changed the file, rather than continuing with stale authentication/network settings. Real Windows managed-host restart behavior remains to be verified.
4. Live PostgreSQL multiprocess contention, SIGKILL between journal/rename/commit, filesystem failure injection, symlinks/path security, backup/restore and Windows NTFS directory durability require certification.
5. Trusted Pass 14/15 Master Source is not materialized in this session; this is a **staged 0.506 candidate**, not a source replacement. Conflict-review the transplant to preserve later Admin/Project Types work.
6. The broader roadmap remains Company/Resource Graph and shared engines (0.507), People/Packets/Inventory/Vault (0.508), Work System (0.509), planning/Projects/Library/Admin (0.510), Communications/Packages (0.511), and runtime certification/hardening (0.512).

Next connected work: converge remaining whole-object and offline settings writers; verify journal protocol on real PostgreSQL and Windows; merge with Pass 15 before graduation to 0.507.
