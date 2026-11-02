# Cluster RC36 | Required Windows certification

This checklist describes **outstanding tests**. Nothing in this document claims that they passed.

## A. Reproducible build (P0)

1. Use a **disposable extracted source directory**, not an active `Cluster\\Server` runtime directory. Preserve the installed server and database.
2. On Windows x64 confirm private Node **24.20.0**, Go **1.27.1**, and a compatible private PostgreSQL **18.6** service. Run `node -v`, `npm -v`, and `go version`.
3. Review and commit a real npm v3 `package-lock.json` produced from the approved package manifests. Never synthesize one with guessed dependency checksums.
4. From a fresh copy, run `npm ci --include=dev --no-audit --no-fund`, then with a deliberately **nonworking** build-only PostgreSQL URL run `npm run db:generate` and `npm run build`. Prisma generation must not modify production data.
5. Run `node tools/scripts/cluster-rc36-source-checks.mjs`, `node tools/scripts/cluster-rc-native-checks.mjs`, and `node tools/scripts/cluster-rc-preflight.mjs --built`. Archive command status and compiler output after redacting secrets.
6. Rebuild the installer with the matching source archive, verify its embedded revision and install on a fresh disposable Windows machine. Check startup, shutdown, no orphaned child processes, update, rollback and repair. Do not copy an old installer and rename it RC36.

## B. Database, access and recovery (P0)

Use **disposable data and backed-up installations**. Run the strict TD5 PostgreSQL gate only with its documented disposal acknowledgement and a verified empty `cluster_td5_cert_*` database. Test fresh migration, version gates, login/Owner PIN, MFA, A/B isolation, revoked permissions, cache invalidation, backup, crash recovery and restore. Never aim destructive certification against live studio data.

## C. User workflows (P0/P1)

Exercise complete Projects → Board/Whiteboard/Ticket → Timeline/Calendar → QA/Build → Release, Inventory custody, Vault protected reveal, Library file download/upload, Scheduler approvals, and background transfers. Test interruption, retries, insufficient storage, browser close/reopen, offline reconciliation, account switch, and slow/no-network conditions. All sensitive writes must be authorized server-side.

## D. Performance acceptance (P0)

Test 1/2/5 sessions against identical datasets. Measure cold and warm navigation for Home (many widgets), Projects, Timeline, Boards, Whiteboards, Settings, Inventory, Vault and Transfer Center. Switch Home/Timeline/Projects/Settings at least 20 times; record requests per transition, p50/p95 endpoint latency, idle requests, React long tasks, page memory and HTTP 429 buckets. Investigate every repeatable ordinary-navigation 429 or request storm. Validate cached-first UI after actual mutations and access revocations.

## Stop conditions

A build/compiler failure, missing dependency lockfile, failed installation, data loss, security leak, unverified restore, broken critical transfers, server that cannot stop cleanly, or repeatable request storms blocks Cluster 1.0 stable. Source-only smoke tests are not substitutions.
