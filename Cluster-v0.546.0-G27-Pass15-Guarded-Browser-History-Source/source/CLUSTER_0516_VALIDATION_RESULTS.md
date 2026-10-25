# Cluster 0.516.0 source validation

- Baseline: original `Cluster-v0.515.zip` from preceding checkpoint; full authoritative Pass 15 reconciliation retained.
- Inherited source/mock-route regressions: **31/31 suites passed**, after supplying environment-installed TypeScript to this lean source's temporary `node_modules` (not packaged).
- Package device receipt policy: **34/34** focused assertions passed, including the new `content_selected` transition rules.
- Packet detached note-PDF engine tests: **14/14** with a mocked PDF renderer; actual pdf-lib runtime was **not** executed.
- Native package stager: **24/24** Go tests passed, including independent signing pin, stage, tampering rejection, content selection, rollback, symlinks, locks, unknown manifest fields and empty status.
- Node Ed25519 → Go interoperability: staging, selection, status, second-version selection, signed rollback and negative trust/replay tests passed.
- Source TS/TSX parse scan: **1,006** files, **0** syntax diagnostics; renderer direct relative import/export links: **3,024**, **0** missing; CSS: **108**, **0** basic delimiter issues.
- The source-manifest, ZIP integrity, and patch replay are checked independently during packaging. Full TypeScript semantic build, real Prisma/PostgreSQL and Windows/Qt runtime remain **unverified** and are not claimed.
