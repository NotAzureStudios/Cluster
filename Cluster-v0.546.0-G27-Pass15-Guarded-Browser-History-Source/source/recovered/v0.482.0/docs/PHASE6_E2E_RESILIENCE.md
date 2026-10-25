# Phase 6 Resilience and Failure-Recovery E2E

Cluster v0.409 completes Phase 6.17-6.27 by extending the production E2E harness from normal multi-client workflows into bounded failure and recovery scenarios.

The standard run now covers external-integration failure containment, server restart with authenticated clients, browser-network loss and reconnect, stale offline-style conflict handling, Web plus desktop-compatible concurrent clients, malformed/hostile requests, and a bounded health/session/collaboration soak. The same evidence report remains rooted in an isolated PostgreSQL schema and independent Playwright browser contexts.

Database process restart cannot be safely or portably invented by the application test runner because CI may use a local service, Docker, or a remote managed database. Chaos mode is therefore explicit. Set `CLUSTER_E2E_CHAOS=1` and provide `CLUSTER_E2E_DATABASE_STOP_COMMAND` plus `CLUSTER_E2E_DATABASE_START_COMMAND`; the harness executes those operator-owned hooks and then proves Cluster recovers. A chaos run fails if the hooks are missing.

The soak defaults to 15 seconds for normal CI and can be raised with `CLUSTER_E2E_SOAK_MS`, capped at five minutes by the harness. Release certification can run a longer external soak separately while retaining the same scenario contract.

Live execution still requires a real PostgreSQL test database, built Server/Web output, Playwright, and Chromium. Source/audit validation proves the regression contract is present; it does not claim the runtime scenarios executed when those dependencies are absent.
