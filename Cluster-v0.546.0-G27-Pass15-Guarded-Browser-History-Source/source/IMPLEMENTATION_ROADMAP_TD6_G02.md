# Cluster v0.546.0 · TD6 G02 — Grouped reviewed Inventory issuance and People access reconciliation

**Baseline:** TD6 G01 full source, not F11. **New canonical source checkpoint:** TD6 G02. **Priority:** grouped implementation of unfinished workflows, focused source regressions, runtime certification deferred.

## Delivered together

| Workflow | Code authority / UI | Safety guarantees |
|---|---|---|
| Digital seat issuance | `StudioInventoryAccessRequest` → reviewed asset-lock transaction; Inventory request form and Access reviews tab | Independent administrator, 180-day bounded lease, recipient profile revision, capacity and duplicate-seat recheck at approval. Request never reserves/creates a seat. |
| Digital seat renewal | Same review queue, CAS on allocation revision; original direct renewal handler denies | Bounded increased deadline, no resurrecting expired allocations, no account-expiry override, quantity unchanged. |
| Commercial key issuance | Same review queue and key-pool row lock, G01 encrypted Vault source unaffected | Explicit reviewed recipient, one key, finite expiry, key must still be available at decision; never exposes ciphertext/secret; no recycling disclosed keys. |
| Direct-mutation closure | Direct seat issuance/renewal, key assignment and digital allocation transfer fail closed | Physical equipment issuance/transfer/disposition remain separate, legitimate custody actions. Digital revocation is still allowed for urgent containment. |
| Review decisions and alerts | Inbox reviewer action items, reviewed decision notices, durable row status and rationale | Self-approval prohibited (requester and subject), active reviewer roster at review, rollback of issued entitlement and request decision if transaction fails; pending duplicate SQL indexes. |
| People access reconciliation | `GET /api/admin/inventory/person-access/:id` + on-demand admin inspector | Read-only and bounded; combines Inventory allocations, assigned keys, active Package entitlements, direct Project allow rules and offboarding cases without merging authorities. Effective vs stored state explained. No secret or Vault payload. |
| Physical offboarding custody | `GET /api/admin/inventory/custody-outstanding` + admin inspection view | Only unresolved completed offboarding cases; physical assignments remain active until a real Inventory disposition/transfer; bounded 500-person / 100-item query, incomplete results explicitly flagged. |
| Schema | Prisma model and `20261019014500_td6_g02_inventory_reviewed_issuance` | Three User FKs, pending-request uniqueness, indexes; historical migrations unchanged. |

## Implementation invariants

- A **request is not an entitlement**. Only a reviewed transaction writes an Allocation or assigned commercial Key.
- Inventory asset capacity and key availability remain the canonical inventory authority. Package grants and Project Access Rules remain independent.
- Rejected/stale/duplicate approvals never issue stock. Two separate admins are required. No one-click bypass for digital issuance.
- Physical custody must never be auto-released on account expiry or completed offboarding.
- Commercial secrets remain in Vault. No key values, ciphertext or fingerprint in requests, reviewer lists, reconciliation projections, or notifications.
- The Person reconciliation screen is not an Access Explorer or a calculation of inherited Project permissions; direct rules are clearly labeled.

## Development evidence (source-level only)

- New `npm run techdebt:td6:inventory-approvals` runs executable request/review harness and source integration checks, including capacity changes, stale recipient profile, key assignment, duplicate decisions, no-reviewer failures and notification-transaction rollback.
- G01 inventory/physical custody and historical inventory/key-pool/Vault route suites adapted to require reviewed digital issuance, not to preserve the old bypass.
- F01–F11 selected feature scripts remain included in regression sweeps. Tests are not live PostgreSQL or Windows/Qt certification.
- `SOURCE_FILE_MANIFEST.sha256` and full-source archive plus reproducible patch are verified in this checkpoint's integrity report.

## Still open before 1.0

1. **Inventory lifecycle:** durable scheduled expiry and seven-day notices, supervised/explicit reclaim for non-reusable keys, physical serial/condition and evidence integration, paginated custody reporting beyond current caps, bulk approved issuance and cancellation of pending requests.
2. **People/Admin:** full onboarding provisioning checklist, delegated approvals, review escalation/fallback for one-admin studios without universal bypass, unified Access Explorer recipient preview and offboarding closeout UI convergence.
3. **CD-08 Packages:** supervised OS installation and rollback, managed dependency graph, independently attested device state.
4. **Remaining TD6:** G03 Library + Packet distribution, G04 Projects/Boards/Whiteboards/Builds/QA, G05 Desktop/Packages, G06 Calendar/Communications/Admin, G07 small-wins and CD-01–CD-20 ledger reconciliation.
5. **TD5/TD7 and certification:** full dependency-backed Node24 build/Prisma migrations/live PostgreSQL/multi-user browser/native Windows tests are intentionally deferred until unfinished feature code is complete.

**Not closed:** CD-04 (end-to-end People/Inventory lifecycle), CD-08 (native installation), all remaining CD-01–CD-20 obligations. Avoid inventing completion percentages or more micro-passes.
