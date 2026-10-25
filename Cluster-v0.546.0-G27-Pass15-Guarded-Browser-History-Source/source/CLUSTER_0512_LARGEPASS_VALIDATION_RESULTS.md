# Cluster v0.512.2 | Source-level validation

- Inherited + newly added focused suites: **25/25 passed** (0 failed).
- New behaviors exercised: release ZIP consistency/integrity and source isolation, admin revocation/rollback/races, notification duplicate materialization/concurrent retries, Discord repair and adaptive scheduling.
- Repository parse: **999** TS/TSX, **0** syntax diagnostics.
- Relative renderer module imports: **3,014**, **0** unresolved.
- CSS delimiter scan: **108** CSS files, **0** brace errors.
- Independent Python ZIP reader successfully opened the generated 3-entry ZIP and verified both note SHA-256 checksums against its detached manifest.
- **Not executed:** full TypeScript typecheck (no dependencies/generated Prisma client; Node runtime 22.16.0 instead of required >=24.20.0), PostgreSQL migrations/transactions, native Windows/Qt, browser and multi-user end-to-end security tests.
- This development source is **not** a production build or certification.
