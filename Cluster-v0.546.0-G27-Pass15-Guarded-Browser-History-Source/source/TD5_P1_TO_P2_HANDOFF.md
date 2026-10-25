# Cluster TD5 P1 -> P2 handoff

Use the **Cluster v0.546.0 TD5 P1** archive as the updated source baseline. It contains TD4 R76.2 intact plus runtime shutdown reliability, aligned native process budgets, canonical version defaults, and a non-certifying environment preflight.

## Preserve

- TD4 R76.2 Library postcommit, transfer and disposal safeguards. Do not re-enable physical disposal, auto-GC or tier migration.
- Shared `server-lifecycle.ts` single-flight stop behavior. Drain errors now trigger best-effort `app.close()` and still fail shutdown. The host and panel must not kill the API before its configured 120-second drain + watchdog.
- Source-control, Forms, approval Search/Action and all TD4 source closure contracts, including the 61 inherited regression checks.
- Root/Studio package/Go version contracts at `0.546.0`, with Qt Desktop parity-hold version `0.482.0` intentionally separate. Native build scripts read `config/toolchain-versions.json`.

## Source-level results

See `TD5_P1_TEST_RESULTS.json` and `TD5_P1_NATIVE_RUNTIME_AUDIT.md`. Tests used available Node 22 and temporary Go 1.23 compatibility copies, **not** the required Node 24/Go 1.27.1. `npm run techdebt:td5:preflight -- --json` can capture local blockers without exposing credentials.

## P2 priority

Start with a supported toolchain and actual generated Prisma; run real PostgreSQL integration and native Windows process-supervision acceptance. Once established, close reproducible bugs, not generic architectural hypotheticals. Keep the separate release-certification ledger as the only source of truth for runtime certification.
