# G27 Pass 13 | Project tab commands and workspace-local selectors

## Implemented

- Closing the active Project tab now asks before removing it from the tab bar, changing pinned state, or jumping to a fallback Project. Background-tab dismissal remains immediate. Stale, rejected, or failing confirmations do not commit.
- `Close Other Tabs` now protects a transition to a different Project with the same preflight. A Project no longer visible to the current user cannot become the keep-target.
- The Board and Whiteboard workspace-local selection callbacks now enter canonical authorized resource navigation for exact IDs and generic empty-picker selections, instead of bypassing the unsaved-work guard with direct state changes.
- Closing a Board no longer discards its loaded state *before* a potentially declined Project/Projects navigation; normal post-navigation cleanup handles the unloaded Board.
- A Board picker selecting no ID clears its cached Board view only when the guarded selection actually becomes empty.
- The Project tab fallback only chooses IDs still visible in current authorized Projects.

## Evidence

20/20 new executable checks extract and run the actual two Project-tab functions and three workspace JSX callbacks, testing cancel, approve, concurrent intents, failure, background tabs, inaccessible fallback and empty picker. All inherited G27 tests and common TypeScript/import/CSS scan pass. No migration or native binary changes.

## Remaining

The Board fetcher is asynchronous and still needs a request identity gate to prevent an older response from overwriting the newly selected Board. Other per-tool local history/selection flows remain to audit. G27-05/06 not declared complete.
