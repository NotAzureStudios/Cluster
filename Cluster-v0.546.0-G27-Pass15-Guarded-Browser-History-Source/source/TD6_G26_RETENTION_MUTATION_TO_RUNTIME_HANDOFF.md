# G26 Retention Mutation Authority → Next Runtime Handoff

## Canonical source
Use the `Cluster-v0.546.0-TD6-G26-Retention-Mutation-Authority-Closeout-Source.zip` checkpoint, **not** the earlier G26 OneBatch ZIP.

## Preserved baseline
Packet source-only distribution, compliant recipient reporting, Package/Inventory seat decisions, reviewed standalone Vault replacement, offboarding key settlement, credential reminders, native Package file safety, read-only MSI operator evidence, Library disposition hierarchy and inherited protection, and read-only storage generation evidence remain present.

## Confirmed implementation changes
- Direct Library metadata PATCH cannot set `legalHold`, `retentionUntil`, `retentionPolicyKey`, changed `parentId`, changed `projectId`, or perform a Trash/restore transition. The dedicated retention, reviewed move and lifecycle APIs remain authoritative.
- Interactive and durable hierarchy moves now reject source retention/hold weakening in a Serializable write snapshot. Move fingerprints pin origin ancestor lineage and both destination and source hold/deadline state.
- Bulk Trash checks root ancestry and descendant-local protection. Single-item Trash is a protected Serializable transaction that refuses active holds, retained dates, personnel attachments, children, active edit locks and hierarchy marks.
- Library inspector no longer offers a misleading mutable parent/Project dropdown. Library toolbar Move provides the reviewed hierarchy path. Cross-Project transfer remains unavailable pending explicit authorizing workflow.

## Next execution priorities
1. Provision Node 24.20.x and full dependencies. Compile renderer/server, generate the Prisma client and apply migrations to a disposable PostgreSQL 18 instance, especially the reviewed Vault rotation migration.
2. Live retention race tests: alter parent hold or move between preview and final commit, concurrently reparent/Trash, revoke rights, and probe the single-item DELETE/metadata endpoints under two accounts. Verify transaction isolation in actual PostgreSQL, not mocks.
3. Full Windows MSI user-consent install and after-reboot observation, process kill, elevation error, Windows Installer registration mismatch, rollback and cancellation tests. Do not enable automatic MSI repair or recovery until designed and independently reviewed.
4. Test NAS/S3 conditional generation fencing, backup recoverability and no-unlink policy on disposable storage; require independent authority before any physical disposition.
5. External credential integrations must confirm provider-side revocation/rotation instead of relying on human assertions. Re-run Qt/browser/multi-user privacy and operational request-budget suites.

**Do not treat source tests as production certification.**
