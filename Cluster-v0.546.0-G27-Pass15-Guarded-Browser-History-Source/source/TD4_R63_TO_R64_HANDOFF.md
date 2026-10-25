# Cluster TD4 R63 → R64 handoff

## Canonical source

`Cluster-v0.546.0-TD4-R63-Governed-Library-Disposition-Source.zip`, folder `source/`. Source version remains **0.546.0**. TD0–TD3 source-closed; TD4 still active.

## Preserve these R63 contracts

- `library-disposition.ts`: 30-day minimum restore window, exact revision/title, reason and request UUID; dynamic hold/retention/reference checks and never an unlink permit.
- `LibraryDispositionRequest`/`LibraryDispositionEvidence` models and migration; one pending request per item, cancelled history retained, immutable evidence trigger.
- `library-routes.ts`: authenticated manage-only request/cancel/read; Serializable co-commit, compare-and-swap retention edits, reason/admin gate for weakening hold/retention, restore atomic cancellation. Old immediate `DELETE /permanent` route removed and helper rejects calls.
- `LibraryGovernancePanel`: reason/title confirmation, pending review visibility, cancellation. No claimed byte reclamation.
- Existing R61/R62 move and hierarchy lifecycle logic, R59 ordering and R60 event subscriber ownership must continue to pass.

## R64 priorities

1. Build a *read-only ownership scanner* for all Library storage providers, versions, derivatives, Packet releases, hardlinks/dedupe references and backup retention, with strong path normalization, bounded pagination and no truncated success results.
2. Implement a fenced, idempotent **quarantine protocol** before any physical removal. Approval must reauthorize the actor and verify current holds, retention, references, revision, storage provider generation, and immutable manifest. Quarantined bytes require recoverable provenance and a restore path. Do not turn orphan audit findings into automatic deletes.
3. Separate two-person approval and actual retirement; keep irreversible unlink disabled until fresh PostgreSQL concurrency and real NAS/filesystem crash/restore tests pass.
4. Finish older lifecycle exceptions and provider/search/action matrix; preserve all existing features rather than replacing the system with a parallel disposal framework.

## Testing requirements

Run `npm run techdebt:td4:r63:verify` with an installed TypeScript/postcss development toolchain or the explicitly documented global-toolchain fallback. New executable checks: `cluster-td4-r63-disposition-tests.mjs`, `cluster-td4-r63-route-integration-tests.mjs`. Source scan: `TD4_R63_SOURCE_SCAN.json`; regression selection: `TD4_R63_REGRESSION_RESULTS.json`. No runtime certification may be inferred from these.
