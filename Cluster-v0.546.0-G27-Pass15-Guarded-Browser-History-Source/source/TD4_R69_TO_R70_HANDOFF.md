# Cluster TD4 R69 → R70 continuation

Canonical baseline: `Cluster-v0.546.0-TD4-R69-Typed-Consumer-Ownership-Source.zip` with `source/`. R68 was the patch baseline; R57–R68 remain preserved. No schema/native binary changes.

## Confirmed R69 implementation

- `apps/server/src/core/domain-events.ts`: typed `{ key, type }` mandatory subscriber obligations at startup; wrong family/missing/duplicate fail closed. Canonical resourceProjectId no longer borrows contextual Project ID.
- `apps/server/src/app/cluster-server.ts`: seven exact required subscriptions (3 `*`, 4 `activity.recorded`).
- `tools/scripts/cluster-td4-r60-consumer-lifecycle-tests.mjs`: inherited tests updated to new contract, no removal of protection.
- `tools/scripts/cluster-td4-r69-consumer-contract-tests.mjs`: 11 new runtime/source contract checks.
- `TD4_R69_EVENT_CONTRACT_AND_OWNER_AUDIT.md`: current finite matrix and limits.

## R70 priorities

1. Audit and fix real remaining Search/Action resource adapters with negative authorization, missing/changed resource, Project scoping and navigation hydration. Prefer a connected workflow across API and renderer over more registries.
2. If adding a dedicated `work.assignment.changed` consumer, implement replay/backfill semantics for **already acknowledged events**, plus idempotency and tool toggle admission. Do not add a no-op subscriber to make a spreadsheet look complete.
3. Verify event-owner re-enable/shutdown against real concurrent PostgreSQL worker process, and use actual Node 24 dependencies.
4. Keep managed blob GC and tier migrations observational and physical quarantine/deletion disabled until live provider generation, backup and restore fencing is certified.

Testing detail: 51 selected suites pass in Node 22 with experimental type stripping and temporary global TypeScript symlink (removed from archive). Not a certified build. See `TD4_R69_TEST_RESULTS.json` and source scan.
