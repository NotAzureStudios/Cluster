# Cluster v0.536 → v0.537 handoff

**Authoritative source:** `Cluster-v0.537.zip` derived from complete `Cluster-v0.536.zip`. The Windows Go utility and Prisma schema are unchanged. Application API bodies intentionally require `expectedUpdatedAt`; no legacy callers were preserved because there are no active production instances.

## Working source contracts

1. Admin applications list exposes `updatedAt` for each submitted application. Review sends `{status, note, expectedUpdatedAt}`.
2. Server checks application-purpose authorization, conditionally claims the reviewed timestamp through `updateMany`, and returns a conflict if another admin changed or converted it. It then fetches the saved result.
3. Conversion requires `{username, selectedFieldIds, onboardingVersionId, expectedUpdatedAt}` and conditionally claims an approved submission revision *inside the same transaction as account creation and onboarding assignment*. Mapped fields are opt-in, and all original permission and member-only checks remain.
4. The UI preserves failed notes, prevents double submit synchronously, confirms the account operation, and separates temporary credentials from status messages. Converted submissions are read-only.
5. Application and Admin approval refresh failures retain existing data instead of showing an empty queue. Approval decisions immediately reconcile the local row after server success.
6. Offboarding mutations cannot be blindly retried after ambiguous network errors; reconciliation is the retry action. All consequential case mutations use a revision CAS in the database transaction, before modifying other records.

## Key files

- `packages/shared/src/studio-systems-contracts.ts`
- `apps/server/src/domains/studio-systems/studio-application-revisions.ts`, `studio-workflow-routes.ts`, `studio-offboarding-routes.ts`
- `packages/renderer/src/features/settings/StudioApplicationsPanel.tsx`, `StudioOffboardingPanel.tsx`
- `packages/renderer/src/features/admin/AdminApprovalCenter.tsx`
- `tools/scripts/cluster-0537-people-admin-closeout-tests.mjs`

## Evidence / limitations

See `CLUSTER_0537_VALIDATION_RESULTS.md`. These are pure policy tests and source-integration assertions with inherited regression coverage, **not** a running PostgreSQL/Qt/browser integration test. No change to the file-updater executable. Account recovery if a network fails *after* account creation still requires the existing admin credential-reset workflow; the password must not be regenerated or exposed by replay.

Next: implementation audit of incomplete People/Admin/Library screens, finish genuinely incomplete workflows, keep certification deferred, and avoid counting isolated source edits as production readiness.
