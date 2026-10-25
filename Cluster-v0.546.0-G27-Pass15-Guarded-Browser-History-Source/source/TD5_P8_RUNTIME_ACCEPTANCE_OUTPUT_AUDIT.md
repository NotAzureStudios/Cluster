# TD5 P8 acceptance-output security audit

## Observed defect

The P6/P7 disposable acceptance gate supplied live `DATABASE_URL` and `DIRECT_DATABASE_URL` credentials to npm, Prisma, migration and database-test subprocesses while using `stdio: 'inherit'`. The gate's top-level summary masked URL values, but **the child process could print raw passwords and connection URLs directly into the operator terminal or collected CI logs**. A build failure could therefore leak credentials even without a successful PostgreSQL connection.

## Source correction

- `cluster-td5-acceptance-redaction.mjs`: extracts known URL, username, encoded/decoded password and query-value tokens. Stream redaction holds incomplete prefixes across arbitrary child stdout/stderr `data` events and matches longer tokens before their shorter prefixes. It also handles split UTF-8 bytes.
- `cluster-td5-acceptance-process.mjs`: for sensitive subprocess steps, attaches streaming output filters to `pipe` streams. Preserve exit status, timeout, signal, bounded child process termination, and make delayed output after shutdown safe to discard.
- `cluster-td5-p6-runtime-gate.mjs`: passes the actual database redaction list and requests piped output for each acceptance step, and masks its own errors. The historical file/script name remains unchanged for compatibility with existing test commands.

## Executable verification

The P8 tests spawn a real Node child that prints the connection URL across separate writes to stdout, writes the password across separate stderr writes and exits nonzero. The observed output is `[REDACTED]` in both channels and the exit code remains nonzero. Additional checks exercise per-byte stream writes, overlapping token prefixes, UTF-8 boundaries, missing secret inventory and timeout shutdown. P6/P7 inherited tests are retained.

## Explicit limits

This is *known database credential* redaction, not a general secret detector. Unknown API tokens, key material or arbitrary credentials can still enter logs. Independent CI/logging policy should restrict access and retention. No live PostgreSQL, Windows `taskkill` or pinned Node 24 test was performed here. The no-`--run` gate is read-only and correctly reports `NOT_PERFORMED`.
