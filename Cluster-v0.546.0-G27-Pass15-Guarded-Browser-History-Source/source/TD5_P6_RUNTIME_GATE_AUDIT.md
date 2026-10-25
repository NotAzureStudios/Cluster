# TD5 P6 | Build, PostgreSQL acceptance and database secret audit

## Confirmed issue

`tools/scripts/database-config.mjs` had an executable diagnostic entrypoint that serialized the entire configuration object. That object included `databaseUrl` and `directUrl`, exposing connection usernames, passwords and potentially credential-bearing query parameters into terminal output and copied logs. The normal database command already printed a redacted connection URL, but the standalone diagnostic did not.

## Correction

The direct CLI entrypoint now selects a deliberately limited diagnostic projection, applies URL redaction to both connection strings, and removes unfamiliar query parameter values. The operational `loadDatabaseConfiguration` return object still supplies full secrets to the authorized internal database-command invocation; Prisma behavior is not modified. A direct URL with a non-PostgreSQL scheme now fails before invocation.

## Runtime gate implementation

The new P6 runner is **read-only by default**. `--run` first verifies a literal `cluster_td5_cert_*` database name, explicit disposable consent, pinned Node version, a matching npm lock, installed dependencies, actual PostgreSQL 17/18 server identity, writable-primary status, and an empty database inventory. It then runs the real Prisma CLI and workspace build plus pre-existing TD1/TD2 SQL integrations. Every step must complete before a pass is reported. Output never deliberately includes database credentials. Production database names are rejected.

### Security limitations

- The gate is intended for an operator-provisioned **disposable** database. Its database-name convention is an additional guard, not proof that a host has no production data.
- A successful gate would verify full schema deployment and a dependency-backed build, plus narrowly scoped TD1/TD2 SQL tests. It would not verify the full live application workflow, native OS, storage-provider durability, data-loss recovery, or deployed binaries.
- Dependency-lock creation and installation require networked/pinned tools and security review; no guessed/generated lockfile was inserted into this lean archive.
- Failures from external CLIs might print their own diagnostic details to the local terminal. Treat CI logs as sensitive and never share connection strings.

## Executed results in this environment

- Node 22.16.0, Go 1.23.2; neither meets the pinned runtime targets.
- `package-lock.json`, workspace `node_modules`, generated Prisma client and a running PostgreSQL server are absent. The `pg_config` utility alone does not constitute a PostgreSQL server.
- P6's 8/8 focused tests pass, including credential-redaction and protected database refusal.
- The 67 inherited TD4/TD5 executable test scripts pass in Node 22 with the temporary global TypeScript module link removed after execution.
- Active TS/TSX, CSS and authored import scan passes. Expected generated Prisma client import remains unavailable until generation.
- **Node 24 build: not executed. PostgreSQL migrations and two-session certification: not executed. Windows/SMB/S3: not executed.**
