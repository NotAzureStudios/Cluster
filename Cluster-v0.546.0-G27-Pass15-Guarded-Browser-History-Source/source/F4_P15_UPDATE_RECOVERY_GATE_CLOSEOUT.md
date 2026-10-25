# F4 P15: Fail-closed update preflight backed by actual restore evidence

**Parent:** F4 P14 complete source. **Change type:** canonical API maintenance preflight, pure evaluator, saved Server Config UI, tests and docs. No Prisma schema or native binary modifications.

## Change

- Previously, `intent=update` only emitted a warning for backup/recovery requirements; its `ok` could be true with no known restorable backup. That was misleading and unsafe for future automation.
- `registerHealthOperationsRoutes` now receives the existing `recoveryReadiness()` function and calls it ONLY for an operator's update preflight. `Promise.allSettled` treats a broken/throwing recovery probe as missing evidence, never as a pass.
- Update preflight requires a fresh (at most five minutes old) `state=ready` recovery snapshot, matching original instance, verified complete schema generation, successful restore drill, verified latest generation, fresh backup and drill, plus no known-missing secret key.
- A missing/malformed/stale snapshot blocks with `RECOVERY_UNVERIFIED`; a non-ready or missing required check blocks with `RECOVERY_NOT_READY`. Current read-only preview includes only state/timestamp, never backup secrets or filenames.
- Ordinary maintenance/read-only/restart preview does NOT execute the expensive recovery readiness computation.
- The saved maintenance-window policy from F4 P14 still gates restart/update preflight; all results remain `executable:false`.

## Release limits

- Source/fixture checks only, no live PostgreSQL 18 or Windows 10 Service test.
- This does not start an update, create a backup, verify an actual restore, or authorize restarting a service.
- Full native supervisor execution still requires independent proofs, exclusive drain, role/PIN authorization, fresh time and policy re-evaluation and post-action recovery.
