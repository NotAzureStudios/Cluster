# Cluster v0.506 | Configuration Publication and History

**Status:** source-validated development checkpoint, not a certified Windows executable.

## Completed in this increment

- Admin-only `GET /api/admin/setup/configuration/revisions` returns up to 20 recent *safe settings import* revisions, and no raw credentials or arbitrary AppSetting data.
- A new `StudioConfigurationRevision` model with PostgreSQL migration #91. Each committed import records its actor, requested allowlisted fields, specific before/after differences, and preview fingerprint.
- `POST /api/admin/setup/configuration/apply` now uses a Prisma Serializable transaction and a transaction-scoped advisory lock for competing import operations. It rereads only the five permitted keys **inside the transaction**, compares with the reviewed preview, writes only changed keys, and commits history with the settings. A stale or serialization-conflicting import returns HTTP 409 and requires a fresh preview. No-change applies do not create revisions.
- The Admin Setup Checklist shows recent imports and offers **Review values** on a prior import. Reapplication always requires the current server preview and explicit Apply. This is not an automatic or global restore facility.
- `npm run cluster:0506:revisions:assertions` adds 12 focused checks to the inherited source-foundation suite.

## Crucial scope limitations

1. The transaction protects **concurrent imports**. Other Studio/Tool settings writers still use broad `saveSettings` read/modify/write and do not participate in this advisory lock. Cross-surface lost updates are therefore **not fully eliminated**. Do not claim general multi-admin atomicity until those writers converge.
2. This is a selective revision ledger for five safe imported defaults, not a complete Studio/server configuration snapshot or one-click rollback.
3. Migration #91, Prisma client generation, and actual PostgreSQL Serializable behavior require a live official-toolchain integration run; no runtime certification has occurred here.
4. The staging source originates from P13 + P16C plus previous v0.506 work. The trusted newer P15 package could not be materialized. Preserve P14/P15 Library, Projects, Admin, and Project-Type changes during conflict-reviewed transplant. **Never replace P15 with this full staging tree.**

## Packaging and versioning

User-facing version **0.506**; Node/npm internal version **0.506.0**. Increment to **0.507** only after an authoritative integrated and verified checkpoint. No RC/WIP/pass suffixes on public names.

`Cluster-v0.506-Revisions.patch` is **incremental** against the immediately previous `Cluster-v0.506.zip` (the configuration-preview/apply checkpoint), not directly applicable to P15. Review and merge the changes in sequence.

## Runtime test plan

- Deploy migration #91 to fresh PostgreSQL and run official Prisma generation.
- Verify 2 authorized admins importing the same keys: stale preview → 409, no partial writes, no duplicate revision.
- Verify two imports of disjoint keys and unrelated Studio Settings edits; investigate broad-writer lost-update paths.
- Validate audit event revision IDs, admin access gating, new empty-history state, select-and-preview historical imports, secret field rejection, and rollback avoidance.
- Verify Linux and Windows startup/restart/reconnect plus DPI/input controls; certify the newer source lineage before calling it an installer.
