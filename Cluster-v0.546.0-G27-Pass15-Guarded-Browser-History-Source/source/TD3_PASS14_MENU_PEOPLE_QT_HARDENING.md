# Cluster v0.546.0 — TD3 Pass 14: Shared interaction, People identity, Qt parity

Parent: `Cluster-v0.546.0-TD3-Pass13-Action-Integrity-Source.zip`.

## Implemented source changes

1. **Floating menu single-flight dismissal:** `useClusterMenuExecution` now exposes a synchronous `isExecuting()` fence in addition to rendered busy state. `ClusterFloatingSurface` has an optional `canDismiss` gate evaluated inside its document-level Escape and outside-pointer handlers. The three shared menu owners (overflow, context and split) use it, so Escape/outside clicks cannot prematurely close a pending action before the next React commit. Focus restoration after Escape only happens once the dismissed portal is actually gone.
2. **Recovery actions:** Undo/Redo executor now avoids updating state on an unmounted component, and exposes a synchronous `isExecuting` guard. Recovery dismissal is prevented while work is pending, including the time before busy state commits.
3. **Long-press context gestures:** The shared context-menu hook suppresses the synthesized click after successful touch long-press (avoiding an accidental underlying card open), but does not consume a later normal click. Movement, cancellation, pointer leave, timer cleanup and keyboard ContextMenu/Shift+F10 are guarded.
4. **People directory nested controls:** An outer People directory row button no longer contains an interactive quick-profile avatar button. `PersonSummary` has an explicit `avatarProfilePeek` policy for callers; other valid contexts retain quick-profile access. The existing user accent ring and independent presence indicator remain in the canonical avatar owner.
5. **Quick profile focus and data races:** The quick profile receives initial focus, restores focus to its avatar launcher on close, rejects stale asynchronous profile results after close/unmount, and guards duplicate requests.
6. **People typography:** Caption font is given a 12px effective minimum without discarding the Comfortaa/renderer typography pipeline.
7. **Qt source-side consistency:** ComboBox's Qt6 delegate explicitly declares its `index` property and honors the accessibility large-target height. Native surface material gradients and decorative highlight suppress themselves in high-contrast mode.

## Preservation guard

No modifications were made to Project Tabs search replacement, taskbar utility ownership, account theme schema, user preferences, database schema, PostgreSQL migrations, or native executables. The test ledger covers My Work, Tickets, transfers, project-only tabs, search slot, user-color ring, presence dot, and both previously closed TD1/TD2 contracts.

## Development verification

- 17/17 targeted regression commands passed, including inherited TD3 1–13, current Pass 14, and TD1/TD2 implementation closeout.
- Pass 14 executable/source regression contracts: 13/13 passed.
- Static source scan: 1,002 TS/TSX files, 109 CSS files, 3,188 renderer-relative imports, no scan findings.
- Six source-CSS browser fixture screenshots for People and shared elements in dark/light and desktop/phone People layouts; not authenticated React or native Qt screenshots.
- Release certification remains documented separately; this is an implementation checkpoint, not a shipped/certified binary.

## Next TD3 implementation

Audit adoption of canonical menus in older workspace-local actions, remove styling overrides where a canonical owner already exists, complete remaining Qt source parity and close TD3 after the implementation ledger is satisfied. Do not reopen TD1/TD2 for certification or mislabel static fixtures as real app captures.
