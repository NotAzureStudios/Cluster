# Phase 6 E2E Foundation

Cluster Phase 6.1-6.7 turns the existing production smoke runner into a repeatable integration environment rather than a single-user happy-path check.

## Clean environment

The runner requires built server and web artifacts, a real PostgreSQL test database, and a Playwright Chromium runtime. Each run creates an isolated PostgreSQL schema plus a temporary Cluster data/config directory, deploys migrations into that schema, launches the real server and web preview, and deletes the temporary runtime when the run ends.

No production database should be supplied to `CLUSTER_TEST_DATABASE_URL`.

## Authentication and session lifecycle

The scenario first uses a separate anonymous browser context to prove protected workspace APIs reject unauthenticated access. Two independent browser contexts then authenticate through the shared renderer. One client performs logout, proves its revoked session can no longer access `/api/me`, and completes re-authentication before collaboration tests continue.

## Authorization and mutation boundary

The authenticated owner context must be decorated with administrative/owner capabilities. A deliberately unprotected project mutation is then attempted without the CSRF token. The server must reject that write, proving the E2E environment is exercising the same authorization, origin, and CSRF boundary used by normal clients.

More granular role/department/user matrices continue to be covered by the authorization integration/unit suites and will be expanded in later Phase 6 checkpoints.

## Project lifecycle

The scenario creates a real project using the authenticated API mutation boundary and requires creation of a default Board, starter Whiteboard, and Library folder. The resulting Board and Whiteboard must both be readable through their protected resource endpoints before collaboration tests begin.

## Board realtime collaboration

Two browser clients join the same Board using different collaboration client IDs. Both send heartbeats and collaboration actions. The shared collaboration state must contain at least two client presences and the peer action must be visible from the primary client.

## Whiteboard realtime collaboration

The same two browser clients independently join the project Whiteboard with different client IDs. Presence and peer action propagation are required exactly as they are for Board collaboration.

## Evidence

The run writes `.cluster/e2e/production-e2e.json` with per-check duration, pass/fail state, Cluster version, browser, and Phase 6 scenario identifier. A release must not describe the runtime scenario as executed unless the runner actually completed against PostgreSQL and Playwright Chromium.

Runtime execution requires a real PostgreSQL test database and Playwright Chromium; source-only checks do not count as an executed E2E run.
