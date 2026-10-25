# G25 WS13 → G25 closeout handoff

Canonical full source: `Cluster-v0.546.0-TD6-G25-Workstream13-Offline-Replay-Conflict-Safety-Source.zip`; direct parent Workstream 12.

Preserve:
- Never auto-discard queued work from `refreshServerSyncPosture`; explicit server-confirmed discard only.
- `offline-conflicts.ts` keeps per-record conflict permissions and only merges original writable keys; revision-required replay cannot proceed without latest server revision.
- `offline-policy.ts` owns retry eligibility, blocking permission/validation/deleted/stale/quarantined automatic retries.
- `sync-control-repository.ts` uses guarded, one-shot conflict status transitions under concurrent tabs.
- Sync Center copy, confirmation, and truthful recovery messages reuse existing controls; G25 collaboration, Ticket, Forms, release and scheduling contracts remain intact.

Run: `npm run cluster:td6:g25:ws13`, `npm run cluster:td6:g25`, `npm run techdebt:td5:source-closeout`. See `TD6_G25_WORKSTREAM13_RECONNECT_CONFLICT_CLOSEOUT.md` and `docs/design/UX_G25_WS13_RECONNECT_RECOVERY.md`.

G25 OPEN: prove complete durable history and reconnect/permission/version-gate acceptance; do not relabel this scope as completed simply because 25 new focused tests pass. G26–G28 and TD7 unchanged. No live database/Qt/Windows/node24 certification yet.
