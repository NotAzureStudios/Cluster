# Cluster v0.546.0 TD6 F02 → next implementation handoff

## Exact resumption

1. Extract the **F02 full source archive**, not TD5 P13, not F01 alone.
2. Treat `TECH_DEBT_MASTER_ROADMAP.md` as the complete CD-01–CD-20 feature ledger and `IMPLEMENTATION_ROADMAP_TD6_F02.md` as current execution order.
3. Prioritize actual source implementation and focused tests; full runtime certification was explicitly deferred by the user on 2026-10-17. Do not reset the active phase to TD5 P14.
4. Prefer CD-03 saved collaborative undo/review next, then CD-07/08/04. Preserve F01 conditional branching and F02 deadlines/reminders.

## F02 changes to preserve

- `packages/shared/src/studio-systems-contracts.ts`: dueAt ISO/offset, 1–30-day reminder, optional overdue.
- `apps/server/src/domains/studio-systems/studio-form-reminders.ts`: bounded scan, strict audience checks, lease/idempotence, retry, no applications or completed/disabled recipients.
- `apps/server/prisma/schema.prisma` plus migration `20261017190000_td6_studio_form_reminder_deliveries`: durable record unique per version/user/stage.
- Server job runtime/automation wrapper/bootstrap: hourly maintenance queue, handler registration, shared logActivity.
- `studio-systems-routes.ts`: member due-state projection and admin evidence API.
- `StudioSystemsSettingsSection.tsx`, `MyFormsPanel.tsx`, `StudioFormSubmissionsPanel.tsx`: author controls, deadline visibility, admin aggregate status.
- `tools/scripts/cluster-td6-form-deadline-tests.mjs`: focused source tests covering stage boundaries, suppression, revoked permission, retries, parallel claims, and admin authority.

## Known implementation/certification boundaries

- Forms are **audience-published**, not manually assigned to individual users. A due date belongs to a published Form version.
- A reminder is published into existing activity/notification service. The claim is unique and a stable notification group key is reused, but crash-after-event-before-delivery-mark is still an at-least-once boundary. Source tests do not prove once-only Inbox delivery in a real multi-process deployment.
- Scheduled wakes are hourly. They will not fire at precisely the second a due-soon window opens.
- A reminder due date is advisory and does not change the existing `acceptingResponses` permission.
- Full installed dependency-backed build, Prisma generate/migrate, live PostgreSQL, Windows and authenticated browser runs are deferred, not passed.
- F01 and broader CD-01 editor/usability integration still need future review before 1.0 certification.

## Suggested F03 implementation

Audit actual current Board Card conflict/Undo models first. Add a persisted operation log and scoped inverse commands with expected-revision authorization; integrate into Boards and Whiteboards only where safe, and add two-editor stale-version/concurrent-deletion tests. No universal silent last-write-wins undo.
