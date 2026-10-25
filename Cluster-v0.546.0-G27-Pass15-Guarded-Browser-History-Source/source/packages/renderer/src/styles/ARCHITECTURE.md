# Renderer CSS Architecture

Cluster treats CSS as production code. The cascade is an API, not a pile of patches.

## Ownership order

1. **Tokens** — `design-system/tokens.css` is the only owner of semantic `--ds-*` values. `application-theme-contract.css` is the single owner of application-wide theme/surface custom properties and variants.
2. **Application layers** — `layers/application-*.css` own shared application structure in one audited global order.
3. **Shell/workspace contracts** — `features/shell/shell.css` owns persistent shell chrome. `shell-contract.css`, `workspace-contract.css`, `card-style-glass.css`, and `controls.css` provide cross-application structural contracts without route-level shell ownership. `workspace-contract.css` alone defines the semantic `--cluster-workspace-*` presentation token family; version-stamped `--v139-*` tokens are retired.
4. **Cross-application behavior** — accessibility and consistency rules that genuinely apply to multiple features.
5. **Primitives** — reusable design-system components and shared workspace behavior.
6. **Feature CSS** — a feature owns only selectors rooted in that feature; `ClusterApplication` owns its four `application-*.css` cascade files directly.
7. **Responsive geometry** — `responsive.css` is the single phone/tablet geometry contract.
8. **Production contract** — `design-system/production-ui.css` is the final non-`!important` normalization layer.

## Rules for new work

- Do not add a new global polish, parity, fix, override, or version-number stylesheet. Extend the owning primitive or feature instead.
- Do not add `!important`. Existing occurrences are frozen by `css-architecture-audit.mjs` and must trend downward.
- Do not re-import parent-owned CSS from decomposition modules. A side-effect stylesheet has one owning import boundary.
- Use tokenized spacing, radii, colors, elevation, and motion. New CSS files receive a zero-debt budget.
- A component should have one authoritative style source. If a selector is being corrected in a later file, migrate the original owner rather than adding another correction layer.
- Delete unreachable version-tagged selectors when the corresponding class is absent from current renderer source. Current live selectors must move to a semantic owner before their old rule is removed.

## Phase 1 migration order

1. Centralize stylesheet imports and freeze debt.
2. Remove unreachable version-tagged rules and superseded exact-selector declarations.
3. Replace release-numbered stylesheet ownership with semantic current owners.
4. Collapse dead declaration chains while preserving canonical token/theme contracts.
5. Move surviving shared rules into primitives or the true feature owner.
6. Reduce the debt baseline after every verified cleanup.

The architecture audit exists so the stylesheet graph can become simpler over time instead of growing another geological layer after every polish pass.


## Shared component contract — Phase 2

Routine interactive UI now starts with the canonical renderer primitives in `components/ClusterButton.tsx`, `ClusterStatus.tsx`, `ClusterField.tsx`, and `ClusterToolbar.tsx`. Their styles belong in `design-system/primitives.css`. Generic `.button`, `.micro-button`, and `.icon-button` class contracts are retired; specialized feature controls may still use native `button` elements when their structure is genuinely feature-specific.

Do not create feature-local button/status/field variants for ordinary interactions. Specialized controls may keep purpose-built markup when their semantics require it, but raw routine-control counts are release-ratcheted by `shared-components-audit.mjs` and must trend downward.

## Interaction state contract — Phase 3

Shared interactive and operational state uses the vocabulary in `components/interaction-state.ts`. Native browser semantics and pseudo states remain authoritative for hover, focus, press, and disabled behavior; persistent state is exposed through `data-cluster-state` and the corresponding ARIA contract. New feature-local state classes must map to the canonical state model instead of creating another visual status language.


## Information density contract — Phase 4

`ClusterMetricStrip` is the canonical summary rail. Operational pages should prefer one summary layer, row/list comparison, boundary-driven grouping, and density-aware spacing. See `docs/archive/implementation-history/INFORMATION_DENSITY_PHASE4.md`. New feature-local metric-card grids should be treated as a migration exception, not the default pattern.

## Contextual actions (v0.428)
Routine action hierarchy is owned by `ClusterContextActions.tsx`: overflow menus, selection-only bulk bars, precise undo surfaces, and row-action groups. Feature code should compose these with the canonical button/toolbar primitives rather than creating local action-menu or bulk-action systems.

`ClusterMasterDetail` is the canonical collection/inspector split for bounded record inspection. Supported selections use the lightweight `inspect=<scope>:<id>` history contract so refresh and Back/Forward preserve context without converting every inspector into a full application route. See `docs/archive/implementation-history/MASTER_DETAIL_PHASE6.md`.

## Optional glass presentation

`card-style-glass.css` owns optional card translucency. Normal production geometry and surfaces remain owned by feature CSS, shared primitives, and the final production contract.


## Persistent shell ownership

