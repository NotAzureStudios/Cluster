# Cluster G26 consolidated batch → G27/runtime acceptance handoff

## Source baseline
- Use the `Cluster-v0.546.0-TD6-G26-OneBatch-Reviewed-Vault-Retention-Evidence-Source.zip` artifact, not the older Batch H ZIP.
- Batch A–H source implementation, Packet reporting, Package/Inventory entitlements, Library governance, Vault notifications, offboarding, native staging and read-only MSI diagnostics are preserved.
- The new reviewed Vault flow is explicit: request without plaintext → another authorized administrator approves/rejects → original requester provides replacement plaintext at commit. Single-actor direct rotate is disabled.
- Inherited Library holds/deadlines now count in disposition and hierarchy trash evidence. Opaque S3 version IDs do not authorize deletion.

## Strict next-runtime acceptance order
1. Provision disposable Node 24.20.x, project dependency lock, generated Prisma client and PostgreSQL 18 test database; run full TypeScript build and the complete regression suite. Apply/validate all migrations including 20261101, 20261102 and the new 20261103 Vault review schema.
2. Two active admins plus one standard account: demonstrate self-approval denial, stale revision rejection, expired review denial, commit idempotency, Vault secret isolation, denial after role downgrade and concurrent approval/commit conflicts using live transactions.
3. Retention: nested holds/deadlines, folder move/reparent, cross-Project errors, concurrent parent policy changes, disposition preview invalidation, hierarchy trash race with parent hold.
4. Windows: signed test MSI opt-in installation in isolated user profile, concurrent managed destination protections, crash during MSI, exit 3010 and restart, Windows Installer registration, operator observation vs independently verified app health. **No auto retry/uninstall without a new separately reviewed recovery protocol.**
5. Storage: real S3/NAS versioning, backups, conditional-write/delete, quarantine/restore, crash/restart and ownership/snapshot controls in a nonproduction storage namespace. Do not enable physical disposal until complete evidence exists.
6. Re-run browser/Qt UI acceptance, source manifest integrity, request-count and process-tree shutdown checks.

## Untouched runtime restrictions
- No physical deletion/quarantine or unfenced storage migration.
- No automatic MSI recovery, repair or uninstall.
- No automatic third-party credential revocation or assertion of provider-side completion.
- No claim of release certification from source-only static and mocked tests.
