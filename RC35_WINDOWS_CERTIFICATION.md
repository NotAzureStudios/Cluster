# Cluster 1.0 | RC35 Windows certification runbook

This is the remaining **required evidence**, not a claim that release certification occurred.

## Build machine and lockfile

- Use Windows 10/11 x64, Node.js `24.20.0`, npm compatible with bundled Node, Go `1.27.1`, PostgreSQL `18.6` from the Cluster installer.
- Prepare a clean disposable build directory; protect or back up `D:\Cluster-Server\Cluster\Server` and the database. Never overwrite live installation data with a development-source ZIP.
- In extracted source, run:

```powershell
node --version
npm --version
go version
npm install --include=dev --no-audit --no-fund
npm run db:generate
npm run build
node tools/scripts/cluster-rc35-release-closeout-tests.mjs
node tools/scripts/cluster-rc35-source-audit.mjs
node tools/scripts/cluster-rc-smoke.mjs
```

- Fix any TypeScript or bundling errors and rerun **from clean extraction**, not an incremental compiler cache.
- Generate the first committed `package-lock.json` from the approved toolchain and audit workspace dependencies. Then test a **fresh `npm ci --include=dev`**; do not treat a local `npm install` as proof of reproducibility.
- Build native Windows launchers and verify their PE artifacts with `node tools/scripts/cluster-rc-preflight.mjs --built` after successful complete build. Never declare a candidate ready on a source syntax scan alone.

## Live server and data safety

- Fresh PostgreSQL setup, applied migrations and generated Prisma Client; upgrade from backed-up previous RC; rollback to previous binary/configuration.
- User A/B isolation, revoked access, cached content, logout/login, Desktop switching servers, offline queue, account scope, reconnect and version gating.
- Large and interrupted downloads/uploads, chunk retries, hash validation, retry/resume, graceful shutdown while transfer active, disk-space exhaustion, Network/NAS failure and restore.
- Security-critical authentication/reauthentication/PIN MFA rate limits remain bounded and independently tested.

## Performance acceptance

Run with 1, 2 and 5 simultaneous authenticated browser/desktop sessions; record warm and cold results separately. Include Home with many widgets, Projects, Timeline, Boards, Whiteboards, Settings, Inventory and Vault.

1. Record `navigationStart` to meaningful content, API endpoint P50/P95, browser memory, rendering long tasks and network/IndexedDB work.
2. Revisit Home ↔ Timeline ↔ Projects ↔ Settings quickly at least 20 times. Record HTTP 429 count and `X-Cluster-Rate-Limit-Bucket` when any occurs, query/cache hits, forced revalidations, and repeated reads.
3. Measure idle background requests and CPU use in a visible tab and after 5 minutes hidden.
4. Test mutations and realtime invalidation on two accounts. Neither stale offline cache nor a late network response may restore revoked/private data.
5. Verify real client cancel on navigation is not presented as a timeout; server-side request timeouts still show a real error.
6. Monitor the server logs and background workers for reconnect storms and unbounded activity.
7. Capture before-and-after traces against **identical datasets**; static tests cannot establish user-visible speedups.

## Hard stop before 1.0 stable

Any build failure, data loss, privacy/authorization leak, unverified restore, unbounded API storm, repeatable 429s in ordinary navigation, broken critical transfer recovery or failed shutdown/restart is a release blocker. No P0/P1 exemptions from passing smoke scripts.
