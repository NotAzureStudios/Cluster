# TD2 Pass 15: Queued Ticket automation ownership

**Parent:** TD2 Pass 14. **Scope:** existing shared Project/Studio automation queues; no new runtime service.

### Fixed

- `automation.studio-action` jobs originating from Ticket events are deferred when Tickets is disabled.
- `automation.project-rule` jobs originating from Ticket/Card-as-Ticket events are deferred when Tickets is disabled.
- Non-Ticket Project/Board automation remains runnable when Tickets is disabled.
- Project rule execution additionally checks persisted actions for `create_ticket`, including nested conditional branches and delayed action overrides, before writing a run or performing side effects. A missing/failing Ticket policy check defers.
- Fencing stays with existing durable worker leases, authorization checks, 30-second retry-preserving deferral and safe checkpoints.

### Boundaries

- Mixed job types cannot be disabled using SQL type exclusion without stopping unrelated automations; contextual checks occur after claim and validation.
- The existing Studio action executor uses one action per job; Ticket origin gates are checked before execution.
- Atomicity is limited to existing operations. A disable after a checkpoint cannot revoke already-committed effects. Manual/direct automation calls were not rewritten in this pass.
- Full Node24 dependency-backed build, live PostgreSQL competition, Windows operation, and resource measurements are still outstanding.
