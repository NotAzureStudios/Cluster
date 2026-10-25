# Cluster v0.546.0 | TD4 Pass 1 — Shared Commands, Create Reliability and Search Freshness

**Baseline:** TD3 Pass 7 complete source. **Status:** implemented in source with focused unit/source assertions and inherited regression commands; **not** a dependency-backed running React/Windows/Qt/PostgreSQL certification.

## Bounded delivery scope

This pass deliberately leaves Appearance 3.2 alone and begins high-leverage TD4/CD-14/CD-19 work. Existing TD0–TD3 contracts and native binaries are preserved. No database migration is required because the HTTP mutation receipt mechanism already exists in the server.

### 1. Global Create: one deliberate intent = one operation

- Added the synchronous `createClusterCreateIntentControl` which rejects repeated click / keyboard submits immediately, without relying on React's delayed busy-state render.
- The drawer applies the server's existing `X-Cluster-Idempotency-Key` receipt protocol to **ten object-create mutation sites**, including Project provisioning, Cards, Tickets, Whiteboards, Packets, Timeline, Calendar, Scheduler, Builds and Meetings. An identical request in the same draft retains its receipt key across a retry after an uncertain response. The key changes for a different route/body or for an explicitly new Create Another intent.
- Successful object creation is marked committed **before** optional link/upload/refresh cleanup can fail. If those followups fail, the UI no longer reports this as a completely failed creation eligible for a blind second Create. Project provisioning additionally marks its successful operation before reloading Projects.
- The drawer's initialization effect now runs once per open lifecycle, so later preference/context loading won't reset entered fields.
- Default **Create & Open** uses the canonical work navigation event; explicit **Create Another** stays in the drawer and renews the creation intent. Explicit handoff `openOnComplete:false` is respected. Existing canonical work-target mapping is reused.
- Existing server authorization, object-specific readiness validation, duplicate suggestions, and offline drafts remain authoritative. The intent gate is a UI-level guard, not a substitute for server enforcement.

### 2. Shared async action-menu contract

- Overflow (`ClusterActionMenu`), right-click/long-press (`ClusterContextMenuSurface`) and split-button actions now use a common `useClusterMenuExecution` hook based on the existing single-flight gate.
- Menus prevent repeated dispatches during the same in-flight action and keep the surface open until the action succeeds; failed/uncertain actions show an alert in the same menu, rather than being silently discarded as an unhandled rejection.
- Split-button primary actions are included in the guard. No automatic replay is attempted after uncertain mutation outcomes.
- Destructive separation, existing permission-controlled actions, and keyboard focus behavior remain unchanged.

### 3. Command Palette remote-result freshness

- Remote matches are cleared at the beginning of a new query/scope request rather than retaining prior-result rows during debounce.
- Aborted remote responses are ignored before they can repopulate an outdated result list. This is a UI projection correctness hardening; it does not replace server-side authorization or invalidate all possible offline caches.

## Validation evidence

- New Node test suite: **21/21 checks passed**; tests directly execute the pure create-intent and single-flight state machines and assert that the real drawer/menu/palette source connects them.
- Inherited regression commands: **45/45 passed, executed in two groups**. The first runner reached the environment's command timeout after **39 passing commands**; the remaining six were rerun independently and all passed. The timeout must not be represented as a successful single uninterrupted run.
- Source TypeScript/TSX parser: **1,000 files, 0 syntax errors**.
- Renderer CSS parser: **109 files, 0 syntax errors**.
- Renderer relative imports checked: **3,011**, none unresolved by the scan.
- Native executable unchanged; no migration, installed dependencies, browser server login, Qt binaries rebuilt or PostgreSQL runtime validation in this pass.

## Certification still needed

- Simulate delayed server response, same-frame double click and Ctrl+Enter, uncertain API receipt, successful commit followed by followup error, and Create Another repeated operations in a live browser with a real PostgreSQL instance.
- Test restored offline drafts and closed drawer during pending request on real browsers.
- Test asynchronous menu action failure and focus on keyboard/touch across Library/Projects/People, including permissions changed mid-action.
- Verify Command Palette privacy projection with revocation and rapid scope changes against an actual authorized API.
- Full installed-dependency compilation, desktop/native Qt and Windows process lifecycle are separate TD5/RV gates.

## Next connected TD4 work

1. Migrate the remaining high-value Project/Library/People actions to the single command capability/authorization contract; avoid reimplementing menu-specific permission logic.
2. Finish context-aware Create and resource picker adoption; ensure optional object-specific post-create navigation honors durable deep links.
3. Build actual browser integration tests for duplicate submission and asynchronous menu state, then tackle search/result actions, notification event consumption and advanced bulk selection.
4. Continue TD5 runtime certification and TD6 feature completion slices without adding cosmetic settings unless they unblock a real workflow.
