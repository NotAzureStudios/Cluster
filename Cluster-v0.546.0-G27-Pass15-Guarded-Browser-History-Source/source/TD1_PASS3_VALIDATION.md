# TD1 Pass 3 Validation

**Environment:** Node 22.16.0; source-only tests use TypeScript transpilation or inspect source contracts. No full project dependency tree or generated Prisma artifacts, no live PostgreSQL or Windows testing.

| Check | Result |
|---|---:|
| New TD1 provenance tests | 6/6 |
| TD0 | 9/9 |
| TD1 prior | 9/9 |
| TD1P2 | 8/8 |
| TD2 durable | 9/9 |
| TD1/TD2 closeout | 7/7 |
| TD2 Library | 7/7 |
| TD2 owned subscriptions | 7/7 |
| TD2 retained uploads | 9/9 |
| Settings conflict | 11/11 |
| Configuration writers | 23/23 |
| **Executable assertions** | **114/114** |
| Tool registry consistency (`tool:check`) | passed; 28 routes, 22 identities, 3 standalone modules |
| TS/TSX parse | 990 active files, 0 syntax errors |
| Relative import references | 4,200, one missing generated Prisma artifact |

Static-source contract tests do not establish that the production server/browser works. The packaged source and patch must be verified after archiving.
