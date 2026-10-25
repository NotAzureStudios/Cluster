# Cluster v0.546.0 · TD6 G01 — Grouped Inventory / People / Licensing implementation

**Source baseline:** TD6 F11 Package Recipient Entitlements. **Current checkpoint:** TD6 G01 (the F12 successor). **Priority:** implementation-first, with focused source regressions and full runtime/release certification deferred.

## Execution policy: substantial grouped batches, not one fix per pass

The user explicitly requested maximum effort on grouped unfinished work. Subsequent work must bundle **connected end-to-end workflows** rather than serial micro-passes. A batch is defined by the relevant user journey and its DB authority, API enforcement, admin/recipient UI, cross-tool lifecycle, regression checks and handoff. Do not stop at every decimal checkpoint or create a separate package for each minor control. Continue across related domains where that creates a complete user journey. Preserve the entire CD-01–CD-20 obligations ledger and small-wins ledger. No unfounded `100% done` claims.

## G01 implemented together

| Connected journey | Source implementation | Limit / follow-up |
|---|---|---|
| Digital license/seat assignment | Optional 180-day bounded lease (`StudioInventoryAllocation.expiresAt`), constrained by the person's own account expiration. Active expired leases no longer consume availability; expired allocations close durably inside a locked asset transaction before reissue. | No independent reviewer for seat allocation yet; add request/review if required by studio policy. No worker-delivered expiry notifications. |
| Digital seat renewal | Reasoned, confirmation-protected, revision-guarded `POST /api/admin/inventory/allocations/:id/renew`; refuses shortening, stale revision, expired allocation, non-digital kind or expired identity. | No automatic reinstatement after expiry. |
| Inventory life-cycle visibility | `/api/admin/inventory/attention` on-demand 7-day expiry/open custody summary, admin lease fields, extended admin UI and recipient effective-status projection. No periodic polling. | Full historical reporting, paginated alert drilldown and notification delivery remain. |
| Game and license keys | Optional bounded assignment expiry; expired keys cannot be revealed via admin or PIN-verified recipient routes. First disclosure tracked as non-secret `firstRevealedAt`; assigned/redeemed/disclosed keys are **never automatically released to the available pool**. Admin and recipient panels show expiry. | Key pool reuse/release policy requires proof the secret has never been disclosed, provider revocation and independent approval. No automatic key recycling. |
| People / offboarding | Offboarding revokes **digital** Inventory allocations in the same identity transaction while retaining **physical** custody allocations as outstanding until an actual Inventory return, transfer or write-off. Separate outstanding count appears in the case outcome and People UI. | Offboarding evidence `equipmentStatus=returned/waived` does **not** itself close physical Inventory custody. Administrator must reconcile each allocation. |
| Data schema | PostgreSQL migration `20261019001500_td6_grouped_inventory_custody_leases`; `expiresAt`/`revision` added to allocations; `expiresAt`/`firstRevealedAt` to commercial keys; count/filter indexes. | Live migration on PostgreSQL, Node24 dependency build and Windows/Qt not executed. |

## Source evidence

- `npm run techdebt:td6:inventory-lifecycle`: focused route-harness and source/integration checks.
- Inherited Inventory and Key Pool suites retain all non-expiring flows, Vault-separation and equipment dispositions.
- F01–F11 scripted regressions and static TypeScript/CSS/import scans remain the focused gate.
- No unsupported claims of native certification, live PostgreSQL behavior or exactly-once notices.

## Larger next implementation groups (planned, not complete)

1. **G02 — Inventory + Access + Onboarding closeout:** approved seat/key issuance, reasoned reclaim and renewal requests, Inventory/Package/Project entitlement summaries, account-expiry notices and offboarding physical return reconciliation. This is the rest of the current combined user journey, not another isolated seat control.
2. **G03 — Library + Packets + Distribution:** robust multi-item metadata/move/retention, reference and revision UX, authorized derivative pipelines for remaining safe formats, published distribution evidence and watermark policies. Preserve safe source-vs-delivery boundaries and keep unsafe destruction disabled.
3. **G04 — Projects + Boards + Whiteboards + Work:** complete collaboration-safe shared editing history, Card/checklist/movement operations, project relationship/dependency graph, Builds and QA handoffs in connected workflows.
4. **G05 — Packages + Desktop + Deployment:** dependency planning, supervised native installation lifecycle, progress/cancel/restart/recovery and rollback, installation-state evidence, trust and entitlement gates. Never claim an unexecuted OS installer is safe.
5. **G06 — Admin + Calendar + People + Communications + Settings:** complete OOBE/config bundle and configuration snapshots, access-explain/recipient preview, scheduling, notification delivery preferences and actionable Operations center.
6. **G07 — Cross-tool UX + Closure:** common create/action/search/inspector/picker contracts, accessibility and focused certification of implementation, ledger disposition, then TD7 source cleanup. **After** feature code completion, full platform/runtime release certification.

These groups are scoped by workflows, **not** promised pass counts. Reconcile every CD-01–CD-20 row and the small-wins ledger against actual code before calling Cluster 1.0 source-complete. TD0–TD4 remain source-closed; TD5/TD7/release gates remain separate.
