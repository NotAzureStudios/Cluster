# TD2 Pass 16 — Cross-tool automation authority and closeout inventory

**Baseline:** TD2 Pass 15 (`Cluster-v0.546.0-TD2-Pass15-Queued-Ticket-Automation-Source.zip`), product version `0.546.0`.

## Source changes

- Extended the *existing* contextual durable job owner policy beyond Tickets to Calendar, Timeline and Scheduler activity and Project rule action overrides. No generic automation job type is disabled wholesale.
- Added one explicit mapping for Project automation side effects: `create_ticket → tickets`, `create_calendar → calendar`, `create_timeline → timeline`, `create_schedule → scheduler`. Nested branch actions are inspected before a rule starts so an alternate branch cannot silently write to a disabled tool. This is conservative: a disabled action in an unselected branch can defer the full rule.
- After loading the current Project rule from storage, the Project executor checks every referenced owner **before creating a run record or performing any action**, including manual/direct invocation. Missing/failing authoritative policy checks defer, preserving the background job's attempt budget. Dry-run previews remain read-only.
- Queued Studio automation verifies its originating tool immediately before executing an action, including a Calendar trigger. Deferral is not recorded as a false Studio automation failure.
- The shared worker's payload-aware gate consults the canonical tool flag for each classified owner; ordinary Project/Board work and shared maintenance do not inherit optional tool switches.
- Added a deterministic inventory guard for all 21 currently registered durable handler types: 16 shared, 2 contextual and 3 explicitly tool-owned. New handlers cannot be added without an ownership review in the guardrail. No new service, migration or native executable change.

## Proof / tests

- `npm run techdebt:td2:cross-tool` exercises 15 cases, including all four action targets, nested branches, stale/dropped tool policy, direct execution, dry-run, a mixed owner rule and resumed Studio automation.
- `npm run techdebt:td2:owner-inventory` classifies all 21 registered durable job handlers and prevents silently adding an unreviewed job type.
- Inherited TD0/TD1/TD2 checks plus tool registry and static source audit were run (see `TD2_PASS16_VALIDATION.md`).
- Full dependency-backed build and PostgreSQL-backed execution **were not run**. These tests transpile domain modules using controlled dependency stubs and do not prove production safety.

## Remaining release gates (TD2 NOT certified)

1. Real PostgreSQL 17/18 two-process tests for competing claims, lease expiry/reclaim, immediate and eventually propagated tool-disable, transactional transfer commit, live collaboration stream eviction and restart.
2. Real Windows/Node 24 full build with Prisma artifacts, signed-in web and Qt/Desktop smoke tests, and 100%/125%/150% DPI where relevant.
3. CPU, memory, SQL queries, network requests, open SSE connections and job-claim counts over equivalent **enabled idle / disabled idle / re-enabled** observation windows. Record baseline and after results; don't infer savings from mocked tests.
4. Inventory any additional dynamically registered timers/subscriptions, standalone media workers or future domain processes; only optional feature work should suspend. Data protection, retention, backups, auth, notifications and other shared infrastructure must continue.
5. Mid-flight multi-action automation is preflight-gated, **not atomic with a concurrent disable**. External side effects need operation-level idempotency or transaction boundaries; do not promise exactly-once behavior.

**Status:** TD2 source hardening progressed; **not formally closed** until release gates have supporting evidence. TD1 remains source-complete pending independent runtime certification. TD3 has not started.
