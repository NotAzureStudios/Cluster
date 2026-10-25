# Cluster 0.517.0 | Managed Package reconciliation

**Scope:** continued development against the full v0.516.0 source, preserving Pass 15 source convergence. Not a certified deployment.

## Implemented

1. A new, admin-only `GET /api/admin/packages/:id/reconciliation` endpoint with strict channel/platform selection and cursor paging (`limit` 1–100, default 50). It considers only nonrevoked, proof-verified Desktop registrations, with an explicit database bound.
2. Target selection reuses the canonical `projectDevicePackageTargets()` cryptographic validation. Revoked releases, disabled signing keys, incorrect signatures, paused rollouts and platform mismatches cannot become active reconciliation targets; valid pins retain priority over rollout cohorts.
3. Reads one bounded, newest-first sample of device offers/reports per page, without leaking ZIP bytes, trust material, or one-time reporting challenges. Every entry remains labeled nonattested. Missing sampled reports do **not** imply no installation, no prior download, or no prior activity.
4. Separates `not_targeted`, `no_report`, `offer_pending`, `reported_in_progress`, `reported_current`, `reported_failure`, `reported_rollback`, and `different_release_reported` so operators can investigate what a device claimed without mistaking it for a health check.
5. Studio Managed Packages UI now provides a manual Inspect action, paginated table, per-page claimed-current count, evidence-sample truncation warning, and stale-response suppression. Reconciliation is never fetched just because Studio Settings opened; mutation invalidates old evidence.
6. Explicitly marks the selected target platform as a **simulation**, not independently verified device operating system.

## Validation

- 33/33 inherited + new source/mock-route regression scripts passing (31 from 0.516 and 0.515 receipt assertions plus new 0.517 suite).
- New 0.517 suite: 21/21 checks including authorization, cursor paging, signed trust gating, pins, revocations, failed/rolled-back/stale reports and nonattestation.
- Go native Package stager tests pass unchanged.
- Standalone TS/TSX parse scan and CSS delimiter checks are clean; one generated-Prisma import is unavailable in the lean tree, consistent with the baseline. Full TypeScript compilation remains deferred.
- No Prisma schema migrations. No modifications to Go native executables or Qt native code.

## Remaining

Authenticated Qt native staging/download integration; OS-service-owned secure install with health-checked rollback; provable device execution state; package update policy reconciliation with independent trust roots; original-PDF/media derivative adapters; Work shared autosave/reviews/undo; full PostgreSQL/Windows/runtime certification.
