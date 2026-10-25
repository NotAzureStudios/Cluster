# TD1 Pass 4 — Canonical Tool Config field definitions (2026-10-11)

## Baseline

Continues `Cluster-v0.546.0-TD1-Pass3-Setting-Provenance-Source.zip` with all existing TD0/TD1/TD2 runtime and configuration work intact. Product remains `0.546.0`, no native binary/source migrations required.

## Completed source work

- `packages/shared/src/tool-settings-contract.ts`: added typed, dependency-free `CLUSTER_TOOL_CONFIG_FIELDS` for 87 Tool Config controls across Timeline, Tickets, Calendar, Scheduler, Library and Packets. Each field's kind and allowed enum values, numeric bounds/integrality, list limits or text limits/HH:mm format are represented once.
- **Same default/effective value resolver:** `clusterResolveToolConfig` now projects all six Tool Config snapshots from the previously existing server defaults. The server and renderer fallback call it instead of maintaining two copies. Legacy `uploadLimitMb` remains a read fallback for Library but is not a newly writable key.
- `apps/server/src/domains/admin/admin-tool-routes.ts`: builds Zod schemas once per server route registration from shared definitions; the server still parses full configuration before writing the edited and CAS-protected subset. Unknown setting keys cannot join patch identity, Studio-wide changes still need explicit acknowledgement, and the existing conflict response remains unchanged.
- `packages/renderer/src/features/admin/AdminToolControls.tsx`: all 21 numeric Tool Config inputs use `clusterToolNumericRange`; UI no longer has duplicate min/max numbers. Curated control labels and enum display text remain UI-owned.
- `tools/scripts/cluster-td1-tool-config-definitions-tests.mjs`: tests type/storage/projection parity, valid defaults, range and enum properties, projection edge cases and server/renderer enrollment (11 checks).
- Updated one earlier source-oriented assertion (`cluster-td1-settings-authority-tests.mjs`) to confirm the shared enum descriptor instead of requiring a now-removed inline Zod declaration. The effective validation check was preserved.

## Architectural boundaries

This is a **Tool Configuration field-definition consolidation**, not yet a general SettingDefinition registry for Server/Studio/User/Device preferences. It does not add inherited Project/User storage, a Reset to inherited action, or push-based propagation. The `resolved` provenance label still means database row absent/fallback, not multi-scope inheritance.

For the six editors, schema types and value constraints now live in one shared registry. Their *storage keys*, *ownership*, and *sources* were already canonicalized in earlier TD1 passes. This pass removes the separate hard-coded server validation definition and client numeric constraints plus frontend/server defaults.

## Validation limitations

Source checks and runtime tests that transpile shared TypeScript run with the available Node 22 environment. The complete Node 24 dependency tree, native binaries, Prisma generated client, live PostgreSQL and Windows/Qt/browser certification are not available in this source package. This work remains **source-implemented, targeted tested, not production-certified**.
