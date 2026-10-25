# Cluster 0.546.0 — TD1 Pass 1: Settings Authority and Writer Convergence

**Starting point:** 0.546.0 TD0 Pass 1 (unchanged product version).  
**Deliverable:** Source checkpoint only; no native binaries, database migrations, or live Windows/PostgreSQL certification.

## Connected work completed

1. Added a **canonical six-tool Tool Configuration key contract** in `packages/shared/src/tool-settings-contract.ts`. Both Tool Config server persistence and renderer update projection now use it. Removed a duplicate, unused renderer mapping in `application-admin-workspaces.tsx`.
2. Reused the existing database transaction and optimistic field-level `patchSettings` machinery, rather than creating a second writer. Added `readSettingPreconditions` to return **actual persisted existence and values** (not defaults from `readSettings`).
3. Tool Configuration snapshots now include database-truth preconditions; the effective displayed config is reconciled with them so a newer database value isn't paired with an older cached UI value. If preconditions cannot be loaded, the tool is not available for safe saving.
4. Tool Configuration PUT now requires `{config, expectedSettings}`. It validates the complete config but writes only fields identified by preconditions. A stale same-field edit receives **HTTP 409 / TOOL_CONFIG_CONFLICT**, with the conflicting keys. Unrelated edits are preserved. An unsafe old/unversioned write is rejected.
5. The Tool Config UI sends preconditions for **only changed controls**, preserves unsaved draft edits after errors, and does not erase unrelated unsaved controls when toggling a tool's enablement.
6. Closed a real Library Tool Configuration schema omission: `sensitiveOfflineCachePolicy` is now validated on the server rather than silently stripped.
7. The People profile field writer now requires field-level optimistic preconditions and responds with **HTTP 409 / PROFILE_FIELDS_CONFLICT**. Added a permission-gated, no-store GET endpoint returning editable profile definitions and database-truth preconditions.
8. Added `npm run techdebt:td1:check` exercising shared maps, writer contracts, data truth vs absence/null, and the existing transaction lock's stale-update behavior.

## Authority boundaries still outstanding

- Tool Configuration **still deliberately maps** selected Timeline/Library/Scheduler controls onto Studio-wide settings; the follow-on work must label these as *linked Studio defaults* or create independently scoped overrides with explicit inheritance. This pass makes the writes safe, not independently scoped.
- The typed *field identity map* is consolidated, but tool-specific validation schemas and form presentation are not fully schema-generated. Consolidate only after defining per-setting provenance, ownership, permitted scope and change impact.
- Other writers must be inventoried, with the correct distinction between initial provisioning, user preferences, protected server-config publication, and shared Studio updates.
- Real PostgreSQL multi-admin request tests, database/file publication fault injection on NTFS, browser UI tests, and dependency-backed build remain required.
- Disabled-tool worker lifecycle remains TD2, not part of this pass.

## Verification commands

Run from the `source/` directory:

```bash
npm run techdebt:td1:check
npm run techdebt:td0:check
node tools/scripts/cluster-0506-settings-conflicts-assertions.mjs
node tools/scripts/cluster-0506-config-writers-assertions.mjs
```

The new TD1 suite and the listed inherited source tests passed in the development environment. TypeScript parser checks passed for 991 application/shared TS/TSX files and all resolved relative imports, excluding generated Prisma artifacts that are not bundled. A complete `tsc`/bundler build cannot be certified from this lean archive because dependencies and generated Prisma client are absent.
