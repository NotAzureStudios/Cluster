# TD1 Pass 6 — Distributed Studio Settings propagation

**Baseline:** TD1 Pass 5 Atomic Setting Reset (`Cluster-v0.546.0-TD1-Pass5-Atomic-Setting-Reset-Source.zip`). **Product version:** 0.546.0, unchanged.

## Confirmed unfinished behavior

Before this pass, the committing process applied a Studio Settings availability change immediately, while other Cluster server processes relied on a bounded 60-second `readSettings(true)` task. Cluster already had a PostgreSQL/optional Redis coordination bus for durable-job wakes and resource changes; making a new distributed messaging subsystem would duplicate that infrastructure.

## Implemented source changes

- `apps/server/src/core/studio-settings-coordination.ts` implements a small, bounded handler for DB-backed Settings-change hints. `committedLocally()` synchronously applies the committed effective configuration to this process, then publishes `{kind:"committed"}` over the existing coordination bus. No Setting values, secrets or user identifiers are sent.
- `apps/server/src/app/cluster-server.ts` subscribes to `studio-settings.changed` before bus startup. A remote hint triggers a forced `readSettings(true)` and passes that *database-authoritative* snapshot through the existing `reconcileToolAvailability`. Redis/PostgreSQL transport selection is left to the existing coordination bus; it does not create a separate listener or extra polling loop.
- Bursts coalesce: while a DB read is in flight, more hints produce at most one pending follow-up refresh. Reads are applied serially to avoid an older overlapping result flipping the local tool state back. DB-read failure does not busy-loop; later hints or existing 60-second reconciliation retry.
- A missing/dropped bus notification never makes an already committed Settings write fail. On shutdown, the handler stops accepting new callbacks or applying late refreshes. The existing 60-second DB poll is kept as a correctness fallback for disconnects and restart gaps.
- `packages/shared/src/tool-settings-contract.ts`: Scheduler's `editWindowDays` and `lockAfterDays` both have valid zero values, but `||` previously replaced them with 14/30 respectively. These use nullish fallback so a saved zero is honored; absent setting still resolves to 14/30.
- Updated the inherited durable-owner test to assert the new delegated local Settings callback, rather than require a direct call in `cluster-server.ts`.

## Verification

- New `npm run techdebt:td1:distributed`: 10 executable cases testing local application, non-sensitive message shape, DB-authoritative remote refresh, burst coalescing, failure/retry behavior, dropped bus hints, shutdown, integration wiring and Scheduler zero-value resolution.
- Inherited TD0, TD1, TD2, Settings conflicts, configuration writer and module registry checks pass. See `TD1_PASS6_VALIDATION.md`.
- No Prisma schema changes, no native executable changes, no new npm dependency, no separate service, no change to existing access policy.

## Explicit limitations

- **Not live PostgreSQL-certified:** The tests execute the actual handler implementation with mock adapters, and check wiring statically. They do not launch two real Cluster processes or a real PostgreSQL LISTEN/NOTIFY connection.
- **Not an instantaneous security revocation guarantee:** Message delivery can fail; the 60-second poll is still a fallback. API, resource and background-job authorization must always consult their authoritative policies.
- Remote refresh coalescing is best-effort event convergence, not a durable change log or global fencing primitive. Real multiprocess testing is required to measure propagation latency and verify re-enable/disable races.
- **TD1 still open:** Project/User/device scoped storage, inheritance, locked override rules, full registry outside the six Tool Config editors, and real database/browser certification.
- **TD2 still open:** Other worker/listener ownership, distributed job fencing, and idle CPU/request measurement.
