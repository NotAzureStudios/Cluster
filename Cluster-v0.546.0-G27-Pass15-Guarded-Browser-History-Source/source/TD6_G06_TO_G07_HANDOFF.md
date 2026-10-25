# TD6 G06 → G07 handoff

- **Current source:** `Cluster-v0.546.0-TD6-G06-Admin-Calendar-Communications-Source.zip`.
- **Parent:** `Cluster-v0.546.0-TD6-G05-Package-Dependencies-Native-Deployment-Source.zip`. Do not use older sources.
- **Directive:** Maximum-effort grouped feature completion. Runtime/OS certification deferred; mandatory targeted source checks, manifest, clean incremental patch.
- **G06 implemented:** scheduled/reschedulable/cancellable announcements; atomic announcement+audience+activity+notification-outbox publication; strict audience eligibility; no empty scheduled job enqueues; Calendar owner-only reminder delivery with revision-unique persistence; Calendar tool lifecycle handling; Operations scheduled-announcement count; Admin UI for scheduling; Prisma migrations.
- **Important security:** Do not send Calendar event details to attendees until canonical per-user calendar access and explicit Project deny rules can be checked. G06 intentionally only reminds eligible owners. Do not treat `deliveryCount` as confirmed recipient read or downstream Discord delivery.
- **Validation:** `node tools/scripts/cluster-td6-g06-announcement-schedule-tests.mjs`; `node tools/scripts/cluster-td6-g06-calendar-reminders-tests.mjs`; `npm run techdebt:td6:source-scan`; plus current F01–G05 regressions and TD1/TD2 Calendar tests. One obsolete settings assertion fails 8/9 identically on parent G05.
- **Migration:** two new additive Prisma migrations in `apps/server/prisma/migrations/20261020200000_td6_g06_scheduled_announcements` and `20261020201500_td6_g06_calendar_owner_reminders`.
- **Still open:** Calendar participant-safe reminders, recurrence, rich announcement authoring, approval/scheduling policy configuration, full OOBE/setup, email/desktop provider features, G05 OS installer, ongoing Library/Project/CD feature ledger. No complete G06-area closure claimed.
- **Next:** G07 grouped cross-tool UX and remaining feature-ledger reconciliation; continue substantive implementation, not 40 single-control passes. TD7 cleanup follows TD6; full runtime certification last.
