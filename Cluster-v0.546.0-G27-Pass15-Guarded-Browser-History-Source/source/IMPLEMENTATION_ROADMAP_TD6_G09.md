# Cluster TD6 G09 | Setup, Configuration Review, and Guidance

Parent: TD6 G08 complete source. Status: **source implementation complete for the scoped G09 workflows**, not all CD-01–CD-20 requirements.

## Grouped implementation

1. **Administrator setup readiness**: seven server-derived checks grouped as Security, Studio, Infrastructure and Workspace. Adds explicit studio timezone validation and step-by-step contextual guidance. Optional checks may be deferred; security checks may not. Setup status is admin-only and no-store.
2. **Per-Owner recovery posture**: security checks require each non-archived Owner to hold an active, non-revoked/non-compromised passkey and unused recovery code(s). A single well-secured Owner does not mask another Owner's missing recovery. No secret values or identities are exposed by the readiness projection.
3. **Selective safe configuration import**: importing a `.clusterconfig` file lets admins choose the specific safe fields to apply. Every selection change invalidates preview; both preview and apply are authenticated and compare against current server state. Excluded fields never enter the request.
4. **Reviewed restore from prior imports**: admin can load previously imported values or the typed *pre-import* values from the server's existing safe configuration revision log, choose specific fields, preview against current values, and apply as a new explicit revision. Previously absent/unsupported values cannot be silently restored.
5. **First-run guidance and races**: setup explains mandatory Owner passkey / offline recovery requirements and post-login checklist. Stale asynchronous `.clusterconfig` file reads cannot replace a newer selection or reappear after changing setup modes.

## Security and architecture rules

- No master password or recovery bypass introduced. Owner recovery material is never read into a checklist response.
- No new Settings authority: the existing Studio vs Server vs Tool configuration boundaries remain. Only five previously allowlisted non-secret Studio settings are supported by `.clusterconfig` v1.
- Import apply preserves the existing SERIALIZABLE transaction / DB advisory lock and stale-preview rejection. Other Studio Settings writers are not yet globally linearizable with this import transaction; **do not claim complete configuration convergence**.
- Setup backup checklist checks that the **policy is enabled**. It does not certify successful backup or restore.
- User-facing configuration reversal is reapplication of approved previous values, **not** database rollback, and does not delete previously absent keys.

## Evidence and deferred runtime

- `node tools/scripts/cluster-td6-g09-setup-guidance-tests.mjs` targeted checks (including exercised admin route handlers using controlled in-memory Prisma read models).
- Inherited first-run/setup and configuration-preview assertions, plus G02–G08 and F01/F02 regressions.
- `node tools/scripts/cluster-td4-r73-source-scan.mjs` syntax/CSS/import check.
- Full Node 24 dependency-backed compilation, live PostgreSQL setup, authenticated browser verification and Windows/Qt remain deferred at the user's instruction.

## Open work kept on the CD-01–CD-20 feature ledger

- Broader versioned `.clusterconfig` domains (Tool configuration, Project Types, permission bundles, templates), dependency-aware import plan, secrets-as-references, configuration inheritance and snapshots with full rollback.
- Multi-step guided OOBE for storage, email, Projects, role templates and widgets; passkey/recovery enrollment UX and real backup/restore verification.
- Global contextual Help Center, searchable Packets-backed documentation and first-use guides beyond the administered setup surface.
- TD6 G10: Library/video/derivatives/watermarks/transfers. G11: supervised OS installation and atomic multi-Package recovery. Follow-up CD owner batches remain.

**Standing priority: code-complete TD6 features first, TD7 cleanup second, full runtime certification last.**