`features/shell/shell.css` is the single current owner for persistent sidebar, navigation, project-tab, and taskbar styling. Route feature styles must not target those chrome classes. The current shell roots are `shell-sidebar-v3430` and `taskbar-unified-v3430`; retired root aliases are not compatibility contracts.

## Live selector ownership — Block 8

Move live selectors to the true feature, component, application, or explicit shared-contract owner instead of letting a lazy feature stylesheet act as a global registry. New component-local and feature-local stylesheets are imported by the boundary that actually renders those selectors. Shared cross-route geometry belongs to `workspace-contract.css`; shared interaction geometry belongs to `controls.css`.

Mixed-selector quarantine is not a permanent ownership tier. If splitting a selector list would duplicate cascade debt, first extract the shared declaration into an existing semantic contract or remove a provably redundant branch. Settings and Projects are now ratcheted to zero live foreign versioned families.

Release-numbered custom-property families are migration debt, not public API. When a family is still live, migrate every definition and use to a semantic name in one pass and do not add compatibility aliases. Block 8 retires `--v117-*` in favor of `--cluster-app-*`.

When a legacy application layer and a later true owner contain the same versioned selector/property contract, delete the earlier superseded declaration rather than preserving both. The maintained audit keeps those ownership reductions and debt ceilings from regrowing.
## Shell, navigation, and workbench semantics — Block 9

Persistent chrome tokens belong to `features/shell/shell.css`. The semantic `--cluster-shell-*`, `--cluster-sidebar-*`, and `--cluster-taskbar-*` families replace the retired v256/v257/v258/v259/v262/v271 shell token generations; no release-numbered aliases are retained. Shared taskbar/workspace geometry such as `--cluster-taskbar-height` and `--cluster-taskbar-content-gap` remains in `workspace-contract.css` rather than being redefined by shell chrome.

Application surface styling is not shell chrome. The old v267 `--cluster-shell-*`/workspace/background palette is retired in favor of `--cluster-workbench-*`, with definitions owned by `application-shell.css` and consumers in controls, workspaces, shell accessibility fallbacks, and specialized components. `application-controls.css` and the feature owners that survive Block 14 consume that palette rather than redefine it; the historical application workspace registries are retired.

Release-stamped typography aliases are not compatibility contracts. `--cluster-font-stack` and `--cluster-active-font` are the current typography properties; the v0100/v0101/v0102 font token generations are retired. When shell rules contain a versioned class that no renderer code emits, remove the dead selector branch instead of keeping it as speculative compatibility.

## Workspace/content-surface convergence — Block 10

Block 10 established `application-workspaces.css` as the shared application workspace and root/theme owner rather than a feature-local override registry. Block 14 subsequently retires that registry after distributing each surviving contract to its semantic owner. Packet, Timeline, Library, Security PIN, Settings, Notifications, and Time selectors rooted in those features belong to their feature or component stylesheet. Root/theme/mode rules stay application-owned when they also govern generic controls or panels; a lazy-loaded feature must never become the condition for global card, contrast, or surface behavior.

Release-numbered workspace/content properties are not compatibility API. The v268/v269/v270/v271 workspace families, dead v262 control properties, and v257 content/board property names are retired without aliases. Block 10 initially placed `--cluster-workspace-scroll-*` and `--cluster-workspace-control-radius` in `application-workspaces.css`; Block 14 moves their canonical definitions to `styles/controls.css` and retires the registry. `application-shell.css` owns `--cluster-content-text-*`; `board-workspace.css` owns `--cluster-board-*`.

When a migrated later rule makes an earlier exact selector/property declaration incapable of winning, remove the earlier declaration rather than preserving duplicate cascade debt. Newly authoritative feature owners must also remain free of unreachable versioned selector branches.

## Application/control SSOT convergence — Block 11

Single source of truth is a release invariant: **one fact, one owner, many consumers**. Global `--cluster-*` custom properties may not be published by multiple files. Scoped feature specialization is allowed only when it does not create a second global authority; the current audited example is `.qa-page-v085` narrowing `--cluster-panel-pad` for descendants.

`application-theme-contract.css` is always loaded immediately after `design-system/tokens.css` and owns the application theme, surface, border, field, and background-image contracts. Block 11 made `application-shell.css`, the then-current application registry layers, `application-base.css`, and feature CSS consumers instead of competing authorities; Block 14 retires both application registry families entirely. Because there is one owner, the theme custom-property definitions need no `!important`.

Shared checkbox/radio geometry belongs to `controls.css`; Settings owns `.role-toggle-v172` presentation because that selector is emitted only by Settings. Release-numbered custom properties are forbidden, not aliased. Definition-only feature/application tokens are deleted once current renderer and code consumers are proven absent.

