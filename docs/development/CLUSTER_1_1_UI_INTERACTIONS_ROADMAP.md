# Cluster 1.1 — UI Infrastructure & Specialized Interactions Roadmap

**Status:** Approved scope; implementation incremental on `development`, not the production `main` branch. **Baseline:** renderer 1.0.5 source. **Scope:** Web, Qt Desktop where equivalent screens exist, responsive/tablet/phone, kiosk and reduced-motion modes.

## Design direction

Cluster should feel like a professional studio production tool, not a pile of repeated settings cards. Preserve our Comfortaa, dark/grey surface language, #57c1ff purposeful accent, subtle rounded materials, thin selection indicators, predictable keyboard/touch behavior, and quiet completion feedback. Use specialized compositions per workspace **with one shared interaction foundation**. Do not replace known-good systems merely for visual consistency.

Three layers:
1. **Foundation controls:** button, switch, toggle, slider, dual range, progress/meter, splitter, searchable select, segmented choice, drag handle, date/time, disclosure, status and field validation.
2. **Specialized interaction primitives:** entity assignment, hierarchy/treegrid, permission/effective-access matrix, relationship graph, lifecycle control, audit diff, time grid, annotation/canvas transform, comparison and analytics filters.
3. **Workspace compositions:** People/Organization, Boards, Whiteboards, Projects, Calendar, Library and Viewer, QA/Builds/Git, Studio Analytics, Settings and Server Operations. Composition may vary; data and authorization must not fork.

### Rules of engagement
- **Reuse first.** Audit existing components before inventing replacements. A design-system primitive must have at least one production consumer and a concrete second reuse target; otherwise keep it local.
- **Canonical authority.** A shared UI does not own permissions, business state, persistence or cross-domain relationships. Server-authoritative mutation and permission checks remain in domains; UI props carry resolved state and explicit callbacks.
- **No compatibility fossils.** Zero production-user migration requirement for in-development contracts; remove obsolete internal duplicates after functional equivalence and regression proof.
- **No visual deceit.** Unknown data is unknown, not zero or healthy. No falsely implied live status; summarize checked and unverified conditions separately.
- **Safety stays visible.** Critical exposure changes, irreversible operations, authentication and secret handling require explicit review. Only routine descriptions move into contextual help.
- **Performance.** Avoid layout thrashing, request loops, heavy chart/canvas work without a visible consumer, and loading entire directories where scoped/virtualized queries fit. Honor offline, conflict and server-version gates.
- **Accessibility.** Correct label/control association, ARIA roles/states, roving focus for grouped choices, full keyboard paths, coarse-pointer targets >=44px, high contrast and reduced motion; do not rely solely on color.
- **Testing.** Regression, real interaction, permissions, dark/light, 100/125/150% DPI, touch/mobile, screen-reader and actual Windows/Qt/runtime checks as applicable. Source assertions alone are not release certification.

## Track UI-01 — Settings / Configuration experience (P0)

**Surfaces:** Account Settings, Studio Settings, Tool Infrastructure, Server Config, People administration, Operations. Keep these distinct authorities; a Tool page should not become a second Server or Studio policy editor.

- **SettingsRow + SettingsSection:** label/value/control, compact aligned groups, meaningful status and available extra help, responsive stacking. Stop repeating page titles, descriptions and status in every card.
- **ChoiceCardGroup + PresetPicker:** visual theme, density, navigation, Project type, kiosk/device mode and setup presets with single-select semantics, previews and reset. Native selection semantics, no unlabeled buttons.
- **SettingsInlineHelp + Dependency:** contextual descriptions, disabled-reason explanations, progressive disclosure of dependent controls while retaining draft values. Never hide dangerous consequences.
- **SettingsSearch + SettingLocator:** find labels, groups and relevant technical keys across categories, deep-link to section and focus controls, include currently collapsed Advanced sections in results.
- **SettingsSaveBar + ChangeReview:** one save authority, dirty count, changed-field review, safe discard/refresh, comparison to effective source, optimistic conflict recovery, restart/exposure/PIN impact. Never expose secrets or assume a change committed before server success.
- **SettingsStatus / ConfigurationInspector:** distinguish effective/inherited/overridden/pending/degraded/restart-required; source-of-value, audit, revisions, preflight and server evidence on demand.
- **NotificationDeliveryMatrix + QuietHoursSchedule:** categorized routing, Inbox preserved, quiet-hours visual time selection, device-specific permission state.
- **StudioPolicyWorkbench:** role-scope matrix, effective-access inspector, assignment previews and lifecycle guards.
- **ServerConfigWorkbench:** compact overview/configure/review, network topology, protected secrets and storage paths, maintenance windows, preflight, rollback and reliable native restart. No weakening of PIN, changed-field compare-and-swap, deployment locks or verified recovery.
- **AccountAppearanceWorkbench:** theme tiles with previews, density/layout choices, hidden-by-default design-system gallery, unified save feedback.
- **KioskProfileDesigner:** presets, authorized screens, interactive profile preview, scheduling and signed-out safety; build on existing preview.
- **ToolConfigSurface:** tool-local defaults and feature states, not duplicated underlying policy ownership.

