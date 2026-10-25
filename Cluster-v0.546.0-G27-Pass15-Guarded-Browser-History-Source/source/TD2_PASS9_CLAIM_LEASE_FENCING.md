# TD2 Pass 9 — Per-claim lease fencing

**Parent:** TD2 Pass 8 in-flight availability source checkpoint. **Scope:** existing durable job queue and worker; no new subsystem or database migration.

## Confirmed prior gap

`BackgroundJobQueue.claim` stored a process-wide worker identity in `leaseOwner`. Renewal, progress, deferral, failure and completion checked the same identity and `RUNNING`, but did not uniformly demand an unexpired lease or a distinct claim incarnation. If a job was reclaimed by the same process after lease expiration, or replayed after deferred attempts were restored, stale work could still modify the new claim's durable state.

## Changes

- Create an opaque, unique lease token on **every claim**, even from the same worker process. Keep the stable worker identity in `BackgroundJobAttempt.workerId` for diagnostics and attribution.
- Fence lease renewal, progress, deferral, success and failure using the exact claim token, attempt counter, `RUNNING` state and **unexpired** lease. Missing or stale claims are rejected without changing the new owner's state.
- `heartbeat` cannot revive an already expired lease. In-flight optional-job checkpoints renew/verify the claim after authoritative tool availability and before the handler continues.
- Workers no longer report success when finalization rejected a stale claim, and categorize lost-fence outcomes separately from durable job failures.
- Deferral's transaction only updates its attempt record after successfully transitioning its own claim.
- Add SQL-contract/mock-DB and worker tests for same-worker reclaims, stale tokens, expired claims, current claims, and rejected finalization/progress.

## Safety boundary

This is **job state and cooperative checkpoint fencing**, not an exactly-once guarantee for arbitrary external effects. A side effect that happens between a successful checkpoint and a subsequent disable, lease expiration or external operation can still occur. Safe irreversible regions, API idempotency keys, and/or transactional outbox/commit fencing remain necessary where applicable. No forced cancellation during an atomic Library transfer commit.

## Validation summary

See `TD2_PASS9_VALIDATION.md`. Tests run on local Node 22.16.0; no live PostgreSQL, Node 24 dependency-backed build, Windows/Qt runtime or performance certification. TD1 and other unfinished TD2 owner registrations remain open.
