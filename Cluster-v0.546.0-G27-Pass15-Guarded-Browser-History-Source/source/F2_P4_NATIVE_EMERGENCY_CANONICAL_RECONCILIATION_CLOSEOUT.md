# Cluster v0.546.0 | F2 P4 Native Emergency → Canonical Incident Reconciliation

**Parent:** `Cluster-v0.546.0-F2-P3-Service-Network-Preflight-Source.zip`, SHA-256 `fd45fb820be51e8f42ae177ada0351b02ddece85176da6200ac367e9631e2dce`.

**Scope: implemented in the actual Cluster source. Not production-certified.**

## Connected behavior

- On the application's existing adaptive two-minute background-task scheduler, while runtime mode is normal, server is ready, and not draining: read `data/system/operations/native-alerts` under the trusted boot workspace root. Never derive paths from API input. Do not create another timer per tool, process or viewer.
- Journal reader ignores in-progress `.writing`, `.sending` and quarantined `.invalid` files. It reads `.pending` and `.sent` files without ever changing or deleting native evidence. Only bounded regular files matching the native journal filename pattern are opened. Files above 4096 bytes, symlinks, malformed JSON, unexpected fields, unrecognized codes/severity/messages, IDs differing from filename, and out-of-range timestamps are not imported. Native CATALOG semantics are byte-for-byte checked against the Go source.
- The durable `OperationsNativeAlertReceipt` table contains **one unique record for each native event ID** in the *same serializable PostgreSQL transaction* as its canonical `OperationsIncident`, `OperationsIncidentTimeline`, `OperationsIncidentResource`, `OperationsIncidentAlertDispatch` and `NotificationInboxItem` updates. A process crash before commit leaves the event eligible for the next scan. After commit, retry is idempotent. Cross-worker uniqueness/serialization failures are retried by the adaptive scheduler.
- History is event-time-ordered, preserving Go nanosecond accuracy via a normalized UTC ordinal even though database DateTime has millisecond precision. Older late-arriving events cannot undo a newer recovery. Up to 32 new events are processed per tick; previously imported IDs are excluded *before* applying the batch limit to prevent starvation.
- Alert classes are canonical `cluster:native:{gateway,api-process,api-dependencies,native-host}`. Failure classes create/reopen or add evidence to an incident; confirmed API recovery and dependency readiness restoration can resolve only `open` or `monitoring` automated incidents, never a human-owned active investigation or mitigation. Native host and gateway failures require human resolution because no safe corresponding native recovery code exists.
- Escalation from a supervised process crash (high) to exhausted recovery (critical) upgrades incident severity and issues an additional unique critical-severity Inbox dispatch.
- Routing uses the existing administrator eligibility gate, team/department assignments, security-PIN batch-save policy, Inbox publishing and durable per-stage dispatch receipts. No assignment grants administrative privileges.
- Operations → Incidents & Health includes policy labels for the four native classes and an **explicitly requested**, admin-only, read-only history of imported native events. The UI does not poll a new endpoint continuously, and the endpoint never reads the native spool.

## Database migration (not applied)

`20261110000000_f2_native_emergency_incident_receipts` creates one receipt table with ID uniqueness and indexes for chronological category lookup. This **must be generated and applied with the existing F3 P2 and F3 P3 migrations** on disposable PostgreSQL 18 before any production deployment.

## Safety and limits

- An unavailable PostgreSQL database prevents canonical reconciliation, but never prevents the independent Go journal or its optional preapproved Discord fallback from continuing to operate.
- Native Go's bounded `.sent` retention can prune old evidence if an outage exceeds available journal capacity. The importer makes **no guaranteed-replay claim beyond the retained on-disk window**; retention and overflow behavior need live Windows outage/soak acceptance.
- No arbitrary external probe or HTTP URL is read. No raw local filesystem paths or error text are copied into incidents or Inbox. Journal file permissions and tamper resistance require real LocalService/NAS testing.
- No Windows Service installed, no built Windows binary reissued, no PostgreSQL migration run and no Go 1.27.1, Node 24 or Qt production certification performed in this pass.

## Verification scope

New `tools/scripts/cluster-f2-p4-native-journal-reconciliation-tests.mjs` covers journal allowlist parity with native Go, malformed/bounded input, symlink exclusion, temporal order, duplicate receipts, starvation avoidance, canonical incident state transitions, alert delivery/ownership, critical severity upgrades, and source/UI wiring. Existing alert, API, native, and Domain/OOBE regressions are run separately and recorded in package integrity evidence.
