# TD3 R29 implementation audit | validated source scope

Parent: v0.546.0 TD3 R28. Active phase: **TD3**. Date: October 14, 2026.

## Confirmed defects, ownership and solutions

| Area | Evidence in prior source | User impact | Fix and authority |
| --- | --- | --- | --- |
| Shared action menus | `useClusterMenuExecution` considered fulfilled `Promise<false>` a success | Clipboard denied or detached windows failed but menus closed | Explicit `false` rejects through shared outcome evaluator; inherited void/`true` remain confirmed, failure keeps menu open |
| Work actions | `WorkActionMenu` awaited booleans but returned `void` for `copyWorkLink` and `openWorkInDesktopWindow`; `mentionWork` discarded denied copy | Incorrect success feedback | Direct boolean outcome return, explicit clipboard error |
| Board/Whiteboard browser windows | `openBoardResourceWindow` and `openWhiteboardResourceWindow` swallowed native false and exceptions after status update | Browse menus dismissed despite failed detach | Return `false` on missing target, native denial, or caught error; return `true` only on native confirmation; keep status message |
| Palette native utilities | Four Desktop native actions wrapped in `void`, while `createClusterCommandInvocation` already understood boolean outcomes | Failed native commands dismissed palette | Return promises for detached window, app settings, server profiles, and reload into existing command gate |
| Create search cascade | Late production `.shared-create-search-v466,.shared-create-search-v457` fixed 32px height / max-height and 30px input overrides source Create picker rules, plus late 44px minimum | Mobile search controls shrank and heights depended on stylesheet order | Remove production height ownership, align Create owner 44px desktop / 46px mobile; input min 42px |

## CSS reproduction, before / after

Chromium source fixture using production and Create CSS in both load orders:

| Viewport | Before: production then Create | Before: Create then production | After both orders |
| --- | --- | --- | --- |
| 1200px | 42px search, 40px input (max-height 32) | 32px search, 30px input | **44px search, 42px input** |
| 700px | 46px search, 40px input (max-height 32) | 32px search, 30px input | **46px search, 42px input** |

The fixture checks CSS height and minimum, not the full running Create workflow. Stored evidence: `TD3_R29_CREATE_SEARCH_CASCADE_EVIDENCE.json`. This is independent of the prior R28 sidebar fix.

## Finite action and CSS disposition

**Verified action owners:** `useClusterMenuExecution`, `ClusterContextMenu`, `ClusterActionMenu`, `ClusterSplitButton`, resource action registry, `WorkActionMenu`, `ProjectResourceSwitcher`, Board and Whiteboard Desktop window callbacks, global command palette, inherited viewer and taskbar Search outcomes. Shared menu actions preserve the initiating user gesture and busy lock.

**Still requires review before TD3 closeout:** remaining workspace-local non-menu action owners and desktop utility panels, primarily paths that ignore async return values without supplying separate feedback; do not mechanically convert fire-and-forget background refresh paths. Higher-risk CSS inventory requiring computed-selector disposition: `.chat-dock` mobile placement, `.cluster-select-menu-v227` shadow ownership, `.people-metrics-v244` layout (production flex override may be intentional), and admin responsive overflow. Existing responsive, media, animation and theme variants are not automatically defects.

**Native source:** 89/89 QML contracts pass. No additional demonstrable QML source defect was established this pass. Actual Qt build and Windows interaction certification remain out-of-scope for TD3 source closeout.

## Checks executed and limitations

- 28/28 inherited/new executable suites passed, including 60/60 retained Forms draft checks.
- R29 focused 12/12; Create-order Chromium 4/4; native QML 89/89; Appearance 8/8.
- 1,061 TS/TSX, zero parse errors; 3,261 renderer-relative imports, zero unresolved; 110 CSS files, zero parser errors.
- Existing `.zip` archive preserves schema, migrations, packaged native executable, TD6 respondent drafts, Project Tabs/Search, My Work/Tickets/Transfer Center, floating shell, People identity and Appearance modes.
- Dependency-backed React compilation, Windows/Qt installed build, live PostgreSQL and permission/multiuser acceptance were **not** run and are tracked in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

**Status: TD3 still open.** Remaining work is a bounded evidence-based review, not an arbitrary pass counter.
