# F4 P13–P14 | Maintenance window planning and preflight policy

**Parent:** F4 P12 Operations OpenAPI source (do not substitute older G27 ZIPs).  **Version:** Cluster 0.546.0 (pre-release).

## Integrated changes

- Server Config → Maintenance has disabled-by-default planning, IANA timezone, unique weekday CSV, local wall-clock start and 15–240-minute window duration.
- Both canonical protected Server Config save schemas validate all fields. Settings remain in the existing revision-checked one-PIN AppSetting flow; there is no separate maintenance configuration database.
- New pure, bounded `previewMaintenanceWindows` uses actual timezone instants, avoiding UTC-week arithmetic. Missing DST spring time skips that occurrence, and autumn duplicate local wall times use the first occurrence even if a preview starts after that first occurrence has already ended. Closed windows are excluded; currently active windows are represented.
- New GET `/api/admin/operations/maintenance/windows` is admin-only, no-store, and uses saved settings, not a caller's executable command.
- Existing maintenance preflight for **restart and update** fails closed when the saved policy is unreadable or an enabled window is not currently active. Disabled planning is explicitly warned rather than silently treated as approved maintenance. Enter-maintenance/read-only still only provides an advisory planning snapshot.
- Operations OpenAPI inventory, UI types, checkpoint, tests and full-source manifest are updated.

## Explicit safety boundaries

- This pass NEVER runs a restart, update, drain, background task, network change, or Windows SCM command. The `executable` field stays false.
- The native service must separately authenticate the operator, re-read the approved policy, establish an exclusive drain, checkpoint jobs/uploads, verify backups and post-restart health and enforce rollback. None of that is claimed here.
- UI preview is of **saved** settings. Draft changes require the existing protected Save before appearing in the preview. Displayed ISO timestamps are UTC instants rendered by the client locale; the policy timezone/local date remain visible to avoid ambiguity.
- The server and Windows 10 deployment have not been exercised; database migrations from earlier F3/F2 passes remain unapplied.

## Tests and handoff

- Run `npm run cluster:f4:p14:maintenance-windows` and `node tools/scripts/cluster-td6-source-scan.mjs`.
- Execute inherited configuration, networking, incident, API and native source contract suites before packaging.
- For real 1.0 readiness, implement a **separately authorized native executor** and demonstrate cancellation, overlap rejection, crash recovery, drain completeness and safe rollback on a disposable Windows 10 service + PostgreSQL 18 installation.
