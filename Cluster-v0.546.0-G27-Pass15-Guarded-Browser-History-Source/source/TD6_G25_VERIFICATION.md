# G25 Workstream 1: verification ledger

| Check | Observed result | Confidence limit |
|---|---|---|
| New discussion thread-read tests | 7/7 pass | Mocked Fastify/database |
| New detached Calendar tests | 10/10 pass | Mocked Fastify/database |
| G24 discussion and G23 collaboration suites | Passed | Controlled source regressions |
| G20/G21/G08/G06 Calendar tests | Passed | Controlled source regressions |
| Inherited project/Board/Whiteboard/other G24 tests | Passed | Controlled source regressions |
| TD5 source-closeout | 14/14 suites, 167/167 cases | No native or live-provider testing |
| TS/TSX source scan | 1,068, no syntax errors | Not full `tsc` |
| Renderer imports | 3,187, no missing authored relative imports | Not module runtime validation |
| CSS source scan | 110, no delimiter errors | Not authenticated UI screenshot or accessibility certification |

After packaging, separately verify source manifest, ZIP integrity and G24→G25 patch reproduction. Logs are execution evidence but do not replace live Node24/Prisma/PostgreSQL/Windows/Qt runtime qualification.

## Workstream 2 additions

| Check | Observed | Qualification |
|---|---|---|
| Form route + UI + schema focused checks | 10/10 passed | Controlled handler+Prisma harness |
| Form reminders/due test suite | 40/40 passed | Controlled worker test, including four added cases |
| Full G25 source suite | Passed | Source-only |
| TD5 source-closeout | 14/14 scripts, 167/167 cases | No live platform testing |
| Parser scan | 1,069 TS/TSX, zero syntax errors; 110 CSS, zero delimiter errors | Not full dependency-backed TypeScript build |
| Renderer relative imports | 3,191 checked, zero missing | Static only |

## Workstream 3 additions

| Check | Result | Limit |
|---|---|---|
| New Project closeout route and UI tests | 13/13 passed | Controlled handlers / Prisma and source assertions |
| Inherited G04 Project delivery/QA/release | 15/15 passed | Controlled lifecycle service and routes |
| v0.510 planning hardening | 15/15 passed with `--experimental-strip-types` | Node 22 host lacks default TS import; not live certification |
| Full G25 aggregate command | Passed | Source only |
| TD5 source closeout | 14 scripts / 167 cases | No live platform certification |
| Static source scan | 1,069 TS/TSX clean; 3,191 relative imports present; 110 CSS clean | No generated Prisma or native/UI runtime |

## Workstream 6 additions

| Check | Observed | Limit |
|---|---|---|
| Form reviewer→Project handoff | 11/11 passed | Registered route handlers with controlled transaction mock |
| Whiteboard history interaction | 17/17 passed | Pure policy tests + UI usage; no authenticated browser |
| Full G25 suite | Passed | Source-level regression, no live Prisma/DB |
| TD5 source closeout | 14/14 scripts, 167/167 cases | No native/runtime certification |
| Source scan | 1,070 TypeScript/TSX, 3,192 renderer imports, 110 CSS; 0 errors | Syntax/import/delimiter checks, not full tsc or Qt |

Live PostgreSQL migration, Node 24 compilation, multiuser permission tests, Qt/Windows and storage certification remain outstanding.

## Workstream 7 evidence (controlled source, not production)

| Check | Result | Limitation |
|---|---|---|
| Form reviewer grant, revocation, detail privacy and review transaction | 16/16 | Controlled route mocks, not live PostgreSQL concurrency |
| Board/Card shortcut ownership | 17/17 | Keyboard helper tests and source integration, no browser focus testing |
| `npm run cluster:td6:g25` | Passed | Inherited source harness and syntax/import scan |
| `npm run cluster:td6:g25:ticket-parity` | Passed | Includes saved Card history 22/22 |
| TD5 closeout | 14 scripts, 167 cases | Source only |
| Source scan | 1,072 TS/TSX, 3,199 imports, 110 CSS, 0 failures | Not generated Prisma, full tsc or actual browser/Qt |

Full multiuser, Node24, PostgreSQL, Windows/Qt, DPI and heavy-data/browser runtime tests remain deferred. Privacy export schema was advanced from 7 to 8 because new per-user review grants are exported.
