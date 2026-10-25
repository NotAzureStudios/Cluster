# Cluster TD0 Pass 1 | Correctness fixes (source checkpoint)

**Input:** `Cluster-v0.546(1).zip`, 0.546.0 code baseline. Product version remains 0.546.0 until a separate release/version gate.

## Implemented

1. **Appearance resolver:** Correct `backgroundPatternFromInput(settings)` inside `resolveVisualContext`; previously referenced the `instance` const during its own initialization.
2. **Accessible accent foreground:** `themeContrastColor` now compares actual WCAG relative-luminance ratios for dark and white candidate text rather than using the arbitrary `0.48` luminance threshold. Does not promise accessible results for arbitrary administrator-selected foreground palettes; requires high-contrast UI certification.
3. **Reduced motion:** Explicit `full` setting cannot override OS-level reduced-motion request.
4. **Font selector:** Inter maps to Inter, distinct from Comfortaa; Comfortaa remains the default. Google Fonts CSS request includes both families; browser/offline behavior needs runtime assessment.
5. **Configurable tool availability:** Added one typed `configurable-tool-availability.ts` switch map covering Timeline, Tickets, Calendar, Scheduler, Library and Packets. Request infrastructure calls `isConfigurableToolCapability` rather than maintaining a stale local alias list. The request-domain label helper delegates to one definition.
6. **Tests:** Added `tools/scripts/cluster-td0-correctness-tests.mjs` and `npm run techdebt:td0:check`. Executable unit tests exercise actual TypeScript function bodies without a running DB/browser. Source-side assertions check that the policy/middleware are connected.

## Explicitly NOT delivered

- A complete module lifecycle controller: existing workers, listeners, subscriptions and queues may still execute when the tool is disabled.
- Full per-tool CPU savings, API integration security tests, or a complete route coverage inventory.
- Settings CAS adoption by Tool Config and People settings writers.
- ParentId Visual inheritance model, native Qt token parity, comprehensive fonts/offline runtime work, visual DPI certification.
- Full TypeScript semantic compilation, browser/Windows/PostgreSQL execution.

## Verification notes

See `TD0_PASS1_VALIDATION.md`. The packaged source has no installed third-party runtime dependencies or generated Prisma client, and this test host uses Node.js 22 rather than the required Node.js >=24.20. Runtime certification remains open.