The maintained `single-source-of-truth-current-audit.mjs` performs three checks on every pass: definition ownership, duplicated product/domain facts, and consumer/package validation. The current source packager reruns the maintained audit inside the stripped staging tree before writing its manifest, so packaged source cannot silently diverge from working-tree SSOT.

## Shell final-state and control SSOT normalization — Block 12

Persistent shell final-state styling remains owned by `features/shell/shell.css`. The current renderer emits one `shell-unified-v3430`, one `shell-sidebar-v3430`, one `taskbar-unified-v3430`, and one `content-shell`; declarations that are provably superseded for that actual structure are deleted rather than kept as historical cascade layers. Shell tokens with no remaining consumer are removed, not retained as speculative API.

Generic native input/select/icon control presentation belongs to `controls.css`. `consistency.css` must not publish a competing base contract for native selects, ordinary text fields, `cluster-color-field-v227`, or the base `cluster-icon-button-v227` geometry. It may still own genuinely cross-feature consistency and shared component behavior until those components receive a narrower semantic owner.

Feature-rooted final-state rules belong to the feature that emits them. Timeline, Library, Boards, Time, Admin, Create, Tickets, Notifications, and Calendar must not use `consistency.css` as a late feature registry. Board workspace/fullscreen geometry belongs to `board-workspace.css`; Settings-only controls belong to `settings-workspace.css`; Admin and Notifications own their rooted control rules. `application-shell.css` may not own Board selectors, and `application-controls.css` may not own rooted Settings/Admin/Notification presentation.

Every ownership migration is followed by a same-owner supersession sweep. If the moved final-state rule makes an earlier selector/property declaration incapable of winning, delete the earlier declaration. The persistent SSOT audit, Block 12 ownership gate, maintained suite, and stripped-package rerun must all pass before the source is frozen.

## Shared component and registry SSOT — Block 13

Block 13 removes feature ownership from broad registry/consistency layers and gives shared components and feature families explicit stylesheet owners.

Canonical shared component owners:
- `styles/components/presence-avatar.css`
- `styles/components/collaboration-panel.css`
- `styles/components/cluster-select.css`
- `styles/components/tool-page-header.css`
- `styles/components/compact-section-nav.css`
- `styles/components/filter-menu.css`
- `styles/components/number-stepper.css`

Canonical application/feature owners added or expanded in this block include `project-delivery.css`, `tool-infrastructure.css`, `team-workspace.css`, `template-management.css`, Operations, Admin, Create, Changelog, Shell, Timeline, Library, and Boards.

Block 13 bounded `application-tools.css`, `application-workspaces.css`, and `consistency.css` so they could no longer grow as fallback registries. Block 14 completes that migration by retiring both application registry files; `consistency.css` remains the bounded shared-policy layer. Feature-rooted rules belong beside the feature that emits them. Cross-feature invariants may remain shared only when the selector itself expresses a genuinely cross-feature contract.

All renderer custom-property definitions and `var()` consumers must be release-number agnostic. Semantic tokens preserve values while removing historical release labels; definition-only historical tokens are deleted rather than aliased. The persistent SSOT audit checks ownership, divergence, and package consumption on every maintained run.


## Registry retirement and typography SSOT — Block 14

The historical application registry layers are no longer architecture. `styles/layers/application-tools.css`, `styles/layers/application-workspaces.css`, and `features/application/styles/application-workspaces.css` are deleted and their imports removed. Their surviving rules were redistributed by semantic ownership: feature-rooted selectors move to the feature that emits them; shared controls move to `styles/controls.css`; shared workspace geometry moves to `styles/workspace-contract.css`; accessibility modes move to `styles/accessibility.css`; shared component treatment moves to `styles/layers/application-components.css`; application theme values remain in `styles/application-theme-contract.css`. No compatibility registry or alias layer replaces the deleted files.

`styles/typography-contract.css` is the sole font-preference authority. It owns `--cluster-font-stack`, `--cluster-active-font`, every `:root[data-font=...]` selector, and the global font-family application. Feature and application CSS must consume the active-font contract rather than publish later font preference overrides. The typography contract uses no forced priority.

`styles/controls.css` owns `--cluster-workspace-scroll-track`, `--cluster-workspace-scroll-thumb`, `--cluster-workspace-scroll-thumb-hover`, and `--cluster-workspace-control-radius`. `styles/application-theme-contract.css` owns `--studio-primary`, `--studio-secondary`, and `--user-accent`. Shared declutter policy remains in `consistency.css`; shared Operations/QA hero treatment remains in `application-components.css`; Team and other feature-rooted presentation remains with its feature.

Ownership moves are followed by branch-level exact-selector/property supersession checks. A declaration is deleted only when every selector branch is replaced later in the same at-rule context by equal-or-stronger priority. Persistent shell declarations are not removed to satisfy a quota when the one-emitter DOM cannot prove them dead. The persistent SSOT gate and the Block 14 gate prevent the retired registries, direct font preference overrides, or duplicate workspace-control authorities from returning.


