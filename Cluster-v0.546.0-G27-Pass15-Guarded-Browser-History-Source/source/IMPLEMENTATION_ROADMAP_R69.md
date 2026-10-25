# Cluster implementation roadmap | revision 69

**Source baseline:** v0.546.0 TD4 R69, derived from canonical R68. TD0–TD3 are source-closed, TD4 active. TD5–TD7 remain separate. `TECH_DEBT_MASTER_ROADMAP.md` remains the historical ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` governs runtime gates.

## R69 delivered

- Runtime startup validates the **type and identity** of each of seven mandatory durable event consumers, closing a silent-acknowledgement risk from an incorrectly registered subscriber.
- Production composition declares its three wildcard and four Activity-specific subscribers explicitly with typed obligations.
- Durable outbox resource placement now follows the canonical event resource address, not incidental Activity Project context. Context Project still persists independently.
- Source-owned finite event matrix and 11 new executable negative/positive checks.
- R60 lifecycle checks migrated to the canonical required consumer contract. R59 resource-ordering checks remain green.
- No new generic framework or migration. No provider/quarantine physical mutations reenabled.

## TD4 remaining implementation

1. **Provider and event ownership:** Close finite producer/consumer inventory; targeted handlers with durable backfill where genuinely needed, including assignment-event subscriber policy. Verify tool enable/disable, drain/re-enable, notification/automation revocation.
2. **Search and Action adapters:** Implement remaining mandatory workspace bindings and authorize/recheck hydration/deep-link destinations, including missing object and revoked access.
3. **Storage disposition:** Provider-specific generation-fenced writes/quarantine and backed-up restore evidence with real provider acceptance before enabling any destructive operation. Audit all other deletion owners.
4. **TD4 closure review:** Negative authorization and lifecycle matrix, no alternate framework, acceptance evidence, and source freeze handoff.

## Release certification exclusions

Node 24 dependency-backed compile, PostgreSQL concurrent worker integration, authenticated multi-user end-to-end Search/Actions, Windows/Qt activation, and real NAS/SMB/S3 failure recovery remain unverified. R69 source regression tests do not certify them.
