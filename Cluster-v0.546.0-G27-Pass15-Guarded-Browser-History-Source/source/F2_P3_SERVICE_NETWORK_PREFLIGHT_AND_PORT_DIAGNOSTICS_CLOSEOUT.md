# Cluster v0.546.0 | F2 P3 | Windows Service Network & Operational Preflight

**Authoritative parent:** `Cluster-v0.546.0-F2-P2-Windows-Job-Supervision-Readiness-Source.zip`, SHA-256 `9bcc421cc5855d291fd34ea3e6b7588d2354b0b31cdd34effdf1b85ca97af384`.

## Source changes in this pass

1. **Deterministic native-managed ports:** The Windows native launcher explicitly passes the validated `webHost` and `webPort` configuration to the Go Host and sets `--strict-ports`. A configured web port or private API port conflict now prevents managed startup rather than silently choosing a random port. The standalone Host still retains its earlier optional non-strict policy. Neither the code nor this document claims an atomic lease between preflight and bind.
2. **Configured listener preflight:** The Windows Service validates host syntax, HTTP(S) public URL shape, TCP port ranges, conflicting listeners (web/API and private PostgreSQL), then attempts short-lived local port acquisition for web and PostgreSQL before private runtimes start. Native settings reject inconsistent networking drafts **before writing the config file**. No firewall rules or network exposure are changed by this pass.
3. **Actual LocalService filesystem access:** On service startup, Cluster creates and removes only its own temporary probe files to verify that its restricted identity can write to data, system configuration, logs, runtime state, existing private PostgreSQL data, and configured external `dataRootOverride` and `uploadRootOverride`. The installer marker remains a prerequisite but is not mistaken for a successful runtime permission test. Missing network shares or unwritable mounts block service startup safely.
4. **Native service vs application health:** The Win32 control panel now executes a **single bounded, asynchronous local `/health/ready` check no more often than every ten seconds** while an installed service is running. It displays application readiness/degradation separately from SCM_RUNNING. Redirects are not followed, the response body is not retained, and TLS verification is not bypassed. A failure to reach the endpoint does not itself cause a service restart.
5. **Actual listening port owners:** The native Performance section now reads Windows TCP listening tables through `GetExtendedTcpTable`, showing the listener PID for configured web, private API (4100) and private PostgreSQL (54321) ports. Both IPv4 and IPv6 tables are parsed using correct endianness and strict byte-size bounds. Port occupation alone is not mislabeled PostgreSQL health. Service process RSS is labelled accurately instead of claiming all descendant memory.
6. **Pure behavioral tests:** Strict and permissive Go Host listener policies, native networking parser, occupied socket preflight, readiness HTTP 200/302/503/unreachable outcomes, storage ACL probes, and Win32 table parser fixtures. Added `cluster-f2-p3-service-network-preflight-tests.mjs` for integration contract checks.

## Source-focused verification

- New F2 P3 integration source contract: **59/59**.
- Go native networking, storage and TCP decoder fixture tests: passed; Go Host strict-port behavior tests: passed. Both modules pass existing Linux race-tested suites when using **temporary** Go 1.23-compatible manifests; final source keeps Go 1.27.1 requirements.
- Host and launcher cross-compile for Windows x64.
- Inherited source assertions: F2 P2 48/48, F2 P1 46/46, F3 P4 32/32, F3 P3 routing 79/79 and atomic save 25/25, F3 P2 durable incident 46/46 and readiness 50/50, API manager 40/40.
- Domain network/lifecycle/management: 139 + 32 + 27 source checks passed.
- Source scanner: 1,121 TS/TSX syntax files, 3,258 renderer relative imports and 110 CSS files structurally clean.
- Windows `go vet` still reports **two inherited `unsafe.Pointer` issues** in `launcher_ui_windows.go`; this pass does **not** claim complete Windows vet clearance.

## Important limitations

- Windows x64 cross-compilation is **not** execution on the target Windows Server/Windows 11. Real SCM, LocalService, network interface, firewall, TLS, NAS/SMB, IPv4/IPv6 PID table and process-tree tests remain mandatory.
- The native control panel still allows individual server-managed setting writes without the web UI's one-PIN atomic protected-save flow. That legacy administrative surface needs to be unified with canonical authorization before 1.0. Do not expose the panel to untrusted users.
- `serverPort` remains a public API configuration field distinct from the Go Host's internal private API listener (4100). A single authoritative Network Manager that resolves actual binding, proxy, TLS, firewall rule previews and rollback is still required.
- The control panel's local HTTPS probe uses normal certificate verification. A certificate issued only to a public hostname may make loopback/IP probing report unavailable. No unsafe skip-verify workaround was used. A future canonical endpoint/SNI-aware local probe is needed.
- Native process RSS does not yet include aggregated descendants. There is no automatic repair, firewall mutation, scheduled upgrade or restart in this pass.
- The independent emergency journal has not yet been reconciled into PostgreSQL Incident/Inbox after recovery; F3 P2/P3 migrations remain unapplied. No live Node 24/PostgreSQL 18/Qt/Garnet certification has been run.
