# Cluster v0.537 → v0.538 full handoff

**Authoritative baseline:** `Cluster-v0.538.zip`, derived directly from `Cluster-v0.537.zip`. This remains development source. Both signed-package file updater and Prisma schema unchanged; no active instances require legacy API support.

## Exact changes

1. `studioOffboardingEquipmentSchema`, `studioOffboardingExecuteSchema`, `studioOffboardingCancelSchema` require an integer `expectedRevision`.
2. Offboarding GET/list responses already included `revision`; now the UI binds that number to all consequential case writes. API rejects stale admin views before making changes and retains database-level revision CAS inside transactions.
3. Offboarding Admin shows a reason-required cancellation flow; sends revision and reason to existing cancellation route. Stale or uncertain writes offer refresh, not replay.
4. Offboarding creation serializes on `User` row (`FOR UPDATE`) and rechecks existing planned/active cases **inside** the transaction before creating a Personnel Record; prevents duplicate cases and orphan record races.
5. Onboarding publication is moved into `studio-onboarding-publication.ts` and a single PostgreSQL transaction with per-plan row lock. Initial audience assignment, version creation, optional old-assignment supersession and plan activation all commit or roll back together. `studio-onboarding-runtime.ts` assignment helper is reused.
6. Server version input rejects duplicate `(kind, resourceId)` steps; UI offers move up/down, preserves order and rejects duplicates.
7. Onboarding request Retry does not replay an ambiguous create/publish/lifecycle mutation; it performs read-only reconciliation. Explicit Progress remains safely retryable.

## Evidence

`tools/scripts/cluster-0538-people-lifecycle-closeout-tests.mjs` checks revision behavior and server/UI contract. `cluster-0538-onboarding-publication-runtime-tests.mjs` executes the actual TypeScript transaction helper against a rollback-capable mocked database; verifies successful publishing, draft-only behavior, non-superseding publishing, and rollback on assignment/supersession/plan activation errors. Inherited source regression suites also run. These are not real PostgreSQL contention tests.

## Remaining scope

- Actual PostgreSQL contention/runtime testing and UI/browser certification; deferred by user.
- Onboarding/Offboarding evidence attachment selection, lifecycle/admin access edge cases, and other People feature ledger requirements.
- Remaining Library, Work cross-tool Undo/Redo, Desktop optional unattended-update policies, full app UX and Admin feature closeout.

**Next feature target:** finish the remaining visible Library/People/Admin workflows with measurable user journeys. Avoid another architectural rewrite or OS installer work.
