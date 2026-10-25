# TD1 Pass 11 validation results

- **26/26** inherited Settings, TD0, TD1, TD2, config publication/recovery, tool registry, source audit commands passed on Node 22.16.0. See `TD1_PASS11_REGRESSION_LOG.txt`.
- **10/10** revised Account Settings tests passed, including two new post-read, pre-commit accent-only race cases. These ten are part of the 26 commands, not additional.
- Source audit: 993 active TS/TSX files, 0 syntax errors; 4,208 relative imports scanned, none unexpectedly unresolved (generated Prisma client omitted from lean source).
- PostgreSQL certification script: Node syntax check passed; execution **BLOCKED** (no PostgreSQL server or installed `pg` package and no authorization/env set). This is intentionally not counted as a pass.
- Full Node 24 build, generated Prisma, PostgreSQL 17/18 migration/transaction tests, Windows/Qt/NTFS recovery and multi-process tests **NOT RUN**.
- No Prisma migrations changed. Existing native executable byte-identical.
- Do not mark TD1 fully release-certified on this evidence.
