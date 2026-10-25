# Cluster v0.546.0 | TD6 G27 Batch 2: People Access Lifecycle

**Parent:** G27 Batch 1 Configuration Recovery. **Status:** source implemented, runtime certification deferred per user direction.

## Connected delivered workflow

1. **Access-expiry lifecycle can evaluate the full eligible population.** Replaced a hard 500-user scan failure with bounded keyset pages ordered by (`accessExpiresAt`, `id`). All pages are processed, with fresh authorization checks and a separate idempotent per-window/per-stage notification record. Administrator recipients also page beyond the previous 500-row failure. Current admin recipient filtering requires ACTIVE accounts, unarchived identity and unexpired access. Existing session revocation and Inbox writes remain atomic per subject.
2. **Admin renewals support scalable discovery.** The authorized renewals GET endpoint accepts `search` (username, display/preferred name) and a bounded base64url cursor. It returns 50 expiring accounts per page and `nextCursor`, while preserving the existing independent renewal-review queue. The Studio Systems panel provides explicit Search/Clear/Previous/Next controls. No extra polling or client-side reuse of authorization-sensitive Search results was introduced. Responses use `Cache-Control: no-store`.
3. **Offboarding settles pending renewals.** The existing offboarding transaction now cancels pending access-renewal review records, resolves their administrator Inbox approval actions and includes the count in offboarding outcome evidence. The helper fails closed on incomplete (>1000) review scans or concurrent review changes. Returning identities cannot inherit those prior pending review requests.
4. **Approved renewals and completed offboarding resolve obsolete expiry tasks.** Existing Inbox history remains intact; only `requiresAction` and acknowledgement/read state change. Subsequent changed expiration windows remain eligible for new notices.
5. **Preserved controls.** Two-person approval separation, account revision compare-and-swap, no implicit role/project/license grants, deadline-based authorization, offboarding key/Package settlement, and G26 Vault/Library safeguards remain in place. No schema migration required; StudioAccessRenewal.status is an existing String column.

## Verification evidence

- `cluster-td6-g27-people-access-lifecycle-tests.mjs`: 13/13 focused checks with simulated real handler callbacks and transactions (520 expiring identities, 526 admin recipients, keyset traversal, stable stage deduplication, inbox failure rollback, offboarding disposition, CAS failure, authorized search/cursor behavior).
- Inherited access renewal governance: 17/17; offboarding credential settlement: 21/21; return-to-Studio identity: 18/18 (updated stale test-import fixtures).
- Inherited configuration recovery and setup tests: 54/54; TD6 source scan: 1102 TS/TSX, 3234 relative imports, 110 CSS, zero errors.
- TD5's long closeout script was attempted; the execution window elapsed after the first seven groups (91 cases). **Full TD5 result in this pass is not verified.** Previously reported TD5 closeout from the parent remains history, not a new claim.

## Important limits / next workflow

- Work was validated with mocked, transactional runtime models, not live PostgreSQL, independently authenticated web sessions or Windows Qt. This is a development-source checkpoint.
- The expiring-account selection is live keyset pagination, not a globally frozen multi-page snapshot. Concurrent changes are reevaluated inside the per-user transaction, so they cannot authorize writes on stale account state. Extremely large deployments should consider chunked worker leases and claim-limited administration batching.
- Access-renewal review history is still limited to the 200 most recent records; this pass scales the account picker and expiration worker, **not** historical review pagination.
- Continue G27 with People onboarding completion/approval mapping, effective permissions and role-source explanations, Home/Admin attention links, and tool-wide Search/Create navigation. Avoid parallel account stores.
- G26 Windows MSI recovery, external revocation and destructive storage reconciliation remain separate unverified/safety-blocked requirements. Deferred certification does not authorize destructive operations.