**First implementation pass:** shared choice cards, compact setting rows, contextual help and safe change review; integrate Account Appearance, Studio identity and Server Config. Later passes consume the same contracts in Notifications, Permissions and Tool Infrastructure.

## Track UI-02 — Management / Organization (P0-P1)
- **EntityPicker 2.0** with avatars, search/pagination, scoped suggestions, multi-assignment, archived/unavailable clear states.
- **OrganizationExplorer + HierarchyTree** with department lead and manager relationships, accessible treegrid alternative to graph, reorder with server-side cycle checks.
- **PermissionMatrix + EffectiveAccessInspector** with explicit versus inherited and denied/unknown state, impact preview, restricted mutations.
- **AssignmentWorkbench / bulk operations**, **LifecycleController**, **AuditTimeline/Diff**, **OnboardingStepper**, **CapacityMeter**, **people data explorer**.
- Reuse in Project teams, Review assignments, Calendar, Inventory and Portal. Continue v1.1 People/Departments/Roles PRs independently; never overwrite work from pending branches.

## Track UI-03 — Boards / Work / Tickets (P1)
- Extend existing Kanban/list/table/timeline/calendar views, selection and dnd-kit rather than replacing data.
- **Lane/Swimlane**, **Card interaction surface**, multi-select drag with auto-scroll and permission validation, **BulkEditWorkbench** with preview, **DependencyInspector** and WIP/capacity status.
- Same Card/resource identity across views, My Work, Calendar and Project; no shadow records. Tickets add triage/repro and linked evidence.

## Track UI-04 — Whiteboards / Spatial (P1)
- Extend existing Whiteboard zoom/pan, multi-select, freehand, snapping, alignment, connectors, history and collaborative state.
- **CanvasTransformHandle**, **SmartGuides**, **Minimap**, **Layers/Outline**, **SpatialInspector**, **ConnectorRouter**, **ContextualCanvasToolbar**, **ViewportPresets**.
- Share transform and navigation *contracts* with Project workflow graphs, Organization graphs, and viewer surfaces; keep renderer-specific implementations where different.

## Track UI-05 — Projects / Portfolio / Production (P1)
- **ProjectIdentityHeader**, **Portfolio explorer**, **ProjectLifecycleRail**, **ProductionPipeline**, **MilestoneTrack**, **ResourceExplorer**, **ProjectHealthEvidence**, **ProjectLayoutComposer** and dependency/relationship graphs.
- Specialized Project-type composition (Unreal/ARK/Minecraft/video/other) atop shared controls; never force identical tool inventories or duplicative identity.
- Use Project data already provided by server and permission-gated, rather than creating new analytics claims.

## Track UI-06 — Calendar 2.0 / Scheduling (P0-P1)
- Extend authoritative Calendar event/meeting/occurrence logic and current month/week/day/agenda views; add **year**, personal/team/project/studio overlays, sharing and delegated editing with enforced visibility.
- **TimeGrid**, **EventDragResize**, **AvailabilityLanes**, **RangeSelection**, **RecurrencePreview**, **ConflictPreview**, **ResourceBooking**; touch and keyboard equivalents.
- Dragging must respect timezone/DST, private visibility, recurring-series scope, optimistic conflicts, and safe mutation gates. Timeline and Board Calendar remain canonical lenses.

