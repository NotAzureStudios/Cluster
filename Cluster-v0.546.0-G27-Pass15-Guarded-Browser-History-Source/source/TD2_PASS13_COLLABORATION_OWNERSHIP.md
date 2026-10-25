# TD2 Pass 13: Collaboration stream ownership and request-time disable enforcement

**Parent:** `Cluster-v0.546.0-TD2-Pass12-Claim-Admission-Source.zip`.

## Confirmed problem

Tool availability already suspended enrolled timers, durable background jobs and Library cache listeners. Collaboration SSE connections for Calendar, Library, Scheduler and Timeline remained connected until normal authorization/connection maintenance; furthermore, collaboration request permission caches could still accept recently allowed resources because tool disable wasn't checked before the cached decision. These endpoints are separate from tool-specific UI routes.

## Changes made

- Define only the **directly owned** collaboration room-to-tool map (`calendar`, `library`, `scheduler`, `timeline`) in `collaboration-runtime.ts`. Boards, Projects, Whiteboards, Builds, QA, Releases and Control share domain boundaries and intentionally have **no inferred owner**. Do not treat Ticket-disable as authority to disconnect shared Board rooms.
- `CollaborationRuntime.disconnectTool()` closes only the disabled tool's SSE rooms with `access: {state: 'revoked', reason: 'tool_disabled'}`, removes their presence including heartbeat-only records, invalidates access-cache entries, and leaves unrelated rooms connected.
- `reconcileToolAvailability` disconnects rooms on the actual enabled-to-disabled edge, not on every 60-second reconciliation. Existing per-tool background lifecycle and queue wake-on-reenable remain intact.
- Collaboration HTTP request access is checked **before** consulting cached permission results; disabled rooms return HTTP 503/`TOOL_DISABLED`. Stream maintenance reauthorization uses the same owner gate.
- Stream close/error cleanup is attached before its first async initial-state projection and runs once; disabling while that projection is awaiting database access no longer leaves an orphaned stream telemetry handle.
- Added `techdebt:td2:collaboration` with executable tests for mapping, SSE isolation, heartbeat-only presence, cached allow bypass, re-enable, ongoing stream reauthorization, other rooms, and initial projection cleanup order.

## Semantics and limits

This is **a per-process active-stream teardown and request gate**, not a claim of atomic cluster-wide disable. Cross-server tool-state changes still flow through the existing coordination messages and periodic recovery refresh. The shared collaboration maintenance timer and normal project/board collaboration still run even when one optional tool is off. There are no new Prisma migrations, npm dependencies or native binary changes. No actual SSE/browser, Windows, multi-node PostgreSQL, Node24 full build or CPU/network measurement was performed here.

**Remaining TD2:** Audit additional optional runtime owners, verify coordinated disable with real workers/SSE clients, distributed execution under PostgreSQL, and quantify idle resource savings. **TD1:** source-complete; its runtime certification remains a release gate.
