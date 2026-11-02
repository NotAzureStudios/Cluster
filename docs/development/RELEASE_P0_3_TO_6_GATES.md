# 1.0 release blockers 3–6: current acceptance gates

The 1.0 release is **not certified** by passing source tests. Development merges are not production distributions.

## 3. Separate Server and Desktop installers

- Server distribution is `cluster-server/server-windows-x64`. It includes the host, web/API runtime and private PostgreSQL, and **must exclude Qt Desktop**.
- Desktop distribution is `cluster-desktop/desktop-windows-x64`. Its native install/update identity is `0.482.0` until Qt parity verification, **not** Server source version `0.546.0`. Both the CPack/NSIS EXE and portable ZIP must use the Desktop version.
- `node tools/scripts/cluster-platform-release.mjs --list` and `--profile ... --channel ...` validate target separation. A release build requires a committed npm lockfile, Windows toolchains and a release build receipt, none of which can be inferred from CI planning tests.
- Sign and publish a product-specific artifact only after testing its own installation, uninstall, upgrade, file associations, permissions, rollback and native launch. Desktop **stable/beta** never download Server **main/development** bundles.

## 4. Signed updates and rollback

- Native Windows Server Manager Settings select `main` or `development` signed Server feed. That changes the selected distribution channel, not Git branch or installed files.
- `Check for updates` validates a signed metadata feed. Native console command `stage-update` (also `download-update`) fetches and verifies the exact signed installer bytes and stores an inert PE executable under `data/system/updates/<channel>/` with a non-executed receipt.
- This path verifies Ed25519 publisher key, product/target/channel, source origin, release sequence, size and SHA-256. It rejects untrusted redirects, changed bytes, older releases and existing staged targets.
- **Not yet implemented/certified:** an authorized install transition to maintenance, backup/restore-preflight before update, atomic application of a *prebuilt* Server bundle, database upgrade ordering, process supervision, startup health timeout, and automatic software rollback. The staged EXE is **not executed** by the command.
- Server source and Desktop signing/build receipts require a committed `package-lock.json`; do not bypass the gate to manufacture a release.

## 5. Restore verification and disaster recovery

- `runDatabaseRestoreDrill` creates an isolated PostgreSQL database, executes `pg_restore`, verifies migrations/count evidence and **reports failed temporary-database cleanup**. A TOC-only `pg_restore --list` is not proof of a valid restore.
- `replaceDatabaseFromBackup` now requires an explicit fresh safety-dump destination, verifies that the source is a regular file, runs the isolated restore drill, writes and verifies a safety backup before touching the live database, then issues DROP and CREATE in separate PostgreSQL commands. It attempts a verified restoration of the prior database after failure, and raises a combined error if that rollback fails.
- Restore is dangerous and **must run with Cluster in maintenance and all API writers stopped**. The database-only replacement does not restore external Library files or cross-resource storage revisions; full disaster recovery needs independent filesystem snapshots and hash verification.
- **Runtime gate:** real PostgreSQL 18.6 isolated drill on disposable data, intentional mid-restore failure, rollback count/migration comparison and external file archive verification. Do not run destructive restoration on production data to test it.

## 6. Authentication and permissions

- Browser-to-native Desktop session-code issuance and redemption require active, non-archived accounts and a complete login; codes are linked to the original source session and expire after one minute.
- Redemption rereads the issuing session from PostgreSQL and rejects session revocation, account offboarding/expiry, credential generation change, expired/idle session, pending MFA enrollment, or new MFA requirements not met by the original sign-in. One-time codes are consumed before the eligibility check, so a rejected token cannot be retried later.
- **Runtime gate:** separate users with different roles, disabled/suspended/offboarded accounts, expired contractors, partial MFA login, password reset and revoked source sessions; verify writes, Library downloads, search, and Desktop handoff cannot cross scope. Authorization remains server-side, never just UI visibility.

## CI coverage

`release-recovery-security.yml` runs Node 24 platform contract and auth/restore-source regressions plus Go Server update signing and staging tests on both Windows and Linux. Source hygiene tests continue independently. Passing this does **not** certify NSIS installation, Windows update application, a real PostgreSQL restore or multiuser authorization.

Next release work: commit a validated reproducible npm lockfile, build **both** real installers on Windows, exercise same-release in-place Server repair plus signed update/rollback, and execute PostgreSQL restore, Desktop integration and multiuser/offboarding acceptance drills. Targeted later-source fixes have already been merged into the tracked RC50 source; do not invent an RC74 branch or claim full external ZIP parity without evidence.
