# Cluster TD4 R76.1 → TD5 / TD6 handoff

**Use the R76.1 corrective source archive**, not R76, as the canonical implementation baseline. Preserve `TD4_R76_SOURCE_CLOSEOUT.md`, the final owner matrix and the new corrective addendum.

TD4 is bounded source-closed after fixing two actual Library data-integrity defects revealed by independent verification. The 60-script suite passed; the clean active-source scan is not a full Node 24 compile. Runtime certification remains separate.

## TD5 priorities

1. Restore pinned Node 24 dependencies and generate Prisma; perform the real server/renderer builds.
2. Exercise PostgreSQL 17/18 on a disposable instance, including Library version transaction rollback/revision races, hierarchy jobs, outbox claims and shutdown drain.
3. Test native Windows/Qt lifecycle, protocol links, screen scaling and process-tree cleanup.
4. Complete provider-generation fencing, backup/retention evidence, reversible quarantine and recovery before enabling any physical storage deletion, managed GC or tier migration.
5. Check staging-candidate orphan reconciliation after transactional Library failures. Never delete referenced bytes using only a path or age heuristic.

## TD6 priorities

Build missing actual application destinations and workflows before Search indexing, including Announcements, public applications, automations and secondary-repository navigation. Reuse the canonical resource, authorization, Search and event contracts.

**Do not reopen TD4 for a hypothetical improvement.** Reopen only on another reproduced violation of an already enabled TD4 source contract. Preserve source-closeout boundaries without claiming release certification.
