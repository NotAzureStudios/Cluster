# TD1 Pass 3 — Tool Config setting provenance (2026-10-11)

## Baseline and intent

Continue the source from `Cluster-v0.546.0-TD2-Pass6-Upload-Retention-Source.zip`. Product version remains `0.546.0`. This is **completion of a TD1 slice**, not a new framework or a claim that TD1/TD2 are complete.

## Verified gap

`/api/admin/tools` already reads each tool's AppSetting preconditions from database truth, and the Tool Config editor already uses those baselines for compare-and-swap updates. Neither the API nor the UI revealed whether an effective configuration field was explicitly persisted or supplied by the normal settings resolver, or which fields belong to Studio-wide authority. That made a valid but confusing editing experience and hid the origin of unsaved defaults.

## Implemented

- `packages/shared/src/tool-settings-contract.ts`: expose `ClusterToolSettingProvenance` and `clusterToolSettingProvenance`, derived from the existing six-tool canonical persisted-key and Studio ownership maps. Each field includes UI field identity, persisted key, owner scope, descriptive ownership label, and either `stored` or `resolved`. No values or credentials are added to the metadata. Missing preconditions fail closed; JSON `null` is a stored row, not absence.
- `apps/server/src/domains/admin/admin-tool-routes.ts`: return provenance alongside the same database-truth `expectedSettings` in GET and PUT snapshots. On degraded snapshot failure, return `null` rather than inventing provenance.
- `packages/renderer/src/features/admin/AdminToolControls.tsx`: show a collapsed setting-source inspector listing Studio/Tool ownership, actual storage keys, and stored vs resolved origin. Refresh after ordinary save and availability-toggle operations. Explicitly state that project/user inheritance is **not** implemented by this view.
- `tools/scripts/cluster-td1-setting-provenance-tests.mjs`: six executable focused checks on canonical field coverage, null/missing differentiation, ownership, fail-closed incomplete baselines, and server/client integration.
- `tools/scripts/cluster-td-source-static-audit.mjs`: repeatable TS/TSX syntax and relative-import presence scanner. Generated Prisma client is the known absent artifact in this lean source.

## Boundaries

`stored` means **a database row exists**, not that its exact raw value is displayed without normalization. `resolved` means the normal server settings resolver supplied a fallback because no explicit AppSetting row was present. This does **not** establish project/user/device inheritance, override precedence, or effective-value propagation. Configuration writes continue using the existing safe CAS path with Studio impact acknowledgment.

## Still open

- Canonical typed Settings definitions and consistent validation across all server/renderer writers.
- Scoped inheritance, effective-value precedence, override reset and comprehensive ownership inventory.
- Cross-process setting publication and snapshot consistency under real PostgreSQL concurrency.
- TD2 tool-owned listeners/workers, strict cross-process availability fencing, indefinite-held upload alerts, and real idle measurements.
- Full Node 24 dependency-backed TypeScript build, PostgreSQL, Windows/Qt, browser tests.
