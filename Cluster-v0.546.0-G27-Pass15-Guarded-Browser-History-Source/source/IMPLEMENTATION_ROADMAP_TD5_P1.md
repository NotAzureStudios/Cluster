# Cluster v0.546.0 | TD5 implementation roadmap | Pass 1

**Baseline:** TD4 R76.2 source-closed (SHA-256 `be762a18cd116800e553aa56f92532d4e7157a014f0bd9eafc8848def9a54db8`). TD5 is **active**. TD0–TD4 source-closure statements are preserved. This is an implementation checkpoint, not a release certificate.

## TD5 P1 completed in source

1. **Server drain/cleanup:** `server-lifecycle.ts` now attempts Fastify close and registered `onClose` resources even if an owner drain fails. It still reports the drain failure, preserves both causes if close also fails, and keeps concurrent shutdown single-flight.
2. **Native Host shutdown allowance:** the Go Host now waits 135 seconds for the managed API after its accepted shutdown request before interrupting it. Server config allows up to a 120-second close deadline, plus a 5-second managed process watchdog.
3. **Windows panel supervisor:** normal stop, UI close, and restart paths allow 150 seconds before force-killing the Host tree. Old 15–20-second fallbacks could preempt a valid API drain. Startup readiness watchdog remains separate and requires native acceptance.
4. **Version-contract consolidation:** `config/toolchain-versions.json` now names the canonical `0.546.0` version. Studio server/Web/shared/native source manifests were synchronized with the existing `toolchain:write` mechanism. Qt Desktop's deliberate `0.482.0` parity hold is preserved. Native Host and Server Launcher build scripts now read the canonical manifest instead of defaulting to `0.505.0`.
5. **Runtime preflight:** `npm run techdebt:td5:preflight` reports environment blockers and available-but-unverified tools without claiming startup, migration, or native acceptance. `--strict` fails if prerequisites are missing.

## Current environment and evidence

- Node v22.16.0: wrong major for required Node v24.20.0; dependency-backed full build **blocked**.
- Go v1.23.2: below pinned v1.27.1; tests and Windows cross-compile succeeded only with a temporary test-copy `go.mod` downgrade. Checked-in requirements remain unchanged.
- JavaScript: six new executable server-lifecycle cases passed; 61/61 inherited TD4 regression scripts passed; source scan found no authored parse or relative-import errors.
- Go: Host, Server Launcher, Workstation, Update Helper unit suites passed in temporary compatibility copies; Windows amd64 test-binary cross-compilation succeeded for all four; package-stager suite passed on the available installed toolchain.
- Full `tsc` of the lean server still fails with 2,898 diagnostics due to missing dependencies/generated Prisma; the current source has **zero new normalized diagnostic signatures** versus untouched R76.2.
- Node modules, generated Prisma, real PostgreSQL server, Qt 6.11, and native Windows run evidence remain absent. No production claims.

## Next TD5 implementation target

1. Restore pinned Node/Go/Prisma dependencies on a supported machine and capture a full compile/build matrix without editing the locked contracts to match older local tools.
2. Run disposable PostgreSQL 17/18 migrations, concurrent Library post-commit/fault-injection tests, background outbox/lease contention, and restart recovery.
3. Windows/Qt process-tree tests: idle and busy shutdown, slow drains (30/120 s), stop during startup/migration, multiple instances, 100/125/150% DPI, and `cluster://` protocol activation.
4. Provider capabilities: reversible quarantine, backup policy and generation-fenced mutation must be implemented and proven independently before allowing physical deletion, GC or auto migration.
5. Continue necessary TD5 native/diagnostic integration; TD6 remains owner of missing application workflows.

**Source-scope decision:** P1 advances TD5 but does not source-close or runtime-certify it.
