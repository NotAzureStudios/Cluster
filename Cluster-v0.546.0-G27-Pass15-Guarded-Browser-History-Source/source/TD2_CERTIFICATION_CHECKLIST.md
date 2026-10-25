# TD2 runtime certification checklist (NOT YET EXECUTED)

**Preconditions:** disposable Cluster server/workspace, test accounts/fixtures, PostgreSQL 17 or 18 on a test instance with verified backup, Node 24.20.x and fully installed workspace dependencies, generated Prisma client. Do not run destructive migrations on an existing studio without backup. Track environment, commit/hash, results, logs and any regression fixes.

1. Run dependency-backed `npm run db:validate`, `npm run db:deploy`, `npm run db:generate`, `npm run build`, and TD0–TD2 suites. Record compiler and Prisma diagnostics (not merely syntax parsing).
2. Start **two separate Cluster server processes** with a shared test DB. Enqueue Calendar scans, Library transfer finalizations and derivatives, Ticket-dependent Project rules, and independent Project/Board rules.
3. Disable each tool from server A while server B has pending and active jobs. Verify durable deferred work, retry counts, per-claim lease tokens, no new forbidden writes, and continuing shared background maintenance.
4. Force loss of a worker lease and re-claim on the other process. Confirm old owner cannot heartbeat, update progress, defer, succeed or fail the replacement claim; test process termination while claims are pending.
5. With Library disabled for longer than the upload staging retention threshold, verify a queued transfer's source cannot be deleted. Restore Library and verify checksum/canonical blob/derivatives with no duplicated file effects.
6. Open multiple Calendar/Library collaboration streams, toggle the tools, and record close/cleanup/reconnect behavior across both processes. Verify Project/Board rooms remain connected.
7. Test manual Project rule execution and delayed/branched actions targeting Tickets, Calendar, Scheduler and Timeline while those tools are disabled; verify no new writes or false success; re-enable and verify appropriate resume.
8. Measure three equivalent 15-minute windows, on the same dataset and idle user load: all enabled, target tool disabled, and re-enabled. Record per-process CPU %, RSS, query count, HTTP request count, active SSE streams, background claims/deferrals and queue depth. Compare both absolute and relative values and investigate unexpected increases.
9. Exercise graceful shutdown, host watchdog, and restart on Windows with busy work, unreachable PostgreSQL, and recovery. Confirm no stranded background child processes; verify no unsafe filesystem interruption.
10. Attach logs, profiling results and screenshots to the TD2 release checklist. Mark each requirement **PASS/FAIL/BLOCKED**, and close TD2 only if safety behavior and measured resource baselines are demonstrated.

This checklist is a runnable *procedure*, not a claim of test execution. External side effects remain at-least-once unless each operation has explicit idempotency/transactional protection.
