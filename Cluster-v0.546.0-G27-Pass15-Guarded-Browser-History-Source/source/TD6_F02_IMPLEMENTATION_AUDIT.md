# TD6 F02 — Forms deadline/reminder implementation audit

**Scope:** Actual source feature work, not release certification.

**Contracts:** Settings validated through the published immutable Form version schema. `dueAt` is a timezone-offset ISO string, converted from local datetime in the editor. Reminders require a due date, cannot have an interval outside 1–30 days, and are separate from submission acceptance.

**Worker:** Hourly queued maintenance work checks current published version and author settings, excludes public applications, bounded-scans active accounts and submissions, checks current audience via strict normalized membership. One composite-unique per version/user/stage record is leased with an opaque token. The worker rechecks authority after the lease and before the notification activity event. Transient failures reset the claim for replay with the same group key; unsent claim leases expire for crash recovery.

**Respondents:** My Forms exposes upcoming/overdue/completed state and the due date in the user's locale, without exposing anyone else's submission/draft. Private respondent drafts and F01 conditional answers remain intact.

**Administrator:** Published-version settings and a separate authenticated, no-store aggregate reporting endpoint. No public application records in this projection. Counts are successful activity publication records, not read receipts.

**Source testing:** Explicit due-window, permissions, completion, lease/duplicate, crash-retry, current-version, public/private report permission and syntax checks in F02. Existing F01 Forms and prior Forms/TD5 tests remain unchanged and runnable using a temporary TypeScript dev toolchain when necessary.

**Not certified:** Actual PostgreSQL migrations/transaction anomalies, real service crash recovery, notification transport exactly-once effects, UI/browser integration, native Windows, full compilation and 1.0 release gates.
