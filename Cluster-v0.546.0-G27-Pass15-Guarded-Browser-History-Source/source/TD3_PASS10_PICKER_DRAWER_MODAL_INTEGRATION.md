# Cluster v0.546.0 | TD3 Pass 10: Picker, mobile drawer, and modal-integration implementation

**Base:** TD1 + TD2 Implementation Closeout full source (includes TD3 Pass 9 and TD4 Pass 1). **State:** implemented in source with development regressions. Product version remains 0.546.0. **No DB migration, no native executable changes.**

## Implemented and source-integrated

1. **Three shared pickers use one navigable option-identity contract.** `cluster-listbox-navigation.ts` tracks active values rather than indices, skips disabled items, handles missing or filtered actives, wraps directions, and honors first/last. `ClusterSelect` fixes opening ArrowUp/ArrowDown being overwritten by its opening effect. `ClusterCombobox` and `ClusterMultiSelect` recover selection after filtering, async list refresh or reordering. Controls no longer close their search just because a remote result set is temporarily empty; the multiple picker retains Clear selection even when the available options are disabled.
2. **Search keyboard and accessibility improvements.** Search input owns `aria-controls` and `aria-activedescendant` for the actual listbox, rather than leaving active-descendant on an unfocused element. Enter selects a highlighted result from search; Space still enters a space. Home/End retain native text-caret behavior in the search field. Menu action buttons retain native Enter handling. Multi-select always provides a visible Done action.
3. **Mobile navigation drawer behavior.** Escape now closes it with the shared dialog interaction system, and the original launcher remains mounted for focus restoration. Switching to persistent desktop navigation closes the temporary drawer. Projects/Admin sections announce expansion and controlled panel identity. The launcher is hidden/inert while the drawer is open, not unmounted.
4. **Pointer backdrop actually works with modal isolation.** The drawer backdrop is a pointer-only, aria-hidden presentation surface instead of an isolated background button. It is exempted only when it matches the active dialog ID. Modal backdrop must not become keyboard focusable outside the dialog.
5. **Late-mounted modal sibling isolation.** The shared modal manager now reevaluates newly added background siblings while a dialog stays open, retaining the original `inert` and `aria-hidden` values for correct cleanup. Portaled floating controls remain governed separately by modal ownership.

## Development checks

- **46/46 inherited development commands passed** after the complete pass; TD1 and TD2 closeout and TD4 work retained.
- **31/31 new picker/drawer-focused assertions** and **9/9 Chromium execution scenarios for the extracted production modal-isolation helper** passed.
- **21/21 prior overlay source checks** passed (source assertion updated only for the intentional same-dialog isolation resync); **33/33 UI primitive checks** passed (source assertions updated to the new stable-value contract).
- **1,050 TypeScript/TSX parsed**, no syntax errors; **3,188 renderer relative imports scanned**, none missing; **109 CSS files**, zero top-level parse errors.
- **4/4 illustrative production-CSS Chromium previews** passed with no horizontal overflow, and the taskbar retained sticky positioning. The previews are not running React screenshots.

## What remains as implementation work within TD3

- Inspect and converge older workspace-local control/menu/focus implementations that bypass the shared pickers or action primitives; migrate only where owner contracts are understood.
- Finish native Qt *source-level* appearance/interaction parity where the Qt components lag the renderer; do not confuse this with future Windows release qualification.
- Retire overlapping CSS ownership and per-workspace visual overrides once their canonical replacements are in place. Audit remaining high-use Library, Projects, People and Settings surfaces.

**Release qualification is a separate roadmap** (`CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`) and must not block implementation phase closeout once all source contracts are actually implemented. No React runtime or Qt executable claim is made here.
