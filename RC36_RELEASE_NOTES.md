# Cluster 1.0 RC36 | Release-blocker audit and cache correctness

**Checkpoint type:** source-only development checkpoint built from the packaged RC35 archive. It is **not** an installable Windows RC36 EXE and **not** Cluster 1.0 stable.

## Confirmed issues corrected

1. **Invalidated foreground reads could repaint a page with outdated data.** RC35 stopped old responses from repopulating memory cache, but still returned them to the awaiting component. RC36 now prefers a newer cached/in-flight projection or coalesces one recovery GET when needed. A changed session or aborted navigation cannot receive the old result.
2. **Offline/native cache could be read while invalidation was still deleting it.** RC36 blocks matching durable reads until deletion completes. Storage failures fail closed for that account scope instead of reviving old records; a different account's cache remains independent.
3. **Read-rate-limit cooldowns could survive successful authentication or a server-address switch.** RC36 resets the client-side cooldown windows when those boundaries change, while preserving rate-limit enforcement on the server.
4. **The RC33 graph/cache regression fixture assumed invalidated in-flight responses could still resolve to stale results.** Updated the test to assert the corrected re-fetch behavior.

## Tests and limitations

- RC source smoke matrix: 33/33.
- RC30 performance: 26/26; RC31: 27/27; RC32: 34/34; RC33/RC34 graph/UI suites passed.
- RC35 new behavior: 7/7; RC36 focused: 13/13 checks (five foreground, four durable, four traffic scope).
- Source syntax/import scan: 1,191 TS/TSX, 119 CSS, 4,894 authored relative imports; no syntax or authored-import errors.
- A global TypeScript diagnostic comparison versus unmodified RC35 showed **zero additional diagnostics** in renderer and API client. Both trees lack installed workspace typings/dependencies: this is **not** a successful full TypeScript build.
- Node available here: 22.16.0 (required 24.20.0); Go available: 1.23.2 (required 1.27.1). npm registry DNS failed. `package-lock.json` remains missing. A full build, clean `npm ci`, PostgreSQL 18, Windows launchers, backup/restore and multiuser certification were not executed.

## Required before stable release

Build the exact source on a clean Windows x64 environment with approved Node/Go versions, establish and review the npm lockfile, verify `npm ci`, generate Prisma Client, run the full compiled application build and native test suite, and complete the Windows/PostgreSQL acceptance checklist in `RC36_WINDOWS_CERTIFICATION.md`.

**Do not overwrite the working Cluster installation by copying this source ZIP into its runtime folder.**
