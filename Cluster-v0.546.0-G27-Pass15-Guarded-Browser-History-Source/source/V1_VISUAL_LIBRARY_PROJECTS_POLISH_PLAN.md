# Cluster v1 Visual / Library / Projects Polish Scope

This document is the active pre-v1 polish scope after WIP57 Pass 8. It deliberately prevents the architecture discussion from expanding into a product-wide pre-v1 rewrite.

## 1. Visual Foundation

### Required before visual freeze

- One canonical effective visual context and semantic token authority.
- Unreal Material-inspired parent/instance philosophy for visual definitions and exposed appearance parameters.
- Studio/user/accessibility resolution without duplicated competing settings.
- Background base separated from pattern; subtle Hex is a first-class pattern.
- Sidebar 2.0 and Taskbar 2.0 as shared Shell composition primitives.
- Compact Taskbar Back/Forward and workspace recovery; no giant Home resume banner.
- Taskbar overflow/label modes and clean Project-tab behavior.
- Shared primitive convergence for buttons, menus, inputs, surfaces, toolbars, inspectors, modals, tables, etc.
- Retire superseded versioned shell selectors and excessive override/`!important` fossils as each subsystem migrates.
- Appearance Settings with a meaningful live Cluster-shell preview.
- App-wide visual/DPI certification at 100%, 125%, 150%, narrow desktop, 1080p, 1440p, ultrawide, tablet/mobile.

## 2. Library 2.0

### Explorer/layout

- Library is a real studio file/asset explorer, not a stripped file picker.
- Normal page/workspace scrolling with endless/progressive loading; remove the trapped fixed-height container.
- Grid/list expands when Inspector closes; no dead column.
- Library Explorer has independently collapsible Views, Collections, and Folders sections; entire explorer supports Expanded / Compact / Hidden.
- Rich folder tree with remembered expansion state, breadcrumbs, drag/drop, custom icons/colors/descriptions, favorite/pin, manual order, Project association, permissions, and per-folder view/sort/grouping/columns.
- Files support Name/Created/Modified/Size/Type/Owner/Project/Review/Custom sort, including per-folder manual ordering.

### Organization/search

- Quick type filters plus extension/MIME/size/date/uploader/owner/Project/tag/review/classification/version filters.
- Search scopes: current folder, descendants, current Project, entire Library.
- Manual Collections, Smart Collections/saved searches, and tags remain distinct organization models.
- Grid, compact grid, list, and details views; configurable columns and grouping.
- Multi-select bulk organization/actions.

### Media/transfer/records

- Repair the media source/streaming pipeline first; then Media Viewer 2.0 for image/video/audio/PDF/text/3D/external media.
- One global Upload/Download Transfer Center with durable queue, chunking, pause/resume/retry/cancel, verification, recovery, concurrency/bandwidth controls, Desktop-native execution, Taskbar projection, and Library projection.
- Polish thumbnails, versions, ownership/review records, drag/drop and watermarking where practical.

## 3. Projects 2.0

- Project domains: Identity, Lifecycle, Plan, Team, Tools, Integrations, Governance.
- Overview answers what the Project is, where it is, what needs attention, what happens next, and who owns it.
- Separate Lifecycle, derived Health, and Production Phase.
- High-level Plan for milestones, deliverables, dates, handoffs, dependencies, release targets, completion criteria.
- Project-specific responsibilities/roles without replacing People/Studio roles.
- Dedicated Integrations surface for Git/LFS, Unreal, Discord, builds and future providers.
- Finish internal/external/codename/alias identity UX and external-safe display behavior.
- Actionable profile-aware readiness checklist.
- Strong completion/closeout workflow.
- Keep `ProjectSnapshot` as the compact permission-filtered cross-Cluster projection.
- Decisions/Risks/templates only enter v1 if cheap after the core structure is stable; no scope expansion.

## 4. Explicit pre-v1 boundary

After Visual Foundation, Library 2.0, Projects 2.0 and visual/runtime certification, freeze product/visual architecture and return to official Windows build, Desktop/Workstation, UE5.8, Discord, PostgreSQL runtime, packaging and final RC work.

## 5. Retained post-v1 architecture direction

Do not forget, but do not refactor for v1 solely to implement these ideas:

- Definition/instance and parent/child inheritance for suitable Cluster configuration systems.
- Studio -> Project -> User setting/policy inheritance.
- QA definition -> execution, Build definition -> run, Widget definition -> instance refinements.
- Integration/source-control profile inheritance.
- Advanced Library policy inheritance.
- Per-device Appearance instances.
- Formal architecture distinction: inheritance vs containment vs graph relationships.
- Deeper Project relationship/dependency visualization.

Rule: apply these patterns when a touched system genuinely benefits; do not rewrite working domains merely for architectural elegance before v1.

## Current implementation status — Pass 11

Implemented in source: visual master/instance resolution, effective visual context, background patterns, Shell 2.0 composition layer, compact taskbar history/recovery, live Appearance shell preview, shared closed-Inspector width recovery, collapsible Library Explorer sections, page-level Library scrolling, automatic pagination, adaptive grid filling, expanded Collections, stable custom per-folder ordering, Grid/Compact/List/Details modes, grouping, tag filters, folder/descendant/Project/global search scope, and the repaired Library derivative -> unified Media Viewer resource path with range-capable derivative delivery. Active Sidebar and primary Taskbar action chrome have begun retiring version-stamped presentation dependencies.

Still active in the bounded v1 scope: remaining shared/shell visual fossil retirement where live markup still depends on it, Transfer Center + durable upload/download queue, deeper Library folder/record/version/watermark polish, packaged-runtime Media Viewer verification/polish, Projects 2.0, then app-wide visual/DPI certification and freeze.
