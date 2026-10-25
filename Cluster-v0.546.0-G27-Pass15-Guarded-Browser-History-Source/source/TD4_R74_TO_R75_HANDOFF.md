# Cluster TD4 R74 → R75 exact continuation handoff

**Use** `Cluster-v0.546.0-TD4-R74-Approval-Search-Exact-Navigation-Source.zip` as the full-source baseline. R74 was implemented directly on R73. Preserve all prior R57–R73 contracts.

**Delivered:** bounded administrator-only Approval Search, payload-whitelisted index, request-local live admission, shared global approval deep links, admin-only destination and exact review record API (global list/decision guard tightened to exclude non-admin Project managers), historical queue recovery, copy link, status filters and no wrong-target fallback. 32 focused checks and 51 inherited TD4 executable suites passed. No DB migration or native executable change.

**Do next:**

1. Audit actual non-TD2 providers (Git, Discord, storage, background integrations) and implement missing enable/disable, drain, restart, revoked permissions, and owned subscription cleanup; use existing runtime registries rather than a new framework.
2. Resolve whether `work.assignment.changed` needs an assignment-specific consumer at all. Do not create an inert registration; define durable replay cutoff/backfill and authorization before adding subscriber obligations.
3. Decide remaining non-navigable application/automation/announcement features as either verified TD4 adapters or named TD6 carry-forwards. Keep unsupported links excluded.
4. Final owner matrix and source-closure audit. Ensure storage quarantine, physical disposal, unsafe managed GC, and tier migration remain disabled pending TD5 storage-provider safety acceptance.

**Still unverified:** complete Node 24 compilation, Prisma generation, live PostgreSQL, authenticated multiuser browser, Windows/Qt, NAS/S3 generation and recovery. No claim of runtime certification.