## Lazy feature ownership and route-order SSOT — Block 15

Lazy feature stylesheets are not allowed to act as application registries. `features/timeline/timeline-workspace.css`, `features/settings/settings-workspace.css`, `features/library/library-workspace.css`, and `features/boards/board-workspace.css` keep feature-rooted rules only (plus Board-owned theme token definitions). Shared or cross-feature invariants are owned by `styles/workspace-contract.css`; native shared control primitives remain owned by `styles/controls.css`.

Block 15 removes the old pre-v217 Library `knowledge-*` generation, the semantic-ID-only `timeline-item` CSS generation, dead Board/Settings branches, and foreign Timeline/Settings rules whose lazy load order could restyle unrelated routes. Project Video presentation is owned by Projects, lifecycle/work-link presentation by Operations, project-delivery rules by Delivery, and Team rules by Team. No compatibility aliases or registry wrappers are retained.

SSOT is checked in the working tree, the maintained audit suite, the stripped staging source, and again from the actual packaged ZIP. Current visual debt ratchets are 2,992 forced overrides / 180 gradients / 72 backdrop filters / 826 raw colors.

## Presentation alias and accessibility-preference SSOT / foundation exit — Block 16

`styles/application-theme-contract.css` is the single base/theme definition owner for the active short presentation alias namespace (`--bg`, `--panel*`, `--text`, `--soft-text`, `--muted`, `--line*`, `--border*`, `--input-bg`, `--surface*`, `--accent*`, and `--danger`) and for every `--cluster-workbench-*` theme/background token. These short aliases are live renderer API, not compatibility aliases. Other stylesheets may consume them or apply narrowly scoped runtime overrides, but they must not publish competing `:root` or theme definitions. `--card` and `--muted-2` are retired because they have no current consumer.

`styles/accessibility.css` is the only stylesheet allowed to own `[data-motion="reduced"]`, `[data-motion="none"]`, `[data-large-targets="true"]`, and `[data-reduced-contrast="true"]` behavior. Application controls and override layers must not repeat those preference contracts. Reduced-contrast custom-property overrides must derive from canonical theme/workbench values and may not self-reference the property being defined.

The Block 16 ratchets are 2,892 forced overrides / 180 gradients / 72 backdrop filters / 812 raw colors / 1,548,185 CSS bytes. The one-emitter persistent shell was checked for exact same-selector/property supersession and semantic alias final-state equivalence; neither analysis found safe mechanical deletions. That is the foundation exit condition: further shell simplification is visual/cascade design work and requires runtime visual QA, not speculative SSOT deletion.

The persistent SSOT audit owns these boundaries permanently, and the Block 16 gate additionally freezes the owner distribution and package-validation wiring. Working source, stripped staging source, and the exact packaged ZIP must all pass before the checkpoint is authoritative.


## Runtime shell/mobile certification — Block 17

Runtime visual certification starts from the Block 16 foundation exit and changes shell presentation only where current renderer emitters or responsive behavior provide direct evidence. At `<=900px`, `.shell-sidebar-v3430` is one off-canvas drawer contract. The icon-only compact sidebar is restricted to `901–1180px`; legacy `<=760px` horizontal section fallbacks must not re-enter the cascade.

The sidebar icon SSOT is the emitted `sidebar-icon-slot-v344` plus `sidebar-nav-icon-v289` SVG path. Positive `button[data-icon]` pseudo-icon selectors and `attr(data-icon)` content are retired. Active navigation is indicated once through the final 2px `::after` marker. Taskbar and mobile-navigation icon color flows through semantic icon tokens rather than hardcoded late-cascade gray values.

Default persistent sidebar chrome is solid. Taskbar action chrome is transparent at rest, while Search explicitly opts into the raised taskbar field surface. Phone bottom navigation remains feature-owned by `mobile-runtime-v495.css`, including safe-area geometry, touch targets, semantic icon roles, and keyboard hiding. Native desktop behavior remains certified by the maintained desktop audit.

Block 17 does not reopen the foundation ownership model. Shared visual facts still follow one fact / one owner / many consumers, and the working source, stripped staging source, and exact packaged ZIP must independently pass SSOT and runtime-certification gates.

## Workspace runtime consistency — Block 18

Settings, Boards, Library, and Timeline keep feature-owned presentation, but shared geometry remains shared. Library browser width and detail behavior are owned by the always-loaded `library-browser-grid-v429` adapter plus `ClusterMasterDetail`; `library-workspace.css` must not publish competing browser column templates or a second fixed inspector overlay.

Account Settings `v267` owns the current content/context geometry in one rule family that matches JSX child order. Earlier Account layout generations may style cards and content, but must not hide the current context rail or republish a competing rail template. Below the wide-desktop breakpoint the current geometry is one column.

