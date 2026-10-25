# Cluster v0.546.0 | F3 P3 / F4 connected incident alert routing

## Exact source parent
`Cluster-v0.546.0-F3-P2-API-Readiness-Incident-Bridge-Source.zip`.
Continue the real G27 Batch 8 / Domain-OOBE / F3 P1 / F3 P2 application source. This is not the standalone operations policy kit.

## Implemented together

- **Durable alert policy table** for two trusted, server-generated dependency signals: writable storage and background task execution. Authorized target types: all active administrators, a selected administrator, an existing Studio Team, or an existing Department. Team/department membership is resolved against the actual People directory; **only current authorized admin/owner members** receive these privileged server alerts. This does not create operational access rights. Empty configured targets fall back to eligible administrators. All membership sets and dispatch work are bounded.
- **Policy editing in Operations → Incidents:** one batch `PUT /api/admin/operations/alert-policies` and one Security PIN at Save. An entire draft is committed within one revision-fenced Prisma transaction. Invalid PIN/targets/conflicts cannot partially publish one policy and leave another behind. The on-screen draft can be corrected and retried. GET `/api/admin/operations/alert-policies` returns administrative policy and target choices without secrets.
- **Durable incident acknowledgement:** `POST /api/admin/operations/incidents/:incidentId/acknowledge` is admin-only and idempotent. It records responder, time, and timeline evidence. An Inbox `acknowledgedAt` is **NOT** equivalent to acknowledging the incident. Reopening a resolved or closed incident resets acknowledgement and starts a new `alertCycle`.
- **Incident owner convergence:** a newly created or reopened dependency incident is assigned to its first actual authorized notification recipient, instead of a different arbitrary administrator.
- **Durable routing receipts:** per-incident, per-cycle, per-stage, per-recipient unique receipts are committed in the same transaction as Inbox notifications and timeline evidence. Retries, process overlap, and scheduler ticks do not generate duplicate Inbox messages. The initial incident bridge and stage escalation use this shared implementation.
- **Scheduled reminders/escalation:** one adaptive 120-second background task enumerates at most 50 unacknowledged active automated incidents, computes bounded stages (`reminder-1..3`, `escalation-1..2`), and delivers only stages not yet committed. A row-guarded conditional database write serializes delivery with incident acknowledgement. No new per-tool polling loop is added.
- **Failure visibility:** a dependency incident with no eligible admin gets an explicit durable timeline warning; no attempt is made to grant permissions simply to deliver an alert.
- **UI:** Operations Incidents includes alert settings, team/department/admin selection, reminder and acknowledgement thresholds, one-PIN batch save, status of responder acknowledgement and a deliberate Acknowledge action.

## Security / reliability boundaries

- Primary recipients **must** be already authorized for administrative incident access. Team or Department targeting does not create RBAC grants. No user-controlled URL probes, unattended service restarts, elevated Windows operations, or raw diagnostic details in notification messages.
- Existing Notification Inbox delivery is the sole in-app notification service. Database outages cannot use this service; native out-of-process emergency queue/relay **remains required**.
- This implementation currently covers **storage and background task dependency incidents**, not arbitrary API endpoints or all kinds of server problems. Full API probe registry, on-call schedules/rotations, custom recipient groups, external email/Discord/SMS, preference-based quiet hours, escalation channel policy, operator delegation beyond administrators and policy revision review UI remain open.
- Cross-process incident race, PIN lockout, policy drafts, and notification delivery must still be confirmed with real PostgreSQL 18 and native Windows runtimes.
- Destructive G26 storage/installer work remains disabled. Never infer corruption repair from a healthy dependency probe.

## Database migrations needing live execution

- Inherited: `20261108000000_f3_api_dependency_incident_automation` (unique nullable automation key).
- New: `20261109000000_f4_incident_alert_routing` (policy, acknowledgement/cycle, notification receipt).

Both migrations are **source only**, not applied on a running database. Prisma client regeneration and Node 24 dependency-backed compile are **not certified**.

## Test commands

- `node tools/scripts/cluster-f3-p3-alert-routing-tests.mjs` (routing, bounded eligibility, stage calculation, idempotent receipts, realtime publication, resumption/ack).
- `node tools/scripts/cluster-f3-p3-policy-atomic-tests.mjs` (batch create/update, conflicting revision, full transactional rollback, duplicate keys, PIN-before-commit source contract).
- `node tools/scripts/cluster-f3-p2-incident-bridge-tests.mjs` and `node tools/scripts/cluster-f3-p2-api-tool-readiness-tests.mjs` (inherited regression).
- `node tools/scripts/cluster-td6-g27-api-tool-manager-tests.mjs` and G27 domain/config tests.
- `node tools/scripts/cluster-td6-source-scan.mjs` (source syntax/import/CSS only).
