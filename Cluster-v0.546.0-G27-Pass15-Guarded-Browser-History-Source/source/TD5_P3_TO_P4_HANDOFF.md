# TD5 P3 → P4 handoff

**Canonical source baseline:** `Cluster-v0.546.0-TD5-P3-Storage-Path-And-Integrity-Source.zip`, after verification against its integrity report. It supersedes P2 and carries all TD4 R76.2 closure fixes and TD5 P1–P2 improvements.

**New P3 code:**
- `apps/server/src/core/storage/local-storage-provider.ts`: path-component validation, source-FD identity and local read/stat/list/delete handling.
- `apps/server/src/domains/projects/project-asset-routes.ts`: report completeness, local-only missing evidence, repair guard, per-file 503 behavior, postcommit Activity tolerance.
- `packages/renderer/src/features/projects/ProjectAssetWorkspace.tsx`: incomplete/unavailable reporting and disable-while-unverified controls.
- `tools/scripts/cluster-td5-p3-path-and-integrity-tests.mjs`: 20 executable safety cases; P2 fixture adapted to check its original I/O-failure contract with an existing directory.
- `package.json`: `techdebt:td5:p3:integrity` command.

**Development evidence:** 61/61 inherited TD4 scripts; 12/12 P2 filesystem tests; 20/20 focused P3 tests; source scan 1,040 TS/TSX, 110 CSS, 4,498 authored relative imports; no new normalized server TS diagnostic signatures vs P2. Check `TD5_P3_TEST_RESULTS.json` and the external full logs. The lean source package cannot complete a real dependency-backed Node 24 compilation.

**Next:** Prioritize real pinned toolchains, disposable PostgreSQL and Windows/SMB acceptance. Do not reopen TD4, enable physical file disposal, or claim storage-provider certification from these source checks.