Timeline may have one sticky command owner only. Because `timeline-header-filters-v254` is nested inside `timeline-commandbar-v254`, the filter strip is static; when filters stack for tablet widths the parent command bar also returns to normal flow. This prevents nested sticky ownership and keeps actions reachable. Board phone saved-view controls remain feature-owned and horizontally scrollable rather than wrapping into a tall control stack.

Native Qt windows consume the same renderer through `SharedRendererPage`, so renderer presentation is the native desktop presentation SSOT. The maintained Block 18 gate verifies these ownership boundaries, current debt ratchets, desktop parity, persistent SSOT registration, and staged source packaging.


## Dense workspace runtime certification — Block 19

Dense workspaces keep presentation close to their renderer emitter, but shared layout primitives remain the geometry SSOT. Whiteboard-specific fullscreen, current workspace chrome, Compact tools behavior, and `.style-topbar-section-v069` belong to `features/whiteboards/whiteboard-workspace.css`; feature-only Whiteboard selectors must not return to `features/shell/shell.css`. Shared responsive/mobile layers may position the Whiteboard command strips and bottom toolbar where viewport-wide behavior is genuinely cross-cutting.

Tickets and Builds must not republish `ClusterMasterDetail` column templates. Their feature styles own local rows, cards, filters, and content presentation, while `styles/design-system/primitives.css` plus the responsive adapters own master/detail geometry and mobile detail behavior. Tickets must not accumulate unrelated Time/Create/Build selectors as a convenient dumping ground.

Calendar owns one month horizontal-scroll viewport around both weekday labels and day cells. Packets owns its catalog-or-reader presentation, with one resource-list vertical scroll owner in fullscreen and a final one-column phone reader override after desktop geometry. QA triage stays on `ClusterMasterDetail`; QA run inspection stays on the shared modal/dialog contract, with feature-owned phone stacking and coarse-pointer targets only.

`SharedRendererPage` remains the native Qt presentation boundary, so desktop windows exercise the same renderer CSS rather than maintaining a native visual fork. The Block 19 certification gate freezes these ownership rules, verifies the 2,809 / 179 / 72 / 806 debt ratchets and 1,542,801-byte CSS ceiling, and remains part of the source packager's working-tree and stripped-stage audit path before exact-ZIP validation.

## Operational workspace runtime certification — Block 20

Block 20 extends the one-fact/one-owner rule into the remaining operational workspaces touched by this pass. Home/Dashboard presentation belongs to `features/application/styles/home-dashboard.css`; widget runtime/editor presentation belongs to `features/home-widgets/home-widgets.css`; Home dashboard layout state and its reusable customizer belong to `features/home-widgets/home-dashboard-controller.tsx` with presentation in `home-widgets.css`; the Account Settings widget note belongs to Settings. None of those feature selectors may use `application-overrides.css`, `application-adaptive.css`, `consistency.css`, or `responsive.css` as a second owner.

Notifications use `NotificationInboxPage` as the sole UI implementation, with `NotificationCenterPage` retained only as a semantic route adapter and `ClusterMasterDetail` retained as the queue/detail geometry primitive. Time owns all `.time-*` responsive behavior in `features/time/time-workspace.css`. Project Access uses the shared `ProjectSectionHeader` primitive rather than a legacy header alias.

Create has no compatibility styling generations. Current emitters use `shared-create-backdrop-v254`, `shared-create-workspace-v254`, `create-form-v161`, and `taskbar-create-v495`; old quick-create/v124/v161-drawer aliases stay deleted. `features/create/shared-create-drawer.css` owns Create form, launcher, search, and phone adaptation. Sectioned Settings, Server Configuration, and Admin navigation geometry is shared by `SectionedWorkspaceShell` and the final production design-system layer; feature styles may decorate their content but must not republish a competing outer navigation rail. Admin continues to own `.admin-workspace-v298` and `.user-admin-*` content/detail behavior in `features/admin/admin-workspace.css`, including the current detail-sheet state model.

The global responsive layer is reserved for genuinely cross-workspace viewport contracts. It must not republish Home, Time, Admin, or Create feature behavior merely because the rule is responsive. Block 20 freezes the current renderer ceiling at 2,784 forced overrides / 437 box shadows / 179 gradients / 72 backdrop filters / 805 raw colors / 1,537,049 CSS bytes. Working source, stripped staging source, and the exact packaged ZIP all run the maintained suite before the artifact is considered certified.

## Residual experience runtime certification — Block 21

Search, People, Activity, My Work, and Team follow the same feature-boundary rule as the earlier runtime blocks: feature-only presentation loads with and lives beside the emitter; shared primitives and truly cross-workspace geometry remain in the always-loaded design-system layers. Search owns `search-command-*`; People owns `people-*` plus its emitted `profile-*-v250` responsive contract; Activity owns `activity-*-v245` and `operations-live-people-v249`; My Work owns `mywork-*`; Team owns its `team-*` route/filter behavior. Time and Admin must not act as accidental style providers for Team, and the renderer entrypoint must not globally side-effect import People or My Work CSS.

