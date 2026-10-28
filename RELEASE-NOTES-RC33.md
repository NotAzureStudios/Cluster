# Cluster 1.0.0 RC33 development source | Graphs and Transfer Center

**Distribution type:** source-only development checkpoint built on RC32, including the RC32 graph/cache audit overlay. This is **not a new installer**; the prior RC32 Windows executable does not contain these changes.

## Changes

### Transfer Center / download manager
- Reworks the existing taskbar Transfer Center into a chart-led ~800px adaptive panel, using the existing Cluster Floating Surface and theme tokens.
- Displays real native broker upload/download throughput from cumulative byte deltas and push notifications; no new HTTP polling or native bridge progress polling.
- Adds an SVG network transfer history chart, bounded to 90 local samples, for separately measured uploads and downloads.
- Displays current transfer rates, count of active and queued operations, native per-file progress bars, measured per-file speeds, and conservative ETA estimates.
- Organizes current, pending, and finished operations into sections. Queued browser uploads are correctly separated from currently active uploads. Completed native transfers support existing Open/Remove actions.
- Preserves pause/resume/retry/cancel controls, owner/standby and journal recovery protections, offline uploads, and browser handoff messages.
- No extra server requests, no added package dependencies, no schema migration.
- Unknown measurements remain unknown: browser handoff completion cannot be independently verified, browser upload per-byte progress is not available to this component, and disk throughput is not reported by the current transfer broker.

### Graph reuse elsewhere
- Adds `MetricComparisonBars`, a reusable accessible visual comparison primitive; replaces verbose client performance category cards with real p95 latency bars.
- Includes the preceding RC32 bug audit overlay: Operations gets live request/database latency history while open, and the query cache fixes late-response reinsertions and failed durable-cache write rejection handling.

### Correctness
- Graph byte deltas reset safely on job replacement, decreases, completed/paused jobs, and large timing gaps.
- Bounds chart history to 90 points and keeps all data local to the current renderer session.
- Respects reduced-motion and available width, uses theme colors, includes semantic metric labels.
- Does not add a parallel transfer engine, alter file authorization or change download audit semantics.

## Validation performed
- 33/33 inherited RC smoke scripts passed.
- 10/10 focused transfer and visual chart checks passed.
- 12/12 shared transfer action checks passed.
- 18/18 native journal status contracts, 24/24 multiwindow queue contracts, 81/81 strict journal assertions passed.
- 1,189 TS/TSX files parsed, 0 syntax diagnostics.
- 3,383 relative renderer imports checked, 0 missing.
- 118 CSS files parsed, 0 brace errors.
- `transfer-telemetry.ts` compiled with strict TypeScript checks.
- Embedded Go/Windows EXE **not rebuilt**: local toolchain only has Go 1.23.2; complete dependency-backed React/Prisma/Node 24 build and real Windows runtime tests remain unverified.

## How to use
- `Cluster-RC32-to-RC33-Graphs-Overlay.zip` supplies `source/` relative paths; apply over the extracted RC32 source before rebuilding with its official installer toolchain.
- The alternative `Cluster-RC33-Development-Source.zip` includes the updated source tree without obsolete RC32 EXE files. It cannot be installed by simply double-clicking a binary.

## Next planned improvements
- Expose real optional disk read/write telemetry from the native Windows transfer broker; do not equate network progress with disk I/O.
- Instrument browser-stream transfer progress before presenting browser throughput or trustworthy ETA.
- Add historical retention to authorized Operations metrics only when a defined server-side aggregation/retention policy exists.
- Validate rendering and throughput estimates on the real RC32/33 Windows Node/PostgreSQL runtime.
