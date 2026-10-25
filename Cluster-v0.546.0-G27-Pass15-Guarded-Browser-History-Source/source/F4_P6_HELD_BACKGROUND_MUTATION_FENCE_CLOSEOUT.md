# Cluster v0.546.0 — F4 P6 Held-Mode Background Mutation Fence

Parent: F4 P5. This pass complements the F4 P3 HTTP request write fence. A request guard alone does not stop background callbacks from performing write-capable work.

- Centralized `mayRunBackgroundMutation` permits write-capable background jobs only while mode=`normal`, startup completed and the server is not draining.
- Applied before durable dependency incident reconciliation, incident escalations, native incident import, distributed rate-limit pruning, integrity scanning, storage lifecycle processing and browser-direct-upload capability probes.
- Held/read-only/recovery modes may retain bounded diagnostic sampling and configuration reconciliation; they do not run the above scheduled write-capable callbacks.
- Existing workers are not duplicated or unregistered. Scheduled no-op callbacks return a bounded delay. Startup's already-existing event and durable job runtime suppression outside `normal` remains intact.
- Existing F3 P2 and F3 P4 source-contract tests were updated to recognize the stronger centralized check and new supervisor route instead of asserting retired source literals.

Verification: 38 new direct assertions, 23 selected source test scripts passed; Go Host test and race suites and Windows x64 cross-compilation passed using an uncommitted Go 1.23 compatibility manifest; structural scan 1,129 TS/TSX files, 3,258 renderer relative imports, 110 CSS files with no reported structural failures.

**Not claimed:** complete elimination of all startup/configuration database writes; authorization of live maintenance transitions; complete external worker and native supervisor quiescence; database-backed upgrade/restart transactions; pinned Go 1.27.1, Node 24, Windows 10, PostgreSQL 18, actual service or browser runtime certification.
