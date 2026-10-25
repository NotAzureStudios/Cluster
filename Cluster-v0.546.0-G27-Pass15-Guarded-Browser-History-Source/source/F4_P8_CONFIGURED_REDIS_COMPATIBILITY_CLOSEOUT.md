# F4 P8: Redis/Garnet operator compatibility check

Parent: F4 P7. The existing acceleration backend (`memory`, `auto`, `redis-required`) and configured Redis command/subscription client remain authoritative. **No second Redis connection settings system or background health polling is introduced.**

- Admin-only, no-store `POST /api/admin/operations/acceleration/compatibility-check` accepts a strict empty body and targets *only the active configured command client*.
- `runRedisProtocolCompatibility` tests PING, expiring SET/GET/PTTL, SET NX PX, lease release Lua EVAL, rate-limit Lua EVAL and temporary Pub/Sub delivery.
- Checks use a random namespaced key set, temporary subscription and bounded best-effort cleanup. Probe results are cooled down for 120 seconds; concurrent calls share one run. Error text and keys are never reflected in results.
- New on-demand Operations → Systems & Integrations panel shows per-command support and distinguishes an unavailable backend from an incompatibility.
- This tests the *configured Redis-compatible RESP command subset*, **not** product identity, performance, durability or OS support.

Garnet's current documentation explicitly says Lua scripting requires `--lua`; Pub/Sub must not be disabled (`--no-pubsub`). It is not a 100% Redis replacement. References: https://microsoft.github.io/garnet/docs/welcome/compatibility and https://microsoft.github.io/garnet/docs/getting-started .

Focused compatibility assertions: 54/54 with fake Redis transport. **Real Garnet on Windows 10 is NOT CERTIFIED**. No new Prisma migration.