## Track UI-07 — Library / Media / Review (P1)
- Build upon `UnifiedVideoViewer`, `UnifiedAudioViewer`, `UnifiedImageViewer`, `UnifiedPdfViewer`, `UnifiedThreeViewer`, existing overlay/comparison/review architecture.
- **ReviewTimeline**, **Frame/TimeRangeSelector**, **ReviewMarkerRail**, **AnnotationSurface**, **ComparisonSurface**, **ViewportController**, **ReviewNavigator**, **VersionStack**, **MediaInspector**.
- Video frame/region comments, storyboard scrubbing, multi-lane markers; audio waveforms/regions; image/PDF annotations and diff; 3D hierarchy, camera, measures, model pins. No unnecessary in-app video editor, DAW or 3D authoring suite.
- Keep ACL/derivative/download rights and published vs source boundary authoritative.

## Track UI-08 — Studio Analytics / Data Exploration (P1)
- Dedicated **Studio Analytics**, independent of Server/Operations telemetry. Metrics: project throughput, assigned workload, time/effort variance, scheduling/capacity, QA/build gates, delivery risks, trends and filters.
- **Crossfilter**, **DateComparison**, **Drilldown**, **MetricDefinitionInspector**, **CapacityHeatmap**, dashboard layouts, saved views and exports. Use server-derived evidence, permission-safe aggregation, provenance and unknown-state handling.
- Extend `ClusterDataTable`, `ClusterFilterBuilder`, `ClusterVisualMetrics` before evaluating heavier chart libs.

## Track UI-09 — QA, Builds, Source Control, Forms, Inventory, Home (P1-P2)
- **TestCaseStepper**, evidence capture and failure/reproduction timelines; **BuildPipelineStage**, job progress, artifact/failure inspector.
- **DiffViewer/BranchGraph/ConflictInspector** for Git; **FormBuilder/ConditionalFieldEditor/ApprovalStepper**; **InventoryCustodyTimeline/LicenseSeatMatrix**; **HomeWidgetCanvas** with personalized layout and resource summary.
- Cross-resource links and reusable controls, without cloning the underlying domain models.

## Track UI-10 — Cross-cutting finish, delivery and certification (P0 throughout)
- Visual conformance: quiet settings layouts, accessible focus, proportional spacing, consistent icons and touch-sized affordances, no clipped icons, no permanent empty decorative cards, correct active/hover styles.
- Search, command surfaces, saved views, context menus, inspector/drawer/docking patterns, user preferences, undo/recovery, approvals and bulk-change confirmation.
- Responsive layouts for Web/Desktop/Discord Activities/External Portal where applicable. Desktop is a distinct UI host; explicitly define Qt parity rather than assuming React controls magically transfer.
- Cache/query discipline, virtualization, render profiling, stale/error/offline/permission-revoked states, version incompatibility and live collaboration boundaries.
- Each component documented in Design System Preview with working variants and interaction tests. Track **Planned → Primitive Ready → Consumer Integrated → Regression Tested → Runtime Certified**.

## Implementation slices and acceptance

| Slice | Change | Exit evidence |
|---|---|---|
| **U1 (in progress)** | Shared Settings controls + Account/Studio/Server first consumers, roadmap and focused CI | Build + accessible selection, change-review safety and visible noise reduction |
| U2 | Settings search, save bar, notifications and dependent controls | Cross-section find, no duplicate save authority or request storms |
| U3 | Management entity/hierarchy/permission/lifecycle interactions | Effective-access server tests, keyboard/touch + bulk preview |
| U4 | Canvas, Board and Project shared interactions | Real consumers and spatial/dnd tests |
| U5 | Calendar 2.0 time controls | DST/recurrence, drag/resize + ACL tests |
| U6 | Viewer review/annotations + version compare | File ACL, coordinate/time anchoring, loading/perf tests |
| U7 | Studio Analytics/production data explorer | Scoped aggregates, drilldowns, metric definitions |
| U8 | Cross-client polish and certification | Web and native Windows reality tests, DPI, touch and release checklist |

**Constraints:** No new single mega-component, no wholesale app redesign without an audited consumer, no silent replacement of protected operations, no fake live telemetry, no claim of deployment from source tests, no changes to `main` until a deliberately certified release.
