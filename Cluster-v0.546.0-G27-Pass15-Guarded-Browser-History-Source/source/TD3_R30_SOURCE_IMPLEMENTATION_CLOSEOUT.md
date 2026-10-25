# TD3 R30 | Evidence-based source implementation closeout

**Baseline:** R29 complete source. **Active work:** TD3 only. **Result:** the *finite R29 source audit* has no remaining unassigned implementation owners. TD3 source implementation is closed, not certified. No TD4/TD5/TD6 product features were added.

## Defects actually demonstrated and fixed

| Owner | Before | Source fix | Development evidence |
| --- | --- | --- | --- |
| Desktop native file open/reveal | `openNativeHandle` and `revealNativeHandle` return booleans, but panel discarded denial | Require explicit positive result, show success/error; synchronously lock and busy-label each native action | Native broker `file.open/file.reveal` source; 11 executable focused assertions |
| Native clipboard and window actions | `writeNativeClipboardText` false still showed copy success; widget library `opened:false` ignored; native settings/server-profile response ignored | Confirm broker boolean/`opened` contracts, keep errors visible and retryable; action-local locks | Native capability broker source + focused assertions |
| Capture/transfer outcome | Preview/reconciliation failures could report the *already successful* capture or native mutation as failed | Preserve captured opaque handle; surface partial success and reconciliation need; single-flight capture/transfer buttons | Focused assertions and source scan |
| Git Workstation | React state only gave next-render duplicate protection; LFS follow-up `getNative...` failure fell into mutation failure catch after mutation succeeded | Immediate per-intent locks on Git mutations, Git operations, initialization, clones, tasks. Follow-up inspection has its own recoverable warning | Focused Git contracts and inherited regressions |
| People metrics CSS | `.people-metrics-v244` grid in `people.css` overridden by Production UI flex depending on order; R29 CSS at 375px: 462px scroll content in 375px area | Delete competing `display:flex;grid-template-columns:none;gap:0` from Production; retain 5/3/2 responsive grid owned by People | Before/after computed styles at 375/800/1200 in both orders |
| Select popover CSS | Select owner `padding:var(--space-1)` (4px) lost to Production UI 5px depending on load order, changing option width 208px vs 210px | Delete Production UI's competing padding while preserving border/background/shadow rules | CSS Chromium 20/20 fixtures and before evidence |

## Candidates investigated, intentionally not rewritten

- Mobile chat dock: in both tested import orders, the open dock uses the same 6px screen inset on 360px/700px; other rules respond to device mode and keyboard safe areas. No demonstrated CSS defect.
- Select floating shadow: both import orders calculate the same floating shadow and preserve option focus/hover; no shadow cleanup warranted beyond the demonstrated 1px padding ownership fix.
- Admin compact navigation: narrow workspaces intentionally scroll their own subnavigation horizontally without causing page-wide overflow; existing breakpoint behavior preserved.
- Native QML components: all fifteen QML source files were audited for registered component references, constructors, scaled font contracts, opacity/high-contrast, reduced motion, focus and balanced delimiters. 89/89 current checks. Actual Qt compilation and keyboard interaction are **not** evidenced by this audit.
- Existing background polling, push reconciliation, and resource-specific actions: not converted to menu transactions when no user-driven outcome exists; future TD4/TD5 consumer additions own their contracts.

## Closeout gates and precise limitations

- **29/29 inherited + new source regression scripts** passed, retaining authenticated Forms draft regression and shared commands/Viewer/Menu/Appearance.
- **11/11** new R30 native/Workstation focused assertions passed.
- **20/20** computed CSS fixture scenarios passed after fix; earlier before evidence retained.
- **89/89** native QML source contracts passed.
- Source scan of **1,062 TS/TSX files**, **3,262 renderer relative imports**, and **110 CSS stylesheets** yielded zero parse errors/unresolved imports/CSS parser errors.
- No Prisma changes, no DB migrations, no native binary edits; Source manifest + archive/hash + patch replay are packaging requirements.

**Disposition:** TD3 source implementation **CLOSED** at R30. This does not assert an arbitrary complete audit of every future feature, nor release readiness; reopen for a demonstrably broken source path. All installed-Qt, Windows DPI, runtime browser flow, dependency-backed full build and production acceptance tests remain in the **separate** `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`. TD4 resource adapters and TD6 mandatory workflow completion are next.
