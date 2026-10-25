# TD6 G08 → G09 continuation handoff

**Canonical baseline:** `Cluster-v0.546.0-TD6-G08-Calendar-Participant-Recurrence-Source.zip`. Parent: G07 full source. Do not patch an older source without reconstructing the G08 checkpoint.

**Standing user priority:** maximize coherent, grouped unfinished implementation; full runtime certification after TD6 and TD7. Retain focused regressions and reproducible complete source archives.

**G08 work:** new Calendar reminder audience editing; canonical background recipient authorization; RSVP/expiry/private/Project deny checks; per-recipient per-occurrence durable outbox dispatch evidence; supported daily/weekly/weekday/monthly recurrence including DST; Calendar operations aggregate. Migration `20261021000000_td6_g08_calendar_participant_reminders` adds the audience column, renames owner dispatch to recipient, adds occurrence identity and updates unique index while preserving earlier owner reminder evidence.

**Tests:** run `node tools/scripts/cluster-td6-g08-calendar-participant-tests.mjs`, inherited G06 Calendar + announcement, G07 UX, F01/F02 and G02–G05, and the TD6 source scan. Known standalone-source limitations include missing generated Prisma client and Node24 production runtime.

**Next grouped priority G09:** OOBE setup checklist and progressive requirements, safe `.clusterconfig` import preview/diff, inheritance explanations, admin contextual Help, recovery-safe setup guidance. Reuse existing configuration authorities rather than create a new Settings layer. Preserve Studio vs Server vs Tool ownership and secrets-excluded configuration exports.

**Open G08 follow-ups:** recurring Calendar list visualization, occurrence exceptions, attendee-delegated access, Calendar user timezone editor coherence, arbitrary recurrence parsing, segmented worker scans, announcement templates/review policy. G10 media delivery/watermarking and G11 supervised native installers remain separate substantial workstreams. CD-01–CD-20 stay source-partial until each owner's backend, UI and integrated workflow are explicitly reconciled.
