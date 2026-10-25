# TD4 R76.2 → TD5/TD6 handoff

**Use R76.2 as the latest TD4 corrected source baseline.** Preserve the R76 source-closeout decision, R76.1 Library-integrity corrections, and R76.2 post-commit Activity fixes.

TD4 is bounded **source-closed**, not runtime-certified. Do not reopen its architecture for hypothetical improvements. Reopen only for a reproduced defect in an already enabled TD4 contract.

## TD5: immediate high-value acceptance

1. Install pinned Node 24 and dependencies; generate Prisma; build all packages, then run the required migrations on disposable PostgreSQL 17/18.
2. Verify the four Library post-commit cases with real committed transactions and an injected Activity outage. Client must receive success, Library caches must invalidate, and retries must not be induced by false failures.
3. Stress concurrency across Library version upload/restore, mounted writes, resumable transfers, hierarchy jobs, outbox drain and subscriber ownership.
4. Run native Windows/Qt, offline/reconnect, protocol activation, and process-tree shutdown tests.
5. Do not enable physical disposal, automatic GC or tier migration without provider identity fencing, backups and recoverable quarantine tests.

## TD6

Finish actual user workflows and unresolved destinations (applications, announcements, automations, secondary-repository navigation) by using canonical resource and authorization contracts.

## Release claim limit

Source parsing, simulated handlers and clean incremental patch replay do not establish production readiness. Certification remains open in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.