The active Block 21 ratchet is 2,762 `!important` declarations / 437 box shadows / 179 gradients / 72 backdrop filters / 804 raw colors / 1,536,906 CSS bytes. Historical gates are ceilings, never demands that later blocks preserve old debt. The package path remains working source -> stripped staging source -> exact packaged ZIP, with the same maintained audit suite at each executable source boundary.

## Shared-layer convergence and version-alias SSOT — Block 22

Global shared layers are not feature registries. `application-components.css`, `workspace-contract.css`, and `visual-polish.css` retain a rule only when its selector expresses a genuinely shared/cross-workspace invariant. Whole zero-debt rules with one proven emitter belong to that feature; mixed rules are not mechanically split when doing so duplicates cascade or decorative debt.

Current workspace roots use one presentation generation per semantic surface: Board root v257 and columns v257, Timeline page v156, Library card/preview v219, and Settings page v092. Retired co-emitted generations stay absent instead of surviving as compatibility aliases. Exact-selector/property supersession is the deletion standard for forced-priority cleanup.

Projects cannot publish Settings/Create presentation. Settings owns its current help/header rules, Create owns its preview help preference, and application controls own the generic compact-help preference. Persistent SSOT, CSS architecture, Block 22 ownership checks, and three-stage package validation freeze these boundaries.

## High-debt shared-contract decomposition — Block 23

The shared cascade is allowed to own only shared facts. Block 23 narrows the remaining high-debt contracts using emitter evidence rather than selector naming or debt quotas.

- `workspace-contract.css` no longer publishes the Projects index toolbar/filter/header presentation. The Projects index owns that presentation under `.projects-page-v310`.
- Project Detail owns the legacy video-review selectors still emitted by `ProjectVideoWorkspace`; Project Operations owns closeout and release-lane selectors; Project QA owns QA card-row presentation.
- Shared component CSS owns `health-pill`, segmented-control button, `project-status-pill-v077`, and `project-source-pill-v0112` because those controls are consumed across route boundaries. Their migrated styling does not add raw-color or gradient debt.
- Settings keeps v092 as the current page/content authority and no longer carries retired v091/v176/v178 layout/content generations. Timeline page roots remain v156; Library grid card/preview remain v219; Projects page root remains v310.
- `projects.css` is lazy-route safe: generic page/section/action controls, video review, closeout, and release-lane presentation are not allowed to become side effects of visiting the Projects index.
- Shell is not reduced by quota. With no dead versioned Shell classes or exact same-selector/property forced duplicates proven by the current analysis, its 774 forced overrides remain until stronger runtime evidence justifies a change.

The maintained Block 23 gate freezes 2,602 forced overrides, 433 shadows, 177 gradients, 72 backdrop filters, 796 raw colors, and a 1,528,405-byte renderer CSS ceiling while preserving the working-source → stripped-stage → exact-ZIP certification path.

## Persistent Shell and global-contract convergence — Block 24

Persistent shell priority may be reduced only with final-state evidence. Block 24 uses an exact-rule Chromium differential fixture against the real CSS import order and requires zero computed-style differences across settled desktop/light/collapsed, tablet/phone drawer, reduced-transparency, and interactive hover states. Selector-name-only transforms are explicitly insufficient because repeated selector text can refer to different cascade positions.

The certified Shell ceiling is **608 `!important` declarations**, down from Block 23's 774. The final `.shell-sidebar-v3430 .nav-v046 button` owner keeps `border-color` and `background` forced because hover-state runtime comparison proved those priorities necessary; its `position`, `width`, `margin-left`, and `box-shadow` geometry no longer requires forced priority. Shared-layer ceilings remain `workspace-contract.css <= 164`, `visual-polish.css <= 23`, and `application-components.css <= 49`. A later pass may lower them, but must not transfer equivalent forced-priority debt into a feature owner just to improve a global-layer metric.

Block 24 introduces no compatibility stylesheet or alternate Shell generation. `shell-unified-v3430`, `shell-sidebar-v3430`, and `taskbar-unified-v3430` remain the current persistent runtime roots, and native windows continue to consume renderer workspaces through `SharedRendererPage` rather than forking presentation ownership.

## Multi-owner priority differential certification — Block 25

Forced priority in feature and shared-control owners may be reduced only when the final rewritten source is equivalent to the prior certified checkpoint. Block 25 uses exact declaration-position mapping plus isolated and accumulated route-load differential fixtures for Settings, Boards, Library, Timeline, `workspace-contract.css`, `controls.css`, and application controls. Selector-only or per-rule safety is insufficient because independently harmless demotions can interact once all feature and shared styles are loaded together.

