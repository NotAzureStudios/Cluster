# Cluster 1.0 — TD6 implementation-first roadmap (F02 checkpoint)

**Authoritative user direction, 2026-10-17:** Implement unfinished v1 functionality before full environment/runtime certification. Keep focused source regressions. Keep source safety barriers. Do not consume the next pass merely building a Windows/PostgreSQL test environment.

## Baseline and current progress

- **Source:** `Cluster-v0.546.0-TD6-F02-Form-Deadlines-Reminders-Source.zip`, based directly on TD6 F01.
- **TD0–TD4:** source-closed; TD5 source-reliability changes preserved but acceptance deferred.
- **TD6 CD-01:** respondent drafts were already implemented; F01 added Forms conditional branching; F02 now adds scheduled deadlines/reminders and admin reporting. Do not label CD-01 fully complete without review of rich authoring/responder UX and audit/notification guarantees.
- **TD6 CD-02–CD-20:** retain original obligations in `TECH_DEBT_MASTER_ROADMAP.md`. None are implicitly removed or certified by F02.
- **TD7:** after required source feature implementation, cleanup and freeze; release certification afterward.

## F02 delivered source behavior

1. Versioned per-Form optional absolute deadline in publish settings (authored using administrator local time, saved as ISO UTC).
2. Separate optional due-soon interval (1–30 days) and one-time overdue reminder. Late submissions remain allowed unless the existing accepting-responses toggle is disabled.
3. Audience members see their deadline, completed/overdue status, and saved-draft state; the existing submission and private-draft contract is unchanged.
4. One durable per-user/published-version/stage delivery record; background-job scheduler wakes maintenance hourly and supports retry/worker lease ownership.
5. Only active, not-expired, not-yet-submitted recipients in the **current** audience are considered. Strict membership reads fail closed. Recheck current form/version/account/audience/completion after a worker wins its delivery claim.
6. Application Forms never participate. No response values or respondent drafts go in notifications.
7. Admin review panel shows current-version due date and recorded reminder counts, not recipient answers or misleading read/delivery guarantees.
8. New SQL migration and Prisma relations; no physical storage disposal changes.

## Next implementation targets

Prioritize **coherent connected workflows**, not pass counters:

- **F03 (preferred): CD-03 Work collaboration:** durable, user-scoped operation history/Undo/Redo for saved edits with expected-revision conflict handling and UI; avoid undoing another editor's updates.
- **CD-07:** original PDF/audio/video protected derivatives with published release provenance, access and watermark rules.
- **CD-08:** Desktop trusted activation/update/rollback for managed Packages; never pretend source-only operations prove native safety.
- **CD-04:** People/Account delegated access and expiration/offboarding lifecycle evidence.
- Continue CD-02 and CD-10–20 based on actual identified missing journeys, rather than repeating shared-component sweeps.

## Deferred certification, explicitly not completed

Dependency-backed build with generated Prisma client; fresh PostgreSQL migration; real multi-process jobs/notifications; cross-account browser access; Windows native/Qt; SMB/NAS/S3/media tests; release acceptance. See `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## Hard boundaries

Never enable physical Library destruction, auto-GC or quarantine execution without independent provider/storage safety evidence. Preserve effective permissions, idempotency, signed-package/trust boundaries, current-version checks, privacy and audit.
