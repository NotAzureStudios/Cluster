# Cluster implementation roadmap | revision 66

**Baseline** v0.546.0 TD4 R65. **Current** v0.546.0 TD4 R66. TD0–TD3 source-closed, TD4 active. Historical `TECH_DEBT_MASTER_ROADMAP.md` and `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` remain authoritative in their respective domains.

## R66 delivered

1. Independent disposition-review governance. Two distinct administrators other than the requester must approve after the restore window; reviewers are authenticated and authorized for the Library record on each POST.
2. Immutable decision history and serializable optimistic concurrency. Approval, rejection, and withdrawal recorded alongside materialized request status, versioned policy-evidence fingerprint, actor and reason. Approved requests remain active; restoring/canceling revokes an approved review.
3. Policy revalidation. Stale retention, legal holds, item revisions or dependencies disqualify approvals. Current approval validity is rechecked on read; no storage-deletion capability is granted.
4. Review UI. Authorized administrators can approve, reject or withdraw; reason and confirmation required; audit history is visible; non-destructive semantics emphasized.
5. Executable/source regressions and reproducible archive and patch. No automatic quarantine or physical deletion.

## Remaining TD4 source implementation

- Provider-specific generation/lease/backup/restore fencing and durable quarantine journal, requiring rigorous recovery testing before any actual filesystem/storage mutation.
- Complete finite provider ownership and subscriber lifecycle matrix; remaining typed-domain producers and Search/Action adapter integration.
- TD4 closure audit: negative authorization, no second generic framework, regression evidence, real source freeze.

## Release certification remains separate

Pinned Node 24 full dependency build, migration deploy and PostgreSQL concurrency, multi-user authorization/revocation, real NAS/S3 restore, and Windows/Qt acceptance were not performed by the source checkpoint. Approval of governance must not be represented as approval to physically delete bytes.
