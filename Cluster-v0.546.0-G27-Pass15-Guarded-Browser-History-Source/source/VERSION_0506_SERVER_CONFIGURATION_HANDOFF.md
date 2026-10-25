# Cluster v0.506 | Server Configuration edit safety

**Status:** Source-implemented and source-tested on the recoverable reconstructed staging source; **not a Windows/PostgreSQL-certified release** and **not merged into the trusted Pass 15 archive**.

## Completed

- Server Configuration now sends **only edited fields** instead of writing back the entire loaded settings/metadata object.
- The editor holds the original raw API response separately from UI defaults. Each edit carries an original-value precondition that distinguishes missing from `null`, `false`, and empty strings.
- The server requires a valid Security PIN **for every PUT**, regardless of whether the client supplies one voluntarily. Requests missing an edit precondition are rejected (428); conflicting fields are rejected (409) against a freshly read, admin-safe projection. Unknown input keys are rejected by the strict route schema.
- When a conflict is detected, the editor displays **Refresh and review edits** instead of retrying the stale write. The refresh preserves only the user's edited fields over current server settings.
- Server configuration file publication now uses unique, exclusive temporary filenames, flushes the staged file before same-directory rename, and cleans up failed staging files. Directory fsync is best-effort because filesystem/platform support varies.
- No new server configuration schema or database migration; Node/npm internal version stays `0.506.0` and public version remains `0.506`.
- Added `cluster:0506:server-config` regression gate (13 assertions) to `verify:source-foundation`.

## Security and correctness boundaries

This slice **does not** implement an atomic distributed transaction spanning PostgreSQL and `cluster.config.json`, nor does it serialize all other full-object configuration writers. Two distinct server processes can still race after the precondition read. Other internal saveSettings call sites may still save stale snapshots. A safe database/file journal, crash recovery, lock ownership and all-writer convergence remain required before claiming concurrency certification.

Masked secrets are compared using the same admin-safe projection the client originally saw. Neither the patch nor the precondition check returns raw stored secrets to the browser. This is not proof of live WebAuthn, database, authorization, or Windows behavior.

## Required runtime certification

1. Fresh PostgreSQL migration/bootstrap and actual Server Config PUT with an administrator and Security PIN.
2. Two simultaneous administrators modifying distinct and identical server configuration fields; verify 409 and retained drafts.
3. Two independent server processes writing the same config path; ensure no lost update, torn file, or lock failure. Implement a real cross-store publication protocol before considering this certified.
4. Simulated crashes before/after disk rename and before/after database commit; verify unambiguous recovery and no secret exposure.
5. Windows NTFS persistence, ACL/permissions, restart/load with protected boot secrets, backup/restore, and failure reporting.
6. Conflict-reviewed transplant onto trusted Pass 15 and regression with its Admin/Project Type surfaces.

## Continued roadmap

After the authoritative merge, finish 0.506 runtime/security/OOBE/config certification. Then proceed to 0.507 Company/Resource Graph + shared permissions/runtime/search, 0.508 People/Forms/Packets/Inventory/Vault, 0.509 Work System, 0.510 Projects/Library/Planning/Admin, 0.511 Communications/Integrations/Packages, 0.512 release certification, then 1.0. Keep small wins, QoL, and cleanup attached to every major version.
