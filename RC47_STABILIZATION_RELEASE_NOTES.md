# Cluster 1.0 RC47 | Navigation, responsiveness and profile stabilization

RC47 is a targeted fix and polish checkpoint built on the complete RC46 source. No new database migrations, routes, permissions, schema entities, integrations, or API polling are introduced.

## Confirmed defects fixed

1. **Desktop sidebar could become impossible to expand.** The previous compact presentation hid the only navigation mode control; its button cycled to Auto instead of reliably reversing the visible state. Explicit expand/compact now toggles deterministically with persisted preferences, an accessible pressed state and a visible control even in compact mode. Mobile drawer stays independent.
2. **Compact sidebar could break the desktop shell grid.** A legacy collapsed-state rule switched the desktop shell to `display:block`, separating the page from its 72-pixel navigation rail. The RC47 desktop rule restores the grid layout in compact mode while leaving mobile layout unchanged.
3. **Hovering navigation initiated avoidable background API traffic.** Module preload still warms the destination code, but hover/focus no longer starts unrelated API data reads that compete with the active page. Explicit `prefetchFeature(...,{includeData:true})` remains available when needed. Failed preload attempts can retry.
4. **Initial People profile remained behind an expensive multi-resource read.** RC46 fixed explicit person selection but initial/deep-link selection still waited for Teams, workforce and a potentially 1000-person context fetch before showing a profile. RC47 loads the authorized profile first, preserves sequence/session fencing, then loads context separately. Changing accounts invalidates older responses.
5. **People overview repeated unavailable placeholders.** Empty optional email, manager, team, timezone and capacity fields are omitted from the summary. The Full Profile and permitted administration records retain all fields. Hidden location remains privacy-marked and private profile details are not exposed.

## Validation

- RC47 focused behavior and source checks including pure-function sidebar state tests.
- RC46 existing Whiteboard/People and setup/contrast checks.
- RC36 release regression suite and RC37 Discord suite.
- RC45 PostgreSQL unique-index safety regression.
- TypeScript/TSX parse scan and relative authored import validation.
- Go Windows installer tests and PE build, plus embedded source-file hashes against the complete source archive.

## Outstanding certification requirements

- **Full Windows Node 24/Prisma/TypeScript/Vite build:** not runnable with missing npm dependencies in this offline environment; execute the RC47 source-building installer on the Windows test server.
- **Live browser/manual checks:** verify compact/expanded sidebar, navigation from Projects/Whiteboards/People, rapid profile switching, and loading behavior with developer network panel.
- **Network/Discord:** remote user connectivity and live bot role/grant/revocation tests remain unverified.
- **Stable release blocker:** reproducible `package-lock.json` is still absent. Do not claim 1.0 stable certification until generated and tested.