The final source retains two Settings priorities proven necessary by the independent baseline-vs-source comparison: `min-height: auto !important` on `.settings-console-v269 .settings-panel-head-v092`, and `padding-bottom: 48px !important` on `.account-settings-console-v271, .studio-settings-console-v271`. The accepted set removes 240 priorities overall and freezes these owner ceilings: Settings **261**, Boards **94**, workspace contract **116**, Library **135**, Timeline **29**, shared controls **101**, application controls **78**, and persistent Shell **608**. Debt may fall below these ceilings in later blocks but must not be shifted into another owner merely to improve one file's metric.

Runtime differential tooling is certification evidence, not a new runtime dependency or compatibility layer. Production source remains free of probe HTML/JSON artifacts; the source-only Block 25 gate verifies the certified counts, retained declarations, audit ordering, SSOT registration, native `SharedRendererPage` parity, and stripped-source packaging contract.


## Coolicons-merged feature priority certification — Block 26

Block 26 resumes the visual-runtime debt pass from the certified Coolicons source. The lost abandoned Block 26 worktree is not treated as a merge authority: only declaration reductions re-proven against the current source are accepted. The reconstructed set removes **270** forced priorities and freezes the renderer at **1,926 `!important` declarations** without transferring priority debt to another file.

Feature-local owner ceilings are Settings 197, Library 83, PDF viewer 9, Packets 25, Project Delivery 22, and Admin Control Center 31. Persistent Shell remains 608, `workspace-contract.css` remains 116, `controls.css` remains 101, application controls remain 78, Boards remain 94, and Timeline remains 29. Those shared/global owners are deliberately **not re-demoted** in this block because cross-route evidence from the earlier experiment showed that shared priority changes can interact outside the apparent owner.

The reconstruction uses exact declaration IDs from the current stylesheet plus cumulative browser differential checks. All six rewritten files are then loaded together and compared with the certified Coolicons source in isolated and accumulated route-order fixtures. No compatibility stylesheet, alternate root generation, or icon-system fork is permitted to mask a difference. `ClusterIcon` remains the only third-party artwork adapter and Coolicons remains local/offline.

Later blocks may lower these ceilings only with stronger runtime evidence. Historical gates must remain ceilings, never requirements to preserve obsolete debt.

## Shared-control priority convergence — Block 27

Shared/control priority is a runtime fact, not a formatting preference. Block 27 accepts a demotion only when the cumulative source rewrite preserves computed values and geometry in both isolated and accumulated route-order fixtures across dark/light desktop and phone states.

The certified owner ceilings are Boards **22**, `workspace-contract.css` **29**, shared `controls.css` **35**, and application controls **55**. Together they remove **248** forced priorities from Block 26 and freeze the renderer at **1,678 `!important`** declarations / **1,517,168 CSS bytes**. Per-file debt may fall later but must not be transferred into another owner.

Shell remains at 608. Its broad non-inherited geometry/surface candidate set failed the cumulative source differential, so Block 27 does not lower that ceiling. Dead versioned selector branches may be removed when no renderer emitter remains, but live mixed-selector rule bodies must not be cloned or compatibility-mapped to manufacture a cleaner ownership score.

`ClusterIcon` remains the single third-party icon adapter and Coolicons remains local/offline. Interactive glyphs should use semantic icon names; text semantics such as dimensions, multiplication signs, dependency arrows, keyboard notation, and user-authored canvas symbols remain text.

## Hard-tail visual convergence — Block 28

Block 28 reduces only priority debt that survives conservative cumulative cascade comparison. The current exact checkpoint is **1,445 `!important` declarations** with owner ceilings of Settings 86, Library 13, application controls 49, application components 36, application shell 41, Admin workspace 20, and persistent Shell 608. The accepted owner tranche removes 233 priorities from Block 27 without moving equivalent forced declarations into another stylesheet.

Persistent Shell remains frozen at 608 because the weaker synthetic probe disagreed with earlier real runtime evidence for final sidebar navigation surface priorities. When evidence conflicts, the stronger runtime result wins. `styles/accessibility.css` retains its 50 forced declarations because reduced-motion, contrast, and assistive presentation overrides are intentional cascade authority, not ordinary visual debt.

No-emitter selector cleanup may remove a selector arm only when a directly required versioned class has no renderer emitter. Functional alternatives that still contain potentially live branches are retained unless separately proven dead. Block 28 removes 69 such retired arms and four empty rules without introducing a compatibility owner. Historical Block 26 and Block 27 gates are ceilings in later source checkpoints; they must never force obsolete debt back into the renderer.

Block 28 closes the visual-foundation debt program. Subsequent changes to the cascade require a reproduced runtime defect or stronger differential evidence and must preserve persistent SSOT, the canonical `ClusterIcon` boundary, native `SharedRendererPage` parity, and the working-source → stripped-stage → exact-ZIP certification path.

## Block 30B workflow ownership

