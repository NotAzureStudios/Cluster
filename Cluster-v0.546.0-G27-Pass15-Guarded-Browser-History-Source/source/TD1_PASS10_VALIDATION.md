# TD1 Pass 10 validation (source-only)

- Executable Account read-version tests: **8/8 passed**.
- Source writer-inventory guardrail tests: **6/6 passed**.
- Inherited TD0–TD2, Tool Registry, Studio Settings and crash-recovery test commands: **26/26 passed**; see `TD1_PASS10_REGRESSION_LOG.txt` in this source archive.
- All tests used Node **22.16.0** in a dependency-light source fixture; selected TypeScript files are transpiled for test harnesses.
- **Not executed:** full workspace typecheck/build, generated Prisma client, live PostgreSQL migrations or concurrency tests, Windows/Qt runtime, and native crash recovery.
- See `TD1_PASS10_SOURCE_CLOSEOUT.md` for the mandatory release-certification matrix.
