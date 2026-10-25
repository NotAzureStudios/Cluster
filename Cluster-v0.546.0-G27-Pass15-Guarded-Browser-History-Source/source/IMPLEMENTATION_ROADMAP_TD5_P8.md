# Cluster v0.546.0 | TD5 P8: runtime acceptance output and certification integrity

**Baseline:** v0.546.0 TD5 P7 (`e0774b3f0e1492d7a05d00ab5eaed441a29a62db7dcf4e454a8c4110b838cfa7`). TD4 stays source-closed. TD5 remains active.

## P8 source implementation

- Protect the disposable runtime acceptance log: bounded Prisma/build/migration/TD1/TD2 subprocesses now use piped stdout/stderr filtered by a shared credential stream redactor instead of directly inheriting unsanitized terminal output.
- Cover the complete authorized database URL, username, encoded/decoded password and URL query values. Split write chunks, lines, empty streams, timeouts and interrupted children cannot accidentally expose a partially received token. Late buffered child output after finalization is discarded safely.
- Continue to preserve the production subprocess's successful/nonzero exit status, bounded deadlines and subtree shutdown behavior.
- Sanitize the gate's own caught error descriptions using the same database-token inventory.
- Add new runtime-level executable tests for split credentials, mixed token prefixes, stdout+stderr output, UTF-8, process exit/failure, timeout and URL encoding; retain inherited P6/P7 tests.
- Refresh the canonical `CURRENT_CHECKPOINT.md` pointer, roadmap, results and continuation handoff.

## Verified development evidence

- **70/70** TD4/TD5 selected `.mjs` regression scripts passed independently against P8, with a *temporary global TypeScript toolchain link* removed before packaging. Additional P8 test runs cover **10/10 new checks**. P6/P7 gate and bounded subprocess regressions remain green.
- P7 live acceptance runner, called without `--run`, correctly reports `NOT_PERFORMED` because this host has Node 22.16.0, no reviewed npm lockfile, installed workspace packages or generated Prisma client, and no disposable PostgreSQL 18 server.
- No migration, native executable or Prisma schema modifications. Source-level tests are not live database or Windows acceptance evidence.

## Unfinished TD5 implementation and certification

1. Obtain pinned **Node 24.20.0**, *reviewed* workspace package lockfile, dependencies and generated Prisma client. Do not invent or assume dependency provenance. Run the gate only on an isolated machine with explicit disposable PostgreSQL 18 consent.
2. Actually run Prisma validate/generate, full build, migrations, independent-process job/outbox contention and crash/recovery tests. Capture redacted logs and repair concrete compiler/runtime errors.
3. Accept on native Windows/Qt, NTFS/SMB and real NAS/S3; independently verify native child shutdown and storage generations/quarantine recovery. Destructive provider operations remain disabled.

**Status:** TD5 P8 source checkpoint, **not a certified build**. A known database secret printed by a child is redacted, but other unknown credentials or non-database secrets in arbitrary application log output are not automatically detected. Keep logs private and reviewed.
