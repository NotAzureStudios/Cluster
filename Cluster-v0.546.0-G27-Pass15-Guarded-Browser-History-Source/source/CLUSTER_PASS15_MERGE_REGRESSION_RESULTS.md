# Cluster Pass 15 source merge validation

- Original Pass 15 ZIP SHA-256 equals the trusted handoff digest.
- Three-way source comparison: 16 divergent files explicitly resolved, two jointly edited high-risk files reviewed, 1808 files in initial merged projection before validation metadata and fixes.
- 27/27 current source regression suites pass (see bundled regression log summary).
- 23/23 historical Pass 14 behavior/assertions pass.
- 20/20 new authoritative merge integration assertions pass.
- 6/6 synthetic three-way merger fixtures pass, including multi-hunk conflict exit-code handling.
- Standalone historical Pass 15 assertions: 17/23 pass. Failing six are representation-focused checks for historical navigation IDs, old profile API (`exposure` vs canonical `classification`), old UI selector implementation, and historical source verification wiring. The functional equivalents are tested in the modern merge assertions. We do NOT claim the old Pass15 suite passes unchanged.
- Full TS/TSX parser, relative import and CSS syntax checks pass.

**Not performed:** full pinned dependency-backed TypeScript/Prisma compile, live PostgreSQL migration and concurrent users, native Windows/Qt/Go compilation, runtime certification.
