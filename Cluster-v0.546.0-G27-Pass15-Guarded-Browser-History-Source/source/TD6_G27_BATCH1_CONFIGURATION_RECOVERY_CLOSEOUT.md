# TD6 G27 Batch 1 | Studio Configuration Recovery & Audit

**Baseline:** `Cluster-v0.546.0-TD6-G26-Audit-Snapshot-Consistency-Source.zip`.

**Source implementation (CD-15, CD-17, CD-19):**

- Added first-class administrator revision rollback preview and commit. A rollback is **not** a `.clusterconfig` import: it can delete an explicit AppSetting row when the chosen revision's prior value was absent.
- Restricted to the same five non-secret Studio defaults as safe configuration import; rejects unexpected/duplicated historical keys, invalid types/timezones, and unrecognized revisions.
- Conflicting or superseded revisions are blocked. Preview fingerprints bind the exact historical revision and observed values; commit recomputes under the same PostgreSQL advisory lock `(506,1)` and Serializable transaction used by Studio Settings writes.
- Requires a user-written reason, creates a new revision documenting the inverse change, and appends a tamper-evident security audit event **within the same transaction**. Audit or DB-write failure rolls back the entire operation. A rollback can itself be reversed using a separate explicit preview.
- Configuration preview and apply preflight now read explicit DB rows rather than merged effective Studio defaults. Missing overrides are correctly reported as absent, avoiding false stale-preview conflicts after rollback.
- Also made ordinary safe configuration import and its security audit atomic. Previously a committed import could be reported without durable audit evidence.
- Admin Setup UI provides Preview rollback → review per-field changes and deletions → enter reason → Apply reviewed rollback. It invalidates stale import/rollback previews, blocks duplicate pending actions, explains the limitations of selective imports, and refreshes revision history on success.
- Added executable route-level, database-failure, audit-failure, stale CAS, invalid-history, unauthorized-access, inverse-revision and UI integration checks. Preserved inherited G09/v0.506 setup tests by updating assumptions specific to the new workflow.

**Safety boundaries:** Does not alter secrets, storage, permissions, server-managed boot configuration, or personal settings; no automatic rollback; no longer-lived preview capability tokens. Previously unset means deleting a row, not storing JSON `null`. An explicitly stored `null` is not treated as absence during conflict checks.

**Scope limits:** Only five allowlisted Studio defaults participate. This is not an all-domain `.clusterconfig` snapshot/rollback engine. It does not certify live PostgreSQL behavior, windows native runtime, Node 24 compilation, or UI acceptance; those are separately tracked. The setup checklist remains an admin-only projection and retains all earlier protection.

**Follow-on G27 connected workflows:** People onboarding/offboarding + temporary access and recovery; Admin effective access/config guidance; cross-tool navigation/search/Create action quality; Communications targeting/quiet hours. Complete these before G28 feature reconciliation and TD7 fossil cleanup. Source-delivery work proceeds independently from postponed runtime certification.
