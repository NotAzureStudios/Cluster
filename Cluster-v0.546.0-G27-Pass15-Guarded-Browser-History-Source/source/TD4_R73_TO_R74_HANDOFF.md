# Cluster TD4 R73 → R74 exact handoff

**Canonical source:** `Cluster-v0.546.0-TD4-R73-Studio-Forms-Search-Submission-Navigation-Source.zip`. R73 derives strictly from verified R72 and the attached R72→R73 binary patch.

## R73 delivered

Studio Forms and non-application review submissions are discoverable by administrators with Studio Settings edit permission through the existing bounded global Search. The indexed source is whitelisted to exclude respondent PII and answers, and results are readmitted against current DB identity, form and revision. Canonical links navigate to actual Studio Systems Forms/review UI, including older submissions outside the paginated queue. This required an admin-only target endpoint and exact-record detail endpoint, plus a Studio Settings section deep-link fix. Public applications stay on their separate Applications path.

## Validation summary

- 35/35 new focused assertions, 51/51 inherited selected regression scripts.
- 1,040 active TS/TSX files, 110 CSS, 4,497 relative imports scanned without authored parser/CSS/import failures.
- R72 vs R73 normalized incomplete-`tsc` renderer diagnostic signatures: 0 added. Full compile is unavailable from lean source without dependencies and generated Prisma.
- No new Prisma migration and no native executable changes.
- SHA file manifest, ZIP CRC, full patch-replay and complete file-content equality verified in packaging report.

## Priority next work

1. Audit real existing approval (and optionally application) screens for exact-record navigation and authorization, add only supported Search/Action adapters, then run negative access tests.
2. Finish finite typed producer/consumer ownership matrix; decide whether `work.assignment.changed` needs a dedicated subscriber and, if so, define its checkpoint/backfill behavior rather than creating a silent observer.
3. Complete non-TD2-configurable provider disable/drain/re-enable and revoked subscription lifecycle tests.
4. Keep storage quarantine/physical disposal/managed GC and unsafe provider migration disabled. Any eventual write requires generation fences, retained backups and real crash-recovery certification; scope their delivery separately if TD4 can freeze without enabling them.
5. Produce final TD4 source closeout evidence only after each owner contract is implemented, explicitly excluded, or transferred with a named receiving phase.

**Independent release gates** remain Node 24 dependency-backed compilation, live PostgreSQL migrations/multiworker, multi-user/browser privacy, native Windows/Qt, and real NAS/S3 recovery.
