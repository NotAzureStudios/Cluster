# Cluster TD6 G08 — Grouped Calendar collaboration and recurrence

Parent: TD6 G07 full-source checkpoint. Status: focused source implementation complete.

## Delivered

- Calendar authoring: owner-only vs permission-checked eligible-attendee reminders.
- Server: canonical service-actor Calendar authorization, denying Project rules and private scope as HTTP routes do.
- Durable activity/outbox: transactionally guarded per-recipient, per-occurrence dispatch, exact revision idempotency.
- Recurrence: bounded daily/weekly/weekdays/monthly due-time calculation with IANA timezone DST handling, supported-rule validation, worker due-work preflight.
- Operations: privacy-preserving aggregate dispatch and attendee-reminder counts.
- Migration and focused/inherited checks documented in `TD6_G08_CALENDAR_COLLABORATION_IMPLEMENTATION.md`.

## Still open on CD-11/CD-16

Recurrence calendar rendering/editing, exceptional instances, arbitrary RRULEs, timezone-aware cross-zone editor, per-user reminder policies, attendee editing/delegation, communications templates/approval, broader delivery channels and fine-grained quiet hours.

## Next grouped batches

1. G09: Setup/OOBE + config import/preview + Help/permissions guidance.
2. G10: Library + Packets + secure additional derivatives/watermarking + Transfers.
3. G11: Desktop Packages, supervised OS installation and cross-package recovery.
4. Remaining CD01–CD20 feature owner closure batches, TD7 cleanup, then certification.