The post-infrastructure UI convergence keeps presentation ownership close to the canonical runtime owner instead of adding another late cascade layer.

- Shell/navigation convergence lives in `features/shell/shell.css`.
- Project header/workspace adaptation lives in `features/projects/project-detail-workspace.css`.
- Grouped compact navigation lives in `styles/components/compact-section-nav.css`.
- Shared data-view/control styling stays with shared controls/components rather than feature pages.
- Feature pages may style domain content, but should not duplicate shared toolbar, saved-view, bulk-selection, or generic state contracts.
- Temporary Block 30B convergence stylesheets were deliberately removed after the rules were proven and moved to their canonical owners.

The CSS architecture baseline is a ratchet, not a target to inflate back toward. Current source is stricter than the historical Block 28 snapshot: 1,429 `!important` declarations, 432 box shadows, and 98 renderer CSS files. Historical visual gates should preserve their semantic contract and ceilings while allowing later debt reduction.

## Program 34 UI foundation

Program 34 begins by strengthening the existing design-system ownership instead of introducing another visual registry. `design-system/tokens.css` remains the primitive/token authority and `application-theme-contract.css` remains the application surface/theme authority.

Cluster Blue **#57c1ff** is the canonical default product accent. The Program 34 neutral palette adds **#383838** and **#5c5c5c** as named primitives for raised/secondary hierarchy. Feature styles do not hardcode these values; they consume semantic surface, text, category, status, and interaction tokens.

Program 34 adds a semantic surface vocabulary for canvas, content, raised, subtle, workspace, panel, floating, and field surfaces. It also adds adaptive geometry tokens for control targets, rows, menus, widget-grid units/gaps, inspectors, and shell controls. Density, reduced transparency, disabled transparency, reduced motion, no motion, and large-target accessibility modes modify those tokens at the root so future Widgets, Settings, shell surfaces, and canonical components inherit one behavior.

Color is intentionally available for category, importance, state, charts, and organization, but color is never the sole carrier of meaning. Normal production surfaces remain neutral by default. Web and native Qt surfaces share Cluster Blue and the preferred grey hierarchy.

Block 34A does not redesign the shell, Settings, Widgets, Packets, authorization UI, or mobile navigation. Those later Program 34 phases consume this foundation rather than bypassing it.
## Program 34 floating surfaces

Block 34B establishes `components/ClusterFloatingSurface.tsx` as the canonical anchored floating-surface runtime. Menus, selects, contextual popovers, and mobile sheet presentations consume this boundary instead of owning feature-local viewport math, outside-click listeners, Escape handling, or z-index/overflow workarounds. The surface renders through a `document.body` portal, reacts to `VisualViewport` and resize/scroll changes, observes dynamic geometry, and uses semantic Program 34 surface/shadow tokens.

`design-system/primitives.css` owns floating geometry and shared action-menu presentation. Glass blur remains owned by `card-style-glass.css`; feature styles may size or arrange the content inside a floating surface but may not redeclare anchored positioning or backdrop-filter behavior. `ClusterDialogHost` remains the canonical modal boundary, while `ClusterMasterDetail` remains the canonical bounded inspector pattern.
## RC16 dense admin and settings ownership

RC16 converges dense administration surfaces onto explicit feature owners instead of allowing historical global registries to restyle them by release-numbered aliases.

- Tool Infrastructure browser/detail geometry belongs to `features/application/styles/tool-infrastructure.css`. The current semantic roots are `tool-infrastructure-page`, `tool-infrastructure-browser`, `tool-infrastructure-catalog`, and `tool-infrastructure-detail`; retired v236/v239/v250/v268 layout classes are not compatibility contracts. The catalog list is the bounded scroll owner on wide selected-tool views so the outer catalog does not clip focus treatment.
- The Operations overview belongs to `features/admin/admin-workspace.css`. `operations-overview-*` and `admin-split-grid` describe current overview/split geometry; Incident and Security panels may consume the generic split contract without inheriting unrelated Operations dashboard styling.
- Operations reports and guarded maintenance geometry belong to `features/application/admin-control-center.css` under semantic `operations-report-*` and `maintenance-*` selectors. Tables/lists own their bounded scrolling; their surrounding cards must not become clipping containers.
- Server Configuration keeps its feature-specific v238 field/control vocabulary while migration is in progress, but its current layout is CSS Grid with natural page scrolling. Multi-column masonry and viewport-height clipping are retired. The backup/sidecar list is the bounded scroll owner where required.
- Settings cards and entity workbenches must not impose viewport-height clipping merely to create an application-like frame. `SectionedWorkspaceShell` owns the outer settings/admin section navigation; feature content owns only its internal grids, contextual sidebars, and intentionally bounded lists.

As with the rest of the renderer, later cleanup should delete proven-dead versioned selectors rather than add aliases or another release-numbered correction layer.

