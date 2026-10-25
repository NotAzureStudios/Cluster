# TD3 return to active execution | shared actions, native Server Profiles and appearance opacity

**Date:** 2026-10-14. **Parent:** v0.546.0 TD6 CD-01 developer source, itself based on TD3 Deep Shared Actions and Appearance Cascade. **Active phase:** TD3. The earlier Forms draft code stays intact and is NOT credited as a new TD3 feature.

## Whole-path findings and implemented repairs

| Source entry | Ownership before | Confirmed failure path | New behavior |
|---|---|---|---|
| `ApplicationProjectTabs.tsx` Account > Copy link | Direct `void copyClusterText` + premature menu close | Native/browser clipboard returns `false` or rejects; user sees vanished menu without a copied link | Reuses the taskbar Search's pure `createClusterCommandInvocation`, with synchronous gesture, pending gate, confirmed dismissal, visible error for failed/rejected copy |
| `ApplicationProjectTabs.tsx` Account > Detach | `void openCurrentWorkInDesktopWindow` and close | Desktop fails to create child window; user loses the action surface | Same canonical executor; failure retains menu + retry, dismissal blocked while command is running |
| `ClusterApplication.tsx` detached resource Copy link | Fire-and-forget copy | Clipboard denied, no user-facing result | Existing `ClusterActionButton` owns busy/success/error; clipboard `false` is a rejected action |
| `ServerProfilesWindow.qml` saved server list | MouseArea nested in plain Rectangle | No tab-focusable profile choice, no keyboard selection state or visible focus | Native `ItemDelegate` with keyboard activation, accessible name/selected and Theme focus border, rows scale with native text preference |
| `ServerProfilesWindow.qml` Reset / Forget | One-click irreversible local deletion | Accidental pointer/keyboard activation removed offline/browser/session data | Separate modal confirm/cancel before C++ authority is invoked; failure reports native operation error |
| `ServerProfilesWindow.qml` Save & switch | Add succeeds, switch return value ignored | Saved profile activation fails; creation form remains open and encourages repeat save | Select saved profile and report activation failure, preserving one saved profile |
| `Surface.qml` with reduced transparency | `Theme.surfaceStrong` (alpha .93/.96) | Native reduced-transparency setting still draws translucent panels | Uses opaque native surface for both reduced-transparency and high-contrast; keeps gradients off |

## Source inventories and preservation

- Qt native module has 14 QML files. The source audit traverses every defined Cluster component, verifies their registration in CMake, checks scaled caption typography, focus/reference and braces.
- Account actions now consume the previously implemented command executor instead of introducing a new executor or duplicating clipboard logic.
- The native persistence, session switch and delete logic is still owned by `ServerProfileStore`; dialogs are UI confirmation only and do not bypass authority.
- Preserved Taskbar Project Tabs search animation, My Work, Tickets, Transfer Center, Notification Preview, People personal accents/presence, the floating/docked shell, Appearance background choices, and all earlier TD6 Forms draft work.
- No Prisma or native executable modification from this TD3 return.

## Verification / limitations

- New executable source/outcome assertions, including pending duplicate suppression, denied clipboard, native-open failure, correct modal confirmation and focusable profile selection.
- Inherited TD3 scripts are rerun; results in `TD3_RETURN_REGRESSION_RESULTS.json`.
- TypeScript/TSX AST syntax, renderer imports and PostCSS parses are rechecked using `tools/scripts/cluster-td3-return-source-scan.cjs`; results in `TD3_RETURN_SOURCE_SCAN.json`.
- Native QML static owner/type contracts via `cluster-td3-native-ui-deep-audit.py`. This is not `qmllint`/Qt build proof.
- CSS background computed-style Chromium fixture covers light/dark Clean/Grid/Aurora/Midnight; no claim of authenticated screenshot or native window acceptance.

## Remaining finite TD3 work, not TD6 or release testing

1. Evaluate independently owned actions with actual failing-result paths, rather than blanket replacing menu code. Candidate inventory remains the prior 51 possible CSS cross-file selector/property divergences, **not 51 proven defects**. Inspect specificity, theme and component state before deleting original owner declarations.
2. Finish native source focus/type/visibility and responsive geometry review where evidence indicates code gaps. Do not treat an unavailable Qt toolchain as implementation failure or silently certify binaries.
3. Close TD3 only after source-level conflict/action inventory is exhausted or each proven issue is assigned to a concrete owner. Then proceed TD4/TD5/TD6.
