# TD4 R34 | Durable Library metadata bulk operations

## Confirmed previous limitation

R33 authorized Library workspace and Manual/Smart Collection selection across unloaded pages but capped interactive bulk changes at 200 records in one transaction. Enlarging that synchronous transaction would expose timeout, lock-contention and uncertain-write hazards. Cluster already has an authoritative durable worker/queue and tool disable ownership; R34 integrates with those owners instead of introducing a second queue.

## Implemented end-to-end source workflow

1. **Preview:** Library workspace users choose background Tag/Untag/Pin/Unpin matching items. Server accepts a tightly scoped existing search query, resolves a stable repeatable-read selection with per-file contribute permissions and Personnel Records exclusion, refuses over 1,000 accessible matches, and returns count and SHA-256 selection digest. No source record IDs are accepted from the UI.
2. **Confirm:** UI displays count and non-destructive nature. It submits the original query, action, preview digest and a single UUID requestKey. Server re-resolves the current snapshot; any change in IDs/revisions rejects the write before queue acceptance.
3. **Deduplicate:** the queue job owns the immutable ID+revision snapshot. Deduplication includes actor, exact action and parameters, selection digest and intent UUID; a DB partial unique index prevents a new identical intent even if an HTTP response is lost after acceptance or the original job terminates.
4. **Execute:** canonical `library.bulk.metadata` worker performs at most 20 items in a Serializable transaction. Each chunk checks actor active state/expiry, current Library access, Records attachments, deletion/lifecycle states, active locks and revision preconditions. Denied/changed/no-op rows are recorded in aggregate without revealing source details to unauthorized recipients.
5. **Commit atomically:** item edits, checkpoint CAS, aggregate totals and ActivityEvent evidence are one database commit. Retrying a committed chunk resumes from the next cursor without double-applying changes. Progress notifications do not own the outcome. The canonical durable-job worker owns retries, leases, pause, cancellation and tool-disable gating.
6. **Observe/cancel:** only the job initiator may view its job/checkpoint or request cancellation. UI shows totals for changed, conflicted, denied, blocked, skipped, stores an opaque active job ID for reload recovery, suspends polling when the document is hidden and distinguishes completed work from pending cancellation.

## Source boundaries and excluded work

- Up to 1,000 selected items; up to 20,000 scanned candidates. The pre-existing 200-item interactive operation remains unchanged. Jobs do not accept user-supplied arbitrary target IDs.
- Bulk metadata operations only; moves, deletes, destruction, archive/restore, complex rename and folder mutations are excluded.
- Background jobs currently operate on a Library workspace query, not shared/Smart Collection membership snapshots. That is a separate required adapter before full TD4 closeout.
- Completion can be partial by design: permission loss, changed revisions, protected records and active locks cause skip/conflict counts, not permission bypass or blind retries. Cancel only stops future chunks.
- One durable job is fixed-batch and bounded; arbitrarily large batch orchestration is not implemented.

## Development evidence

New focused worker tests use the actual transpiled TypeScript function in an isolated transactional DB fixture, testing multi-chunk commits, replay after a lost progress acknowledgement, permission revocation, protected Records, edit locks, stale revisions, no-op tags, audit-failure rollback, cancel/resume and offboarded initiators. Inherited TD2 tool disable/re-enable ownership tests cover this job type. Source scans and inherited UI/Forms/Library regressions pass as recorded in `TD4_R34_SOURCE_VALIDATION.json`.

**Not certified:** No actual PostgreSQL migration run, runtime Fastify/Prisma/React multi-user test or installed Qt/Windows build. Source testing is not runtime proof.
