# Cluster v0.546.0 — F4 P5 Supervisor Readiness for Intentionally Held Modes

Parent: F4 P4. Source-only, not tested with the installed Windows 10 service.

**Bug fixed:** the native Host used `/health/ready` to classify Node API startup and continuous readiness. That endpoint correctly returns 503 during planned `maintenance` and `recovery` runtime modes. Consequently an intentionally held, dependency-healthy server was misclassified as failed and could trigger restart attempts and operator alarms.

- Added read-only, no-store `/health/supervisor` endpoint with a separate `cluster-supervisor-readiness-v1` contract. Returns HTTP 200 only when Node has reached server-ready and is not draining, and both DB/storage probes are healthy. Reports the actual access mode and separately describes whether workspace traffic or mutations are accepted.
- API `/health/ready` remains a client-facing workspace-admission contract. Held maintenance/recovery returns 503; no relaxation of the API read/write fence.
- Go Host initial `waitForAPI` and native periodic readiness watcher now use `/health/supervisor`; browser-facing native panel continues inspecting `/health/ready` for the separate workspace status.
- 141 focused assertions; Go Host unit/race tests and Windows x64 cross compilation pass using a *temporary* Go 1.23 compatibility manifest. The committed Go 1.27.1 pin was not changed.

**Not certified:** real Windows Service behavior, failure/restart policy in maintenance mode, actual PostgreSQL and Windows 10 runtime, offline/isolated database recovery in `recovery` mode. A failing database/storage probe still returns 503 and is not disguised as healthy.
