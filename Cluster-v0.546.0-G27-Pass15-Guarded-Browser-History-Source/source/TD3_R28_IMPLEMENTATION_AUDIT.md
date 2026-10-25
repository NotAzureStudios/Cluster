# TD3 R28: Viewer actions, native diagnostic feedback, and proven sidebar CSS conflict

Date: 2026-10-14. Parent: v0.546.0 TD3 Return / R27; prior authenticated Forms drafts remain intact. No database or native executable modifications.

## Evidence-based defects corrected

| Entry | Previous actual path | Failure impact | Corrected authority |
|---|---|---|---|
| Viewer overflow > copy review link, download/export and Desktop detach | `ViewerShell.runSystemAction` caught exceptions and resolved `void`; registry/MenuExecution saw confirmed success | Failed actions dismissed overflow menu although no work completed | Error status is set and exception rethrown; `ViewerCommandBar` retains failed menu and retry control |
| Viewer inspector/header shortcuts | `void registry.execute()` ignored rejection outside keyboard/toolbar | Unhandled failures, inconsistent status | One `invokeViewerCommand` adapter catches registry rejection for all header and inspector affordances |
| PDF selection copy | Direct `navigator.clipboard?.writeText` with swallowed rejection | Native-only clipboard unsupported; no visible failure; empty selection appeared successful | Shared `copyClusterText`, explicit empty/failed rejection, command failure visible |
| PDF print/download no source; print HTTP failure | Early return `undefined`, command marked complete | Menu disappeared on error | Explicit errors on absent source or HTTP failure |
| Native App Settings | `openLogsFolder`/`openApplicationData` returned `void`; QML ignored external shell registration and folder-open result | Failed actions looked successful | C++ bool result, QML feedback; diagnostic buttons stack at narrow width |
| Native Server Profiles | Return bool from rename/switch/open folder/sign-out ignored | User actions failed silently | Uses existing `formError`, no duplicate authority |
| Sidebar nav row height | `.cluster-sidebar__link` had 36/38px root `!important` declarations in two owners; mobile 44px overridden by later root rule | CSS import order changed desktop row height and destroyed mobile minimum | Removed competing declarations; base 38px and responsive 44px come only from canonical `sidebar.css` |

## Runtime-independent CSS reproduction

A Chromium source-style fixture evaluated 1200px and 700px viewports with two CSS import orders. Before the change:

- `sidebar.css` then `shell.css`: desktop 38px; mobile 38px.
- `shell.css` then `sidebar.css`: desktop 36px; mobile 36px.

After the change **all four combinations meet the intended 38px desktop / 44px mobile minimum**. Source and evidence: `tools/scripts/cluster-td3-r28-sidebar-order-probe.py` and `TD3_R28_SIDEBAR_CSS_EVIDENCE.json`.

## Larger CSS candidate inventory (not alleged defects)

A broad PostCSS raw exact-selector/property scan across 110 renderer CSS files yielded 260 differences across files. Filtering to root-context cross-file value differences gave 132 raw candidates. These are not equivalent to 260 or 132 CSS bugs: the unfiltered scan includes keyframes, contextual media rules, deliberate production overrides, theming and alternate component states; even equal-specificity conflicts are sometimes intentional. The **sidebar touch target** is one actually reproduced defect; the remaining cases require scoped cascade evidence and source ownership disposition. High-value candidates still to review include sidebar header columns/mobile behavior, shared Create picker geometry, People metrics, and admin surfaces; do not strip layers blindly. The prior smaller 51-candidate inventory used different rules and should not be numerically conflated with this expanded scan.

## Validation

- **27/27** inherited/new executable script suites, including earlier Forms draft recovery; source results: `TD3_R28_REGRESSION_RESULTS.json`.
- Focused R28 checks: **11/11**, including executable registry retry and concurrent-invocation semantics.
- **89/89** native QML source contracts; Qt installed build and actual Windows interactions not run.
- **4/4** Chromium sidebar import-order/viewport combinations; **8/8** Appearance background variants remain distinct in the existing fixture.
- **1,060** TypeScript/TSX parsed; **0** syntax failures. **3,255** renderer-relative imports checked; **0** unresolved. **110** CSS files parsed; **0** CSS parse failures.
- Lean source lacks `node_modules` and generated Prisma artifacts, so **dependency-backed React build, Windows Qt compile, native binary behavior and PostgreSQL/multiuser testing remain unverified**, under the separate certification roadmap. The Forms test's global TypeScript ESM import required a temporary symlink to the installed TypeScript toolchain (removed before packaging); all its assertions passed.

## TD3 closeout boundaries

TD3 remains open for a finite broader action-owner negative-result inventory, CSS candidate confirmation/disposition and any concrete remaining QML source defects. TD4/TD5/TD6 feature implementation should not be silently credited as TD3, nor should release target runtime gates prolong source closeout once implementation work is exhausted.

Preserve: animated Project Tabs taskbar Search, My Work/Tickets/Transfer Center and Notifications, floating/docked shell, Appearance palette/texture behavior, People accent borders/presence, high-contrast/reduced-motion accessibility, and the earlier Forms draft implementation.
