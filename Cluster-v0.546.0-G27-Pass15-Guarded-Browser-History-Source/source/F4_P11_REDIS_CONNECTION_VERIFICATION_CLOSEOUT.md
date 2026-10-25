# F4 P11: Verify acceleration protocol on every connection generation

Parent: F4 P10.

A Redis-compatible TCP connection is insufficient proof that Cluster's distributed rate-limiting and lease Lua scripts will work. Garnet may have Lua disabled even while PING, GET and Pub/Sub succeed.

- After Redis connection, PING and bus subscription, the acceleration runtime temporarily clears its distributed-ready flag and executes the complete F4 P8 namespaced command compatibility probe once.
- Only if all required primitives pass AND the command and subscriber clients are still ready does the runtime enable distributed acceleration and cache compatibility evidence.
- Failed compatibility triggers the existing connection cleanup and bounded reconnect schedule in `auto` mode, while memory is used. `redis-required` fails startup with a non-secret, actionable error.
- Reconnection runs the same gate: a formerly compatible instance is not trusted after a new connection generation.
- No new background task; no per-request probing. No PostgreSQL or Studio data is stored in test keys.

Validation: F4 P11 source integration 18/18 plus a 9/9 executable start/fallback/fail-closed simulation against a local mock RESP module, with 29/29 selected regression suites. This is NOT an actual Garnet server test. Actual Redis/Garnet socket behavior requires runtime certification on Windows 10. A protocol probe under heavy load may cause a conservative memory fallback; track this under 1.0 runtime acceptance. No migration.
