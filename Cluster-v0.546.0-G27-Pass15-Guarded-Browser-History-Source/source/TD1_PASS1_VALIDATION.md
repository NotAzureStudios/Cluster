# TD1 Pass 1 validation evidence

| Check | Result | Limits |
|---|---|---|
| `npm run techdebt:td1:check` | **9 / 9** | In-memory database mock and static code contract checks; not HTTP+Postgres |
| `npm run techdebt:td0:check` | **9 / 9** | Inherited TD0 checks |
| `cluster-0506-settings-conflicts-assertions.mjs` | **11 / 11** | Existing CAS writer tests |
| `cluster-0506-config-writers-assertions.mjs` | **23 / 23** | Existing settings/config writer tests |
| Active application/shared TS/TSX syntax parse | **991 files, 0 errors** | Does not prove typechecking |
| Relative imports | **0 unresolved** | Excludes generated Prisma client |
| Standalone shared Tool Config contract `tsc` | **Passed** | Targeted module only |
| Full dependency-backed build | **Not run** | Archive lacks `node_modules` and generated Prisma client |
| Live PostgreSQL two-admin requests | **Not run** | Requires configured server + database |
| Qt/Windows and browser UI | **Not run** | Requires actual runtime |
| Database schema/native exe | **Unchanged** | No migration/native build needed in this pass |

**No production certification is claimed.** This pass strengthens source consistency and supplies regression checks for the original failure mode.
