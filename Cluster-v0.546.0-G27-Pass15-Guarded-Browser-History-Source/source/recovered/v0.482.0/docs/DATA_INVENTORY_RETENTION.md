# Data inventory and retention controls

Cluster v0.365 adds a centralized data-lifecycle inventory and age-based retention policy for operational records. The goal is to make retention explicit without pretending every row should be eligible for unattended deletion.

## Retention classes

Cluster classifies stored data into three groups.

### Configurable automatic retention

Administrators can enable/disable and set bounded retention windows for:

- general activity history,
- persistence audit history,
- expired or revoked session history,
- expired/consumed account-setup and Discord-link challenges,
- offline sync delivery receipts,
- resolved sync conflicts,
- sync deletion tombstones.

Each category has a minimum and maximum window chosen to preserve protocol/security behavior. Active sessions, open/quarantined sync conflicts, and unexpired authentication challenges are never deleted by the age-based cleanup.

### Protected or manual lifecycle

The generic retention engine does not automatically delete:

- the tamper-evident `SecurityAuditEvent` chain,
- published/draft legal policy history,
- privacy request evidence,
- authoritative users/projects/work records,
- authoritative project uploads.

These records require an explicit domain workflow or a later legally reviewed archival/erasure process. A data-retention slider must not become a hidden `DELETE FROM everything` button.

### Delegated lifecycle

Some temporary/recovery records keep their own safety-specific lifecycle:

- signed backup generations use the backup-generation policy and preserve at least three committed generations,
- API mutation receipts keep the Step 11 fixed seven-day idempotency window,
- incomplete desktop transfer staging keeps its fixed seven-day temporary-upload window.

These are displayed in the inventory but are not edited by the generic retention policy.

## Dry run before deletion

`GET /api/admin/privacy/retention-preview` calculates the current cutoff, total row count, and eligible row count for each configurable category without deleting anything.

The Studio Settings retention UI always shows this preview before the destructive action. The apply endpoint recalculates eligibility server-side instead of trusting stale browser counts.

## Applying retention

`POST /api/admin/privacy/retention-apply` requires:

- administrator authorization,
- recent authentication through the existing sensitive-action boundary,
- CSRF/origin protection,
- explicit `APPLY DATA RETENTION` confirmation.

Eligible PostgreSQL deletions are performed as one database transaction. The run result is recorded in `DataRetentionRun` and the action is written to the tamper-evident security audit trail.

Policy changes likewise require explicit confirmation and are security-audited.

## Scheduled maintenance

The existing daily operational-maintenance task now consumes the same `DataRetentionPolicy` rows as the administrator UI. Sync tombstones no longer have an independent hard-coded cleanup path, avoiding two retention systems racing each other.

The old `auditRetentionDays` server setting remains a migration/default source for existing installations. Once dedicated policy rows exist, category-specific values are authoritative.

## Inventory API

`GET /api/admin/privacy/data-inventory` exposes a no-store administrative snapshot of configurable, protected/manual, and delegated lifecycle categories. It reports record counts and policy classification, not record contents.

This inventory is operational metadata. It does not by itself determine which privacy law applies, establish a legally sufficient retention period, or authorize deleting records that an operator must preserve.

## Database records

`DataRetentionPolicy` stores one bounded rule per configurable category.

`DataRetentionRun` stores bounded execution evidence such as trigger, status, completion time, and aggregate deletion counts. It does not duplicate deleted record contents.

## Safety properties

- security audit rows are never part of generic retention,
- legal-policy history is never part of generic retention,
- pending privacy requests are never part of generic retention,
- open sync conflicts are never age-pruned,
- active sessions are never age-pruned,
- current work/project data is never age-pruned,
- authoritative uploads are never age-pruned,
- retention changes and destructive runs are admin-only and recently authenticated,
- dry-run counts are advisory; deletion eligibility is recalculated at execution time.

## Non-goals for v0.365

Roadmap Step 19 in v0.380.0 implements explicit approved-request fulfillment, live-account pseudonymization, and privacy legal holds. It deliberately does not rewrite historical backup generations or invent jurisdiction-specific retention schedules; policy/security/erasure evidence remains outside generic age-based cleanup.
