# TD3 deep shared-action and Appearance cascade subsystem audit

**Baseline:** v0.546.0 TD3 Deep Native UI (Roadmap R24). **This checkpoint:** substantive source-level action outcome/feedback + search-command + appearance background ownership. No new native binary, Prisma migration, or production certification claim.

## Bounded subsystem inventory

| Entry point | Canonical authority | Failure found | Corrected |
| --- | --- | --- | --- |
| ClusterActionButton actions | `useClusterActionFeedback`, new pure `cluster-action-transaction` | Rollback rejection aborted error feedback; a server-success/local-commit-failure looked like safe retry; stale feedback timer could reset a later action; manual reset could release the active lock | Yes, server/commit/rollback phases separated; guarded reset/timer; actionable uncertain-result feedback |
| Project restricted share URL | `copyClusterText` result | Clipboard could return `false` and UI still claimed success | Yes, report actual result |
| Taskbar Search commands | `CommandPalette`, new pure `cluster-command-invocation` | Copy links and detached-workspace window commands ignored false/rejected outcomes and closed results; repeated commands could race | Yes, one synchronous user-gesture executor, command feedback without closing, single flight, close on confirmed completion |
| Taskbar search copy current link | Existing Desktop-aware clipboard bridge | Promise result discarded | Yes, command action returns its promise |
| Current selected work deep link | Existing work-action link serializer/clipboard | Promise result discarded | Yes, result propagated to command runner |
| Appearance background | `application-theme-contract.css`, production UI tokens, original feature CSS owners | Light theme forced an identical grid for every background choice; old `!important` content-shell rules competed with Appearance material state | Yes, removed six superseded background rules from their original owners; no new late override layer |

## CSS evidence

A structural selector audit found 51 *possible* cross-file exact-selector/property divergences across renderer and application CSS. These are candidates, **not** 51 verified bugs. The targeted browser CSS cascade inspection confirmed:

- Light `body` background images were forced to the same grid by an unconditional `!important` rule in `application-shell.css`, independent of `data-background`.
- Older `application-shell.css` content-shell background declarations and `visual-polish.css` unconditional light grid were competing with the canonical Appearance/background rules.
- The workspace `.content-shell` is intentionally transparent in the canonical shell: it lets the chosen canvas show through. Do not force a colored opaque panel to make a fixture look busy.
- The corrected source CSS has distinct computed root background images for Clean/Grid/Aurora/Midnight in both dark and light themes. Existing panel backing remains visible in all eight combinations.

No arbitrary broad selector cleanup was performed. Other candidate differences need evidence before modification.

## Implementation verification

- `cluster-td3-deep-shared-action-closeout-tests.mjs`: executable server-action / rollback / commit and command single-flight tests, plus grounded source invariants.
- `cluster-td3-appearance-cascade-smoke.py`: source CSS flattened into a Chromium fixture, computed styles for 8 dark/light × background modes, 4 screenshot previews. This is not an authenticated app capture.
- 21 inherited / targeted development regressions, plus the 89-check previous native source audit.
- The pure core modules also passed isolated strict TypeScript checking; the full renderer dependency-backed build is not claimed.

## Preserve

Animated taskbar search replaces **project tabs only**. My Work, Tickets, Transfer Center and notifications remain in the utility zone; projects are the default tab contents. Both floating/full-width taskbars, floating/docked sidebars, Appearance texture/depth settings, rounded-square People avatars, user-color borders, and independent presence indicators are unchanged.

## Still implementation-owned by TD3

1. Review the remaining exact-selector CSS conflict candidates **with evidence**, not via blind stylesheet flattening. Keep single-ownership rules, remove only proven supersession.
2. Inventory remaining independent action entry points outside the reviewed shared action, palette, Project share-link and native viewer paths. Migrate only when an actual execution/outcome defect exists.
3. Reconcile any further source-level native QML component/reference defects demonstrated by the maintained Qt source audit. Do not require release-runtime certification to mark source scope complete.

Do not re-open TD1 or TD2. TD4/TD6 resource workflow development remains the following major effort after TD3 source closeout.
