# TD5 P1: native lifecycle and build-readiness technical audit

## Reproduced source defects

### A. Drain errors bypassed resource cleanup

`createServerLifecycle().shutdown()` previously awaited `onDraining` and only then called Fastify `app.close()`. If an owned background subsystem threw, no `app.close()` invocation occurred, so `onClose` hooks used for Prisma disconnect, runtime marker cleanup and other resource release did not execute. **Fix:** always attempt close after a failed drain, propagate the drain failure, and combine both failures if close also fails. Regression cases cover normal order, rejected drain, thrown `undefined`, dual failure, concurrent stop, and bootstrap failure.

### B. Native supervisors cut off valid drains

API shutdown is configurable up to 120 seconds with an additional 5-second process watchdog. The Go Host used to wait 12 seconds before signaling Node, followed by a 3-second kill window; the Windows Server panel used 15/20-second hard-kill windows. This contradicted the API's advertised drain contract and could terminate durable workers prematurely. **Fix:** Host graceful API window 135 seconds; Windows panel fallback 150 seconds, including restart and UI exit. Idle stops still complete immediately when the child exits. The distinct 75-second startup readiness watchdog was not changed in this pass and requires later integration testing.

### C. Product version contracts drifted

Root version was 0.546.0, the canonical toolchain file still 0.521.0, server package 0.524.0, shared constant/server default 0.520.0 and Go sources 0.508.0-dev. Two native build scripts silently defaulted to 0.505.0 when `CLUSTER_VERSION` was unset. **Fix:** canonical contract to 0.546.0, synchronized with existing version writer, and native build-script defaults now read the manifest. Do not overwrite the separate Qt Desktop version hold.

## Constraints and exclusions

Go Test on Host/launcher/workstation/update-helper used **copied source** with `go.mod` go 1.27.1 temporarily changed to 1.23.2 because the environment had no toolchain downloader network access. All four copied packages passed native Linux Go tests and Windows amd64 test-binary compilation. These results are not proof of building with Go 1.27.1 nor of Windows runtime behavior.

Node 22 test suite and source parsing do not substitute for Node 24.20.0, dependency-backed TypeScript, generated Prisma, PostgreSQL transactions, Qt 6.11.2 or real NAS/S3 recovery. The new preflight distinguishes `ready`, `blocked`, and `available-unverified`; it never labels a runtime feature certified.
